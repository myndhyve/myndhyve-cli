/**
 * MyndHyve CLI — Hyve Document API
 *
 * Operations for HyveDocuments (user work items within system hyves)
 * via Firestore REST API. Documents are stored at
 * `users/{userId}/hyveDocuments/{docId}`.
 *
 * Also provides access to system hyve metadata (hardcoded, same as web app).
 */

import {
  getDocument,
  listDocuments,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('HyveAPI');

// ============================================================================
// SYSTEM HYVE TYPES
// ============================================================================

/** System hyve metadata (mirrors HyveManifestLite from web app). */
export interface SystemHyve {
  hyveId: string;
  name: string;
  description: string;
  icon: string;
  tier: 'user' | 'team' | 'platform';
  visibility: 'public' | 'internal';
  primaryColor: string;
  tags: string[];
  helpTopicId?: string;
}

/**
 * System hyves — hardcoded to match the web app's `src/hyves/manifests.ts`.
 * These are platform-level apps, not user-created content.
 */
export const SYSTEM_HYVES: SystemHyve[] = [
  {
    hyveId: 'app-builder',
    name: 'App Builder',
    description: 'AI-assisted application development - from idea to code. Generate PRDs, design screens, and build complete applications.',
    icon: 'Layers',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#8b5cf6',
    tags: ['app-development', 'code-generation', 'ai-assisted', 'full-stack'],
    helpTopicId: 'hyve-app-builder',
  },
  {
    hyveId: 'slides',
    name: 'Slides',
    description: 'AI-assisted presentation creation - from outline to polished deck. Generate slides, apply themes, and create compelling presentations.',
    icon: 'Presentation',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#3b82f6',
    tags: ['presentations', 'slides', 'ai-assisted', 'design'],
    helpTopicId: 'hyve-slides',
  },
  {
    hyveId: 'drawings',
    name: 'Drawings',
    description: 'AI-assisted digital illustration - from sketch to finished artwork. Create drawings with intelligent brush tools and color suggestions.',
    icon: 'PenTool',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#10b981',
    tags: ['illustration', 'drawing', 'ai-assisted', 'art'],
    helpTopicId: 'hyve-drawings',
  },
  {
    hyveId: 'hyve-maker',
    name: 'Hyve Maker',
    description: 'Build custom Hyves through AI-assisted design. Create PRDs, design workflows, and generate prompts through conversational interaction.',
    icon: 'Puzzle',
    tier: 'platform',
    visibility: 'internal',
    primaryColor: '#f59e0b',
    tags: ['meta-hyve', 'hyve-builder', 'ai-assisted', 'workflow-design'],
    helpTopicId: 'hyve-hyve-maker',
  },
  {
    hyveId: 'hyve-builder',
    name: 'Hyve Builder',
    description: 'AI-assisted Hyve creation using the workflow engine. Create PRDs, prompts, workflows, schemas, and integrations through step-by-step approval.',
    icon: 'Puzzle',
    tier: 'platform',
    visibility: 'internal',
    primaryColor: '#f59e0b',
    tags: ['meta-hyve', 'hyve-builder', 'ai-assisted', 'workflow-design', 'envelope-protocol'],
    helpTopicId: 'hyve-hyve-builder',
  },
  {
    hyveId: 'cad',
    name: 'CAD Designer',
    description: '3D CAD design with parametric dimensions and constraints. Create 3D models with precision using primitives, transforms, and constraints.',
    icon: 'Box',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#22d3ee',
    tags: ['3d-design', 'cad', 'parametric', 'modeling', 'webgl'],
    helpTopicId: 'hyve-cad',
  },
  {
    hyveId: 'landing-page',
    name: 'LandingPage Canvas',
    description: 'Create marketing landing pages with drag-and-drop sections, AI-assisted content, responsive design, and lead capture forms.',
    icon: 'Globe',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#0ea5e9',
    tags: ['landing-page', 'marketing', 'lead-generation', 'conversion', 'responsive', 'seo'],
    helpTopicId: 'hyve-landing-page',
  },
];

// ============================================================================
// SYSTEM HYVE FUNCTIONS
// ============================================================================

/**
 * List all system hyves.
 *
 * @param includeInternal - Whether to include internal-visibility hyves
 * @returns Array of system hyve metadata
 */
export function listSystemHyves(includeInternal = false): SystemHyve[] {
  if (includeInternal) return [...SYSTEM_HYVES];
  return SYSTEM_HYVES.filter((h) => h.visibility === 'public');
}

/**
 * Get a system hyve by ID.
 *
 * @param hyveId - The hyve ID
 * @returns System hyve metadata or null if not found
 */
export function getSystemHyve(hyveId: string): SystemHyve | null {
  return SYSTEM_HYVES.find((h) => h.hyveId === hyveId) || null;
}

/**
 * Check if a hyve ID corresponds to a valid system hyve.
 */
export function isValidSystemHyveId(hyveId: string): boolean {
  return SYSTEM_HYVES.some((h) => h.hyveId === hyveId);
}

// ============================================================================
// HYVE DOCUMENT TYPES
// ============================================================================

/** Lightweight hyve document summary for list display. */
export interface HyveDocumentSummary {
  id: string;
  hyveId: string;
  name: string;
  slug: string;
  status: string;
  pinned: boolean;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
}

/** Full hyve document detail. */
export interface HyveDocumentDetail extends HyveDocumentSummary {
  ownerId: string;
  ownerType: string;
  description?: string;
  visibility: string;
  version: number;
  collaboratorIds: string[];
  activeWorkflowId?: string;
  settings?: Record<string, unknown>;
}

// ============================================================================
// HYVE DOCUMENT API
// ============================================================================

/**
 * List hyve documents for a user.
 *
 * @param userId - The authenticated user's UID
 * @param options - Optional filters
 * @returns Array of hyve document summaries
 */
export async function listHyveDocuments(
  userId: string,
  options?: { hyveId?: string; status?: string; pinned?: boolean }
): Promise<HyveDocumentSummary[]> {
  const collectionPath = `users/${userId}/hyveDocuments`;

  log.debug('Listing hyve documents', { userId, options });

  // Use query if filters are needed, otherwise list all
  if (options?.hyveId || options?.status || options?.pinned !== undefined) {
    const filters: QueryFilter[] = [];
    if (options.hyveId) {
      filters.push({ field: 'hyveId', op: 'EQUAL', value: options.hyveId });
    }
    if (options.status) {
      filters.push({ field: 'status', op: 'EQUAL', value: options.status });
    }
    if (options.pinned !== undefined) {
      filters.push({ field: 'pinned', op: 'EQUAL', value: options.pinned });
    }

    const results = await runQuery(collectionPath, filters, {
      limit: 100,
    });

    return results.map(toDocumentSummary);
  }

  // No filters — list all documents
  const { documents } = await listDocuments(collectionPath, { pageSize: 100 });
  return documents.map(toDocumentSummary);
}

/**
 * Get full hyve document details by ID.
 *
 * @param userId - The user's UID
 * @param documentId - The hyve document ID
 * @returns Document detail or null if not found
 */
export async function getHyveDocument(
  userId: string,
  documentId: string
): Promise<HyveDocumentDetail | null> {
  const collectionPath = `users/${userId}/hyveDocuments`;

  log.debug('Getting hyve document', { userId, documentId });

  const doc = await getDocument(collectionPath, documentId);
  if (!doc) return null;

  return toDocumentDetail(doc);
}

// ============================================================================
// HELPERS
// ============================================================================

function toDocumentSummary(doc: Record<string, unknown>): HyveDocumentSummary {
  return {
    id: doc.id as string,
    hyveId: (doc.hyveId as string) || '',
    name: (doc.name as string) || 'Untitled',
    slug: (doc.slug as string) || '',
    status: (doc.status as string) || 'draft',
    pinned: (doc.pinned as boolean) || false,
    tags: (doc.tags as string[]) || [],
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
    lastOpenedAt: doc.lastOpenedAt as string | undefined,
  };
}

function toDocumentDetail(doc: Record<string, unknown>): HyveDocumentDetail {
  const summary = toDocumentSummary(doc);
  return {
    ...summary,
    ownerId: (doc.ownerId as string) || '',
    ownerType: (doc.ownerType as string) || 'user',
    description: doc.description as string | undefined,
    visibility: (doc.visibility as string) || 'private',
    version: (doc.version as number) || 1,
    collaboratorIds: (doc.collaboratorIds as string[]) || [],
    activeWorkflowId: doc.activeWorkflowId as string | undefined,
    settings: doc.settings as Record<string, unknown> | undefined,
  };
}
