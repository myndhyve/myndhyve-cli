/**
 * MyndHyve CLI — Entity API
 *
 * Interacts with the entityApi Cloud Function for CRUD operations
 * on structured entities within projects.
 *
 * @see functions/src/entities/ — server endpoints
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('EntityAPI');

// ============================================================================
// TYPES
// ============================================================================

export interface EntitySummary {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface EntityDetail extends EntitySummary {
  data: Record<string, unknown>;
  taxonomies?: Record<string, string[]>;
  meta?: Record<string, unknown>;
}

export interface CreateEntityInput {
  title: string;
  data: Record<string, unknown>;
  status?: 'draft' | 'published' | 'archived';
  slug?: string;
  taxonomies?: Record<string, string[]>;
  meta?: Record<string, unknown>;
}

export interface UpdateEntityInput {
  title?: string;
  data?: Record<string, unknown>;
  status?: 'draft' | 'published' | 'archived';
  slug?: string;
  meta?: Record<string, unknown>;
}

export interface PaginatedEntities {
  data: EntitySummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ListEntitiesOptions {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

function basePath(projectId: string, entityTypeId: string): string {
  return `/entityApi/api/v1/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(entityTypeId)}`;
}

/**
 * List entities of a given type within a project.
 */
export async function listEntities(
  projectId: string,
  entityTypeId: string,
  options?: ListEntitiesOptions
): Promise<PaginatedEntities> {
  const client = getAPIClient();
  const query: Record<string, string> = {};

  if (options?.page) query.page = String(options.page);
  if (options?.limit) query.limit = String(options.limit);
  if (options?.status) query.status = options.status;
  if (options?.search) query.search = options.search;
  if (options?.sortField) query.sortField = options.sortField;
  if (options?.sortDirection) query.sortDirection = options.sortDirection;

  log.debug('Listing entities', { projectId, entityTypeId });
  return client.get<PaginatedEntities>(
    basePath(projectId, entityTypeId),
    Object.keys(query).length > 0 ? query : undefined
  );
}

/**
 * Get a single entity by ID.
 */
export async function getEntity(
  projectId: string,
  entityTypeId: string,
  entityId: string
): Promise<EntityDetail | null> {
  const client = getAPIClient();
  log.debug('Getting entity', { projectId, entityTypeId, entityId });

  try {
    const response = await client.get<{ data: EntityDetail }>(
      `${basePath(projectId, entityTypeId)}/${encodeURIComponent(entityId)}`
    );
    return response.data;
  } catch {
    return null;
  }
}

/**
 * Create a new entity.
 */
export async function createEntity(
  projectId: string,
  entityTypeId: string,
  input: CreateEntityInput
): Promise<EntityDetail> {
  const client = getAPIClient();
  log.debug('Creating entity', { projectId, entityTypeId, title: input.title });
  const response = await client.post<{ data: EntityDetail }>(
    basePath(projectId, entityTypeId),
    input
  );
  return response.data;
}

/**
 * Update an existing entity.
 */
export async function updateEntity(
  projectId: string,
  entityTypeId: string,
  entityId: string,
  input: UpdateEntityInput
): Promise<EntityDetail> {
  const client = getAPIClient();
  log.debug('Updating entity', { projectId, entityTypeId, entityId });

  const response = await client.patch<{ data: EntityDetail }>(
    `${basePath(projectId, entityTypeId)}/${encodeURIComponent(entityId)}`,
    input
  );
  return response.data;
}

/**
 * Delete an entity.
 */
export async function deleteEntity(
  projectId: string,
  entityTypeId: string,
  entityId: string
): Promise<void> {
  const client = getAPIClient();
  log.debug('Deleting entity', { projectId, entityTypeId, entityId });
  await client.delete(
    `${basePath(projectId, entityTypeId)}/${encodeURIComponent(entityId)}`
  );
}

/**
 * Export all entities of a type.
 */
export async function exportEntities(
  projectId: string,
  entityTypeId: string
): Promise<unknown[]> {
  const client = getAPIClient();
  log.debug('Exporting entities', { projectId, entityTypeId });
  return client.get<unknown[]>(`${basePath(projectId, entityTypeId)}/export`);
}

/**
 * Import entities from an array.
 */
export async function importEntities(
  projectId: string,
  entityTypeId: string,
  data: unknown[]
): Promise<{ imported: number; errors: number }> {
  const client = getAPIClient();
  log.debug('Importing entities', { projectId, entityTypeId, count: data.length });
  return client.post<{ imported: number; errors: number }>(
    `${basePath(projectId, entityTypeId)}/import`,
    { entities: data }
  );
}
