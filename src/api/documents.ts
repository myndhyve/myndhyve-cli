/**
 * MyndHyve CLI — Documents API Client
 *
 * Reads and writes long-form markdown documents stored at
 *   `workspaces/{workspaceId}/canvases/{canvasId}/documents/{documentId}`
 *
 * Ports the slides/decks pattern: Firestore REST + `updateTime`
 * precondition so concurrent web edits surface as
 * FAILED_PRECONDITION instead of silently clobbering a newer
 * version. Reads always fetch fresh — never cache.
 *
 * Phase 6 of the Documents PRD shipped a 900 KB markdown ceiling
 * in `firestore.rules`. The CLI mirrors the check pre-write so
 * users see a clean "file too large" error instead of a cryptic
 * permission-denied from the server.
 */

import { getToken } from '../auth/index.js';
import {
  createDocument as firestoreCreateDocument,
  deleteDocument as firestoreDeleteDocument,
  getDocument,
  listDocuments,
  toFirestoreFields,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('DocumentsAPI');

const FIREBASE_PROJECT_ID = 'myndhyve-prod';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/** Matches MAX_DOCUMENT_MARKDOWN_BYTES in the main repo (PRD §5.1). */
export const MAX_DOCUMENT_MARKDOWN_BYTES = 900_000;

// ============================================================================
// TYPES — mirror the main project's `Document` shape
// ============================================================================

export type DocumentPageSize = 'letter' | 'a4' | 'legal';

export interface DocumentChrome {
  pageSize: DocumentPageSize;
  runningHeader?: string;
  runningFooter?: string;
  showPageNumbers: boolean;
}

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  canvasId: string;
  title: string;
  themeId: string;
  markdown: string;
  chrome: DocumentChrome;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
  /** Server-side updateTime from Firestore — used as optimistic-concurrency key. */
  updateTime?: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  themeId: string;
  version: number;
  bytes: number;
  updatedAt?: Date;
}

// ============================================================================
// Path helpers
// ============================================================================

export interface DocumentLocation {
  workspaceId: string;
  canvasId: string;
}

function documentsPath({ workspaceId, canvasId }: DocumentLocation): string {
  return `workspaces/${workspaceId}/canvases/${canvasId}/documents`;
}

function defaultChrome(): DocumentChrome {
  return {
    pageSize: 'letter',
    runningHeader: '',
    runningFooter: '',
    showPageNumbers: true,
  };
}

function parseChrome(raw: unknown): DocumentChrome {
  const base = defaultChrome();
  if (!raw || typeof raw !== 'object') return base;
  const c = raw as Record<string, unknown>;
  return {
    pageSize:
      c.pageSize === 'a4' || c.pageSize === 'legal' ? c.pageSize : base.pageSize,
    runningHeader:
      typeof c.runningHeader === 'string' ? c.runningHeader : base.runningHeader,
    runningFooter:
      typeof c.runningFooter === 'string' ? c.runningFooter : base.runningFooter,
    showPageNumbers:
      typeof c.showPageNumbers === 'boolean'
        ? c.showPageNumbers
        : base.showPageNumbers,
  };
}

function byteSize(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}

// ============================================================================
// Read
// ============================================================================

export async function listDocumentRecords(
  location: DocumentLocation,
): Promise<DocumentSummary[]> {
  const collectionPath = documentsPath(location);
  const { documents } = await listDocuments(collectionPath, { pageSize: 100 });
  return documents.map((doc) => {
    const markdown = typeof doc.markdown === 'string' ? doc.markdown : '';
    return {
      id: String(doc.id ?? ''),
      title: typeof doc.title === 'string' ? doc.title : 'Untitled document',
      themeId: typeof doc.themeId === 'string' ? doc.themeId : 'default',
      version: typeof doc.version === 'number' ? doc.version : 0,
      bytes: byteSize(markdown),
      updatedAt: toDate(doc.updatedAt),
    };
  });
}

export async function getDocumentRecord(
  location: DocumentLocation,
  documentId: string,
): Promise<DocumentRecord | null> {
  const doc = await getDocument(documentsPath(location), documentId);
  if (!doc) return null;
  return {
    id: String(doc.id ?? documentId),
    workspaceId:
      typeof doc.workspaceId === 'string' ? doc.workspaceId : location.workspaceId,
    canvasId: typeof doc.canvasId === 'string' ? doc.canvasId : location.canvasId,
    title: typeof doc.title === 'string' ? doc.title : 'Untitled document',
    themeId: typeof doc.themeId === 'string' ? doc.themeId : 'default',
    markdown: typeof doc.markdown === 'string' ? doc.markdown : '',
    chrome: parseChrome(doc.chrome),
    version: typeof doc.version === 'number' ? doc.version : 0,
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt),
    updateTime: typeof doc._updateTime === 'string' ? doc._updateTime : undefined,
  };
}

// ============================================================================
// Create / update / delete
// ============================================================================

export interface CreateDocumentInput {
  id: string;
  title: string;
  themeId?: string;
  markdown?: string;
  chrome?: Partial<DocumentChrome>;
}

export async function createDocumentRecord(
  location: DocumentLocation,
  input: CreateDocumentInput,
): Promise<DocumentRecord> {
  const markdown = input.markdown ?? `# ${input.title}\n\nStart writing your document…\n`;
  if (byteSize(markdown) > MAX_DOCUMENT_MARKDOWN_BYTES) {
    throw new Error(
      `Initial markdown is ${byteSize(markdown).toLocaleString()} bytes — exceeds the 900 KB ceiling.`,
    );
  }
  const now = new Date();
  const chrome = { ...defaultChrome(), ...(input.chrome ?? {}) };
  const data = {
    workspaceId: location.workspaceId,
    canvasId: location.canvasId,
    title: input.title,
    themeId: input.themeId ?? 'default',
    markdown,
    chrome,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await firestoreCreateDocument(documentsPath(location), input.id, data);
  return { id: input.id, ...data } as DocumentRecord;
}

export interface ImportDocumentOptions {
  documentId: string;
  markdown: string;
  title?: string;
  themeId?: string;
  ifUpdateTime?: string;
}

export type ImportDocumentResult =
  | { ok: true; document: DocumentRecord }
  | {
      ok: false;
      reason: 'not-found' | 'conflict' | 'write-failed' | 'size-exceeded';
      error?: unknown;
      bytes?: number;
    };

/**
 * Replace an existing document's markdown (and optional theme/title).
 * Mirrors `applyDocumentReplace` from the main project — version bump
 * + updateTime precondition for optimistic concurrency.
 */
export async function importDocumentMarkdown(
  location: DocumentLocation,
  options: ImportDocumentOptions,
): Promise<ImportDocumentResult> {
  const bytes = byteSize(options.markdown);
  if (bytes > MAX_DOCUMENT_MARKDOWN_BYTES) {
    return { ok: false, reason: 'size-exceeded', bytes };
  }

  const existing = await getDocumentRecord(location, options.documentId);
  if (!existing) return { ok: false, reason: 'not-found' };

  const now = new Date();
  const fields: Record<string, unknown> = {
    markdown: options.markdown,
    version: existing.version + 1,
    updatedAt: now,
  };
  if (options.themeId !== undefined) fields.themeId = options.themeId;
  if (options.title !== undefined) fields.title = options.title;

  try {
    await patchWithPrecondition(
      documentsPath(location),
      options.documentId,
      fields,
      options.ifUpdateTime ?? existing.updateTime,
    );
    const next = await getDocumentRecord(location, options.documentId);
    if (!next) return { ok: false, reason: 'not-found' };
    return { ok: true, document: next };
  } catch (err) {
    if (err instanceof Error && /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(err.message)) {
      return { ok: false, reason: 'conflict', error: err };
    }
    return { ok: false, reason: 'write-failed', error: err };
  }
}

export async function deleteDocumentRecord(
  location: DocumentLocation,
  documentId: string,
): Promise<void> {
  await firestoreDeleteDocument(documentsPath(location), documentId);
}

// ============================================================================
// Themes — mirror the main project's 3 built-ins. Phase 5b adds workspace
// customs, which will come from a Firestore collection; for now only the
// built-ins are surfaced.
// ============================================================================

export interface DocumentThemeSummary {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  accent?: string;
}

export const BUILT_IN_DOCUMENT_THEMES: DocumentThemeSummary[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Serif, US-Letter, running header + page counter.',
    accent: '#1a1a1a',
    builtIn: true,
  },
  {
    id: 'serif',
    name: 'Serif (Academic)',
    description: 'Justified body, drop-capped H1, section name in footer.',
    accent: '#8B7355',
    builtIn: true,
  },
  {
    id: 'myndhyve',
    name: 'MyndHyve',
    description: 'Brand theme — indigo palette, Inter typography.',
    accent: '#6366f1',
    builtIn: true,
  },
];

export async function listCustomDocumentThemes(
  _workspaceId: string,
): Promise<DocumentThemeSummary[]> {
  // Phase 5b territory. For now, returning empty means the CLI only
  // shows built-ins — accurate reflection of the live behaviour.
  return [];
}

export async function listAllDocumentThemes(
  workspaceId: string,
): Promise<{ builtIn: DocumentThemeSummary[]; custom: DocumentThemeSummary[] }> {
  const custom = await listCustomDocumentThemes(workspaceId);
  return { builtIn: BUILT_IN_DOCUMENT_THEMES, custom };
}

// ============================================================================
// Helpers
// ============================================================================

async function patchWithPrecondition(
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>,
  ifUpdateTime: string | undefined,
): Promise<void> {
  const params = new URLSearchParams();
  for (const key of Object.keys(data)) {
    params.append('updateMask.fieldPaths', key);
  }
  if (ifUpdateTime) {
    params.set('currentDocument.updateTime', ifUpdateTime);
  }
  const url = `${FIRESTORE_BASE}/${collectionPath}/${documentId}?${params.toString()}`;
  const token = await getToken();
  const body = JSON.stringify({ fields: toFirestoreFields(data) });
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    log.warn('patchWithPrecondition failed', {
      status: response.status,
      text: text.slice(0, 200),
    });
    throw new Error(`Firestore PATCH failed: ${response.status} ${text.slice(0, 200)}`);
  }
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return undefined;
}
