/**
 * MyndHyve CLI — Project API
 *
 * CRUD operations for MyndHyve projects via Firestore REST API.
 * Projects are stored at the top-level `projects/{projectId}` collection
 * and are filtered by ownerId for the authenticated user.
 */

import { randomBytes } from 'node:crypto';
import {
  getDocument,
  createDocument,
  deleteDocument,
  updateDocument,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ProjectAPI');

// ============================================================================
// TYPES
// ============================================================================

/** Lightweight project summary for list display. */
export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  hyveId: string;
  status: string;
  type: string;
  description?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** Full project detail (from Firestore). */
export interface ProjectDetail extends ProjectSummary {
  ownerId: string;
  ownerType: string;
  collaboratorIds: string[];
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  thumbnailUrl?: string;
  color?: string;
  icon?: string;
  archived?: boolean;
}

/** Options for creating a new project. */
export interface CreateProjectOptions {
  name: string;
  hyveId: string;
  description?: string;
  type?: string;
  tags?: string[];
}

// ============================================================================
// COLLECTION
// ============================================================================

const COLLECTION = 'projects';

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * List all projects owned by or shared with the given user.
 *
 * @param userId - The authenticated user's UID
 * @param options - Optional filters
 * @returns Array of project summaries, sorted by updatedAt descending
 */
export async function listProjects(
  userId: string,
  options?: { hyveId?: string; status?: string }
): Promise<ProjectSummary[]> {
  const filters: QueryFilter[] = [
    { field: 'ownerId', op: 'EQUAL', value: userId },
  ];

  if (options?.hyveId) {
    filters.push({ field: 'hyveId', op: 'EQUAL', value: options.hyveId });
  }

  if (options?.status) {
    filters.push({ field: 'status', op: 'EQUAL', value: options.status });
  }

  log.debug('Listing projects', { userId, filters: filters.length });

  const results = await runQuery(COLLECTION, filters, {
    orderBy: 'metadata.updatedAt',
    orderDirection: 'DESCENDING',
    limit: 100,
  });

  return results.map(toProjectSummary);
}

/**
 * Get full project details by ID.
 *
 * @param projectId - The project ID
 * @returns Project detail or null if not found
 */
export async function getProject(
  projectId: string
): Promise<ProjectDetail | null> {
  log.debug('Getting project', { projectId });

  const doc = await getDocument(COLLECTION, projectId);
  if (!doc) return null;

  return toProjectDetail(doc);
}

/**
 * Create a new project.
 *
 * @param userId - The authenticated user's UID
 * @param options - Project creation options
 * @returns The created project detail
 */
export async function createProject(
  userId: string,
  options: CreateProjectOptions
): Promise<ProjectDetail> {
  const projectId = generateProjectId();
  const now = new Date().toISOString();
  const slug = toSlug(options.name);

  const projectData: Record<string, unknown> = {
    name: options.name,
    slug,
    description: options.description || '',
    hyveId: options.hyveId,
    ownerId: userId,
    ownerType: 'user',
    type: options.type || 'general',
    status: 'draft',
    collaborators: {},
    collaboratorIds: [],
    tags: options.tags || [],
    settings: {
      collaborationEnabled: false,
      versionHistoryEnabled: true,
      autoSaveInterval: 30000,
    },
    metadata: {
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      visibility: 'private',
      documentCount: 0,
      workflowCount: 0,
      artifactCount: 0,
    },
  };

  log.debug('Creating project', { projectId, name: options.name });

  const result = await createDocument(COLLECTION, projectId, projectData);
  return toProjectDetail(result);
}

/**
 * Delete a project by ID.
 *
 * @param projectId - The project ID to delete
 */
export async function deleteProjectById(projectId: string): Promise<void> {
  log.debug('Deleting project', { projectId });
  await deleteDocument(COLLECTION, projectId);
}

/**
 * Update a project's fields.
 *
 * @param projectId - The project ID
 * @param updates - Fields to update
 * @returns Updated project detail
 */
export async function updateProject(
  projectId: string,
  updates: Partial<Pick<ProjectDetail, 'name' | 'description' | 'status' | 'tags'>>
): Promise<ProjectDetail> {
  const data: Record<string, unknown> = {};
  const fieldPaths: string[] = [];

  if (updates.name !== undefined) {
    data.name = updates.name;
    fieldPaths.push('name');
  }
  if (updates.description !== undefined) {
    data.description = updates.description;
    fieldPaths.push('description');
  }
  if (updates.status !== undefined) {
    data.status = updates.status;
    fieldPaths.push('status');
  }
  if (updates.tags !== undefined) {
    data.tags = updates.tags;
    fieldPaths.push('tags');
  }

  // Always update the timestamp
  data['metadata.updatedAt'] = new Date().toISOString();
  fieldPaths.push('metadata.updatedAt');

  const result = await updateDocument(COLLECTION, projectId, data, fieldPaths);
  return toProjectDetail(result);
}

// ============================================================================
// HELPERS
// ============================================================================

function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `proj_${timestamp}_${random}`;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function toProjectSummary(doc: Record<string, unknown>): ProjectSummary {
  const metadata = (doc.metadata || {}) as Record<string, unknown>;
  return {
    id: doc.id as string,
    name: (doc.name as string) || 'Untitled',
    slug: (doc.slug as string) || '',
    hyveId: (doc.hyveId as string) || '',
    status: (doc.status as string) || 'draft',
    type: (doc.type as string) || 'general',
    description: doc.description as string | undefined,
    tags: doc.tags as string[] | undefined,
    createdAt: metadata.createdAt as string | undefined,
    updatedAt: metadata.updatedAt as string | undefined,
  };
}

function toProjectDetail(doc: Record<string, unknown>): ProjectDetail {
  const summary = toProjectSummary(doc);
  return {
    ...summary,
    ownerId: (doc.ownerId as string) || '',
    ownerType: (doc.ownerType as string) || 'user',
    collaboratorIds: (doc.collaboratorIds as string[]) || [],
    settings: (doc.settings as Record<string, unknown>) || {},
    metadata: (doc.metadata as Record<string, unknown>) || {},
    thumbnailUrl: doc.thumbnailUrl as string | undefined,
    color: doc.color as string | undefined,
    icon: doc.icon as string | undefined,
    archived: doc.archived as boolean | undefined,
  };
}
