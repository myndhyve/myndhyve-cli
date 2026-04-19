/**
 * MyndHyve CLI — Canvas Type & Canvas API
 *
 * Operations for Canvases (user work items within canvas types)
 * via Firestore REST API. Canvases are stored at
 * `workspaces/{workspaceId}/canvases/{docId}`.
 *
 * Also provides access to canvas type metadata (hardcoded, same as web app).
 */

import {
  getDocument,
  listDocuments,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';
import { resolveCollectionPath, resolveDocumentPath } from '../utils/workspacePaths.js';

const log = createLogger('CanvasTypeAPI');

// ============================================================================
// CANVAS TYPE DEFINITIONS
// ============================================================================

/** Canvas type metadata (mirrors CanvasTypeManifestLite from web app). */
export interface CanvasType {
  canvasTypeId: string;
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
 * Canvas types — hardcoded to match the web app's `src/canvas-types/manifests.ts`.
 * These are platform-level apps, not user-created content.
 */
export const CANVAS_TYPES: CanvasType[] = [
  {
    canvasTypeId: 'app-builder',
    name: 'App Builder',
    description: 'AI-assisted application development - from idea to code. Generate PRDs, design screens, and build complete applications.',
    icon: 'Layers',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#8b5cf6',
    tags: ['app-development', 'code-generation', 'ai-assisted', 'full-stack'],
    helpTopicId: 'canvas-app-builder',
  },
  {
    canvasTypeId: 'slides',
    name: 'Slides',
    description: 'Marp-first presentation authoring — Markdown is the deck. AI edits via slide.deck.* envelopes.',
    icon: 'Presentation',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#3b82f6',
    tags: ['presentations', 'slides', 'marp', 'markdown', 'ai-assisted'],
    helpTopicId: 'canvas-slides',
  },
  {
    canvasTypeId: 'drawings',
    name: 'Drawings',
    description: 'AI-assisted digital illustration - from sketch to finished artwork.',
    icon: 'PenTool',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#10b981',
    tags: ['illustration', 'drawing', 'ai-assisted', 'art'],
    helpTopicId: 'canvas-drawings',
  },
  {
    canvasTypeId: 'canvas-maker',
    name: 'Workspace Maker',
    description: 'Build custom workspaces through AI-assisted design.',
    icon: 'Puzzle',
    tier: 'platform',
    visibility: 'internal',
    primaryColor: '#f59e0b',
    tags: ['meta-canvas', 'canvas-builder', 'ai-assisted', 'workflow-design'],
    helpTopicId: 'canvas-canvas-maker',
  },
  {
    canvasTypeId: 'canvas-builder',
    name: 'Workspace Builder',
    description: 'AI-assisted workspace creation using the workflow engine.',
    icon: 'Puzzle',
    tier: 'platform',
    visibility: 'internal',
    primaryColor: '#f59e0b',
    tags: ['meta-canvas', 'canvas-builder', 'ai-assisted', 'workflow-design', 'envelope-protocol'],
    helpTopicId: 'canvas-canvas-builder',
  },
  {
    canvasTypeId: 'cad',
    name: 'CAD Designer',
    description: '3D CAD design with parametric dimensions and constraints.',
    icon: 'Box',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#22d3ee',
    tags: ['3d-design', 'cad', 'parametric', 'modeling', 'webgl'],
    helpTopicId: 'canvas-cad',
  },
  {
    canvasTypeId: 'campaign-studio',
    name: 'Campaign Studio',
    description: 'Orchestrate marketing campaigns with multi-channel ads, funnels, analytics, commerce, and AI-powered optimization.',
    icon: 'Megaphone',
    tier: 'platform',
    visibility: 'public',
    primaryColor: '#0ea5e9',
    tags: ['campaign-studio', 'marketing', 'campaigns', 'ads', 'funnels', 'analytics'],
    helpTopicId: 'canvas-campaign-studio',
  },
];

// ============================================================================
// CANVAS TYPE FUNCTIONS
// ============================================================================

/**
 * List all canvas types.
 *
 * @param includeInternal - Whether to include internal-visibility canvas types
 * @returns Array of canvas type metadata
 */
export function listCanvasTypes(includeInternal = false): CanvasType[] {
  if (includeInternal) return [...CANVAS_TYPES];
  return CANVAS_TYPES.filter((ct) => ct.visibility === 'public');
}

/**
 * Get a canvas type by ID.
 *
 * @param canvasTypeId - The canvas type ID
 * @returns Canvas type metadata or null if not found
 */
export function getCanvasType(canvasTypeId: string): CanvasType | null {
  return CANVAS_TYPES.find((ct) => ct.canvasTypeId === canvasTypeId) || null;
}

/**
 * Check if an ID corresponds to a valid canvas type.
 */
export function isValidCanvasTypeId(canvasTypeId: string): boolean {
  return CANVAS_TYPES.some((ct) => ct.canvasTypeId === canvasTypeId);
}

// ============================================================================
// CANVAS TYPES (SUMMARY & DETAIL)
// ============================================================================

/** Lightweight canvas summary for list display. */
export interface CanvasSummary {
  id: string;
  canvasTypeId: string;
  name: string;
  slug: string;
  status: string;
  pinned: boolean;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
}

/** Full canvas detail. */
export interface CanvasDetail extends CanvasSummary {
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
// CANVAS API
// ============================================================================

/**
 * List canvases for a user.
 *
 * @param userId - The authenticated user's UID
 * @param options - Optional filters
 * @returns Array of canvas summaries
 */
export async function listCanvases(
  userId: string,
  options?: { canvasTypeId?: string; status?: string; pinned?: boolean }
): Promise<CanvasSummary[]> {
  const collectionPath = resolveCollectionPath(userId, 'canvases');

  log.debug('Listing canvases', { userId, options });

  // Use query if filters are needed, otherwise list all
  if (options?.canvasTypeId || options?.status || options?.pinned !== undefined) {
    const filters: QueryFilter[] = [];
    if (options.canvasTypeId) {
      filters.push({ field: 'canvasTypeId', op: 'EQUAL', value: options.canvasTypeId });
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

    return results.map(toCanvasSummary);
  }

  // No filters — list all canvases
  const { documents } = await listDocuments(collectionPath, { pageSize: 100 });
  return documents.map(toCanvasSummary);
}

/**
 * Get full canvas details by ID.
 *
 * @param userId - The user's UID
 * @param canvasId - The canvas ID
 * @returns Canvas detail or null if not found
 */
export async function getCanvas(
  userId: string,
  canvasId: string
): Promise<CanvasDetail | null> {
  const collectionPath = resolveCollectionPath(userId, 'canvases');

  log.debug('Getting canvas', { userId, canvasId });

  const doc = await getDocument(collectionPath, canvasId);
  if (!doc) return null;

  return toCanvasDetail(doc);
}

// ============================================================================
// HELPERS
// ============================================================================

function toCanvasSummary(doc: Record<string, unknown>): CanvasSummary {
  return {
    id: doc.id as string,
    canvasTypeId: (doc.canvasTypeId as string) || '',
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

function toCanvasDetail(doc: Record<string, unknown>): CanvasDetail {
  const summary = toCanvasSummary(doc);
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
