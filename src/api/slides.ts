/**
 * MyndHyve CLI — Slides API Client
 *
 * Reads and writes Marp decks stored at
 *   `workspaces/{workspaceId}/canvases/{canvasId}/decks/{deckId}`
 *
 * Uses the Firestore REST wrapper for direct document access — the
 * Cloud Function API doesn't expose a deck endpoint; the canvas type
 * reads/writes this collection directly via the browser SDK. The CLI
 * mirrors that pattern.
 *
 * Write path (importDeckMarkdown) applies an `updateTime` precondition
 * so concurrent web edits surface as a Firestore `FAILED_PRECONDITION`
 * error instead of silently clobbering a newer version. Reads always
 * return the current server state; the CLI never caches.
 */

import { getToken } from '../auth/index.js';
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  toFirestoreFields,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SlidesAPI');

const FIREBASE_PROJECT_ID = 'myndhyve-prod';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ============================================================================
// TYPES — mirror the main project's `Deck` shape
// ============================================================================

export interface Deck {
  id: string;
  canvasId: string;
  title: string;
  themeId: string;
  markdown: string;
  slideOffsets: number[];
  aspectRatio: '16:9' | '4:3';
  thumbnails?: string[];
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
  updatedBy?: string;
  /** Server-side updateTime from Firestore — used as optimistic-concurrency key. */
  updateTime?: string;
}

export interface DeckSummary {
  id: string;
  title: string;
  themeId: string;
  slideCount: number;
  version: number;
  updatedAt?: Date;
}

// ============================================================================
// Path helpers
// ============================================================================

export interface DeckLocation {
  workspaceId: string;
  canvasId: string;
}

function decksPath({ workspaceId, canvasId }: DeckLocation): string {
  return `workspaces/${workspaceId}/canvases/${canvasId}/decks`;
}

// ============================================================================
// Read
// ============================================================================

export async function listDecks(location: DeckLocation): Promise<DeckSummary[]> {
  const collectionPath = decksPath(location);
  const { documents } = await listDocuments(collectionPath, { pageSize: 100 });
  return documents.map((doc) => {
    const markdown = typeof doc.markdown === 'string' ? doc.markdown : '';
    const slideOffsets = Array.isArray(doc.slideOffsets)
      ? (doc.slideOffsets as unknown[]).filter((o): o is number => typeof o === 'number')
      : [];
    return {
      id: String(doc.id ?? ''),
      title: typeof doc.title === 'string' ? doc.title : 'Untitled deck',
      themeId: typeof doc.themeId === 'string' ? doc.themeId : 'default',
      slideCount: (slideOffsets.length ? slideOffsets.length : countSlidesFromMarkdown(markdown)) + 1,
      version: typeof doc.version === 'number' ? doc.version : 0,
      updatedAt: toDate(doc.updatedAt),
    };
  });
}

export async function getDeck(
  location: DeckLocation,
  deckId: string,
): Promise<Deck | null> {
  const doc = await getDocument(decksPath(location), deckId);
  if (!doc) return null;
  const markdown = typeof doc.markdown === 'string' ? doc.markdown : '';
  const rawOffsets = Array.isArray(doc.slideOffsets)
    ? (doc.slideOffsets as unknown[]).filter((n): n is number => typeof n === 'number')
    : [];
  return {
    id: String(doc.id ?? deckId),
    canvasId: typeof doc.canvasId === 'string' ? doc.canvasId : location.canvasId,
    title: typeof doc.title === 'string' ? doc.title : 'Untitled deck',
    themeId: typeof doc.themeId === 'string' ? doc.themeId : 'default',
    markdown,
    slideOffsets: rawOffsets.length > 0 ? rawOffsets : computeSlideOffsets(markdown),
    aspectRatio: doc.aspectRatio === '4:3' ? '4:3' : '16:9',
    thumbnails: Array.isArray(doc.thumbnails)
      ? (doc.thumbnails as unknown[]).filter((t): t is string => typeof t === 'string')
      : undefined,
    version: typeof doc.version === 'number' ? doc.version : 0,
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt),
    updatedBy: typeof doc.updatedBy === 'string' ? doc.updatedBy : undefined,
    // `_updateTime` is injected by our getDocument wrapper below when
    // available; otherwise undefined and we fall back to create semantics.
    updateTime: typeof doc._updateTime === 'string' ? doc._updateTime : undefined,
  };
}

// ============================================================================
// Create / update
// ============================================================================

export async function createDeck(
  location: DeckLocation,
  input: { id: string; title: string; themeId?: string; markdown?: string; aspectRatio?: '16:9' | '4:3'; updatedBy: string },
): Promise<Deck> {
  const markdown = input.markdown ?? '';
  const now = new Date();
  const data = {
    canvasId: location.canvasId,
    title: input.title,
    themeId: input.themeId ?? 'default',
    markdown,
    slideOffsets: computeSlideOffsets(markdown),
    aspectRatio: input.aspectRatio ?? '16:9',
    thumbnails: [],
    version: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
  await createDocument(decksPath(location), input.id, data);
  return { id: input.id, ...data } as Deck;
}

export interface ImportDeckOptions {
  deckId: string;
  markdown: string;
  updatedBy: string;
  themeId?: string;
  /**
   * Server updateTime read from the deck before commit. If the server
   * has moved past this, the write fails with FAILED_PRECONDITION —
   * surface that as a conflict instead of overwriting.
   */
  ifUpdateTime?: string;
}

export type ImportDeckResult =
  | { ok: true; deck: Deck }
  | { ok: false; reason: 'not-found' | 'conflict' | 'write-failed'; error?: unknown };

/**
 * Replace a deck's markdown (and optional themeId). Version is bumped
 * server-side by the browser path; the CLI mirrors that by setting
 * `version = previous + 1` in the patch payload. Optimistic concurrency
 * via `currentDocument.updateTime` precondition.
 */
export async function importDeckMarkdown(
  location: DeckLocation,
  options: ImportDeckOptions,
): Promise<ImportDeckResult> {
  const existing = await getDeck(location, options.deckId);
  if (!existing) return { ok: false, reason: 'not-found' };

  const now = new Date();
  const fields: Record<string, unknown> = {
    markdown: options.markdown,
    slideOffsets: computeSlideOffsets(options.markdown),
    version: existing.version + 1,
    updatedAt: now,
    updatedBy: options.updatedBy,
  };
  if (options.themeId) fields.themeId = options.themeId;

  try {
    await patchWithPrecondition(
      decksPath(location),
      options.deckId,
      fields,
      options.ifUpdateTime ?? existing.updateTime,
    );
    // Re-fetch to return the canonical post-write state.
    const next = await getDeck(location, options.deckId);
    if (!next) return { ok: false, reason: 'not-found' };
    return { ok: true, deck: next };
  } catch (err) {
    if (err instanceof Error && /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(err.message)) {
      return { ok: false, reason: 'conflict', error: err };
    }
    return { ok: false, reason: 'write-failed', error: err };
  }
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
    log.warn('patchWithPrecondition failed', { status: response.status, text: text.slice(0, 200) });
    throw new Error(`Firestore PATCH failed: ${response.status} ${text.slice(0, 200)}`);
  }
}

const SLIDE_SEPARATOR_RE = /(^|\n)---(?:\s*$|\s*\n)/g;

export function computeSlideOffsets(markdown: string): number[] {
  const offsets: number[] = [];
  SLIDE_SEPARATOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SLIDE_SEPARATOR_RE.exec(markdown)) !== null) {
    offsets.push(match.index + match[0].length);
  }
  return offsets;
}

function countSlidesFromMarkdown(markdown: string): number {
  return computeSlideOffsets(markdown).length;
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

// ============================================================================
// Delete
// ============================================================================

export async function deleteDeck(
  location: DeckLocation,
  deckId: string,
): Promise<void> {
  await deleteDocument(decksPath(location), deckId);
}

// ============================================================================
// Themes
// ============================================================================

export interface SlideThemeSummary {
  id: string;
  name: string;
  description?: string;
  isBuiltIn: boolean;
  preview?: {
    background?: string;
    foreground?: string;
    accent?: string;
  };
}

/**
 * Built-in themes shipped with the main app (mirror of
 * `canvas-types/slides/themes/builtInThemes.ts`). Re-stated here so the
 * CLI doesn't have to reach into the main project — keep this in sync
 * when the main project adds or renames a built-in.
 */
export const BUILT_IN_THEMES: ReadonlyArray<SlideThemeSummary> = Object.freeze([
  {
    id: 'default',
    name: 'default',
    description: 'Marp default — neutral GitHub-inspired palette',
    isBuiltIn: true,
    preview: { background: '#ffffff', foreground: '#1f2328', accent: '#0969da' },
  },
  {
    id: 'gaia',
    name: 'gaia',
    description: 'Marp Gaia — clean serif, soft palette (fonts self-hosted)',
    isBuiltIn: true,
    preview: { background: '#f3f3f3', foreground: '#333333', accent: '#009688' },
  },
  {
    id: 'uncover',
    name: 'uncover',
    description: 'Marp Uncover — minimal typography-first',
    isBuiltIn: true,
    preview: { background: '#fdf6e3', foreground: '#586e75', accent: '#268bd2' },
  },
  {
    id: 'myndhyve',
    name: 'myndhyve',
    description: 'MyndHyve — dark deep-blue deck with emerald accents',
    isBuiltIn: true,
    preview: { background: '#0b1020', foreground: '#f4f7fb', accent: '#6ee7b7' },
  },
]);

/**
 * List workspace-custom themes stored at
 * `workspaces/{workspaceId}/slideThemes/{themeId}`.
 */
export async function listCustomThemes(
  workspaceId: string,
): Promise<SlideThemeSummary[]> {
  try {
    const { documents } = await listDocuments(
      `workspaces/${workspaceId}/slideThemes`,
      { pageSize: 100 },
    );
    return documents.map((doc) => ({
      id: String(doc.id ?? ''),
      name: typeof doc.name === 'string' ? doc.name : String(doc.id ?? ''),
      description: typeof doc.description === 'string' ? doc.description : undefined,
      isBuiltIn: false,
      preview: doc.preview as SlideThemeSummary['preview'] | undefined,
    }));
  } catch (err) {
    // The collection may not exist until the workspace uploads its first
    // custom theme — treat "not found" as an empty list, not an error.
    log.debug('listCustomThemes: no custom themes (or read failed)', {
      workspaceId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return [];
  }
}

/**
 * All themes available to a workspace — built-ins first, then custom
 * themes sorted by name. Mirrors `listAllThemes()` in the main project.
 */
export async function listAllThemes(
  workspaceId: string,
): Promise<SlideThemeSummary[]> {
  const custom = await listCustomThemes(workspaceId);
  const customSorted = [...custom].sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILT_IN_THEMES, ...customSorted];
}
