/**
 * MyndHyve CLI — CRM API
 *
 * Operations for CRM entities via Firestore REST API.
 *
 * Supports two path modes:
 * - User-scoped: `users/{userId}/crm/{collection}/{entityId}`
 * - Workspace-scoped: `workspaces/{workspaceId}/crm/{collection}/{entityId}`
 *
 * Entity types: contacts, companies, activities, tasks, deals, sequences,
 * customers, orders, products, coupons, affiliates, emails, calls,
 * meetings, enrollments, quotes, associations, pipelines, stages
 */

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CrmAPI');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Valid CRM collection names.
 * Path: users/{uid}/crm/{collection} (user-scoped, legacy)
 * Path: workspaces/{wsId}/crm/{collection} (workspace-scoped, Phase 1+)
 */
export type CrmCollection =
  | 'contacts'
  | 'companies'
  | 'activities'
  | 'tasks'
  | 'deals'
  | 'sequences'
  | 'customers'
  | 'orders'
  | 'products'
  | 'coupons'
  | 'affiliates'
  | 'emails'
  | 'calls'
  | 'meetings'
  | 'enrollments'
  | 'quotes'
  | 'associations'
  | 'pipelines'
  | 'stages';

/** All valid CRM collections. */
export const CRM_COLLECTIONS: CrmCollection[] = [
  'contacts',
  'companies',
  'activities',
  'tasks',
  'deals',
  'sequences',
  'customers',
  'orders',
  'products',
  'coupons',
  'affiliates',
  'emails',
  'calls',
  'meetings',
  'enrollments',
  'quotes',
  'associations',
  'pipelines',
  'stages',
];

/** Lightweight entity summary for list display. */
export interface CrmEntitySummary {
  id: string;
  collection: CrmCollection;
  name: string;
  status?: string;
  email?: string;
  tags?: string[];
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Full entity detail (raw Firestore fields). */
export interface CrmEntityDetail extends CrmEntitySummary {
  [key: string]: unknown;
}

/** CRM overview stats. */
export interface CrmStats {
  contacts: number;
  companies: number;
  deals: number;
  orders: number;
  products: number;
  customers: number;
  quotes: number;
}

/** CRM scope context — determines Firestore path. */
export interface CrmScope {
  /** User ID (always required for user-scoped) */
  userId: string;
  /** Workspace ID (if set, uses workspace-scoped path) */
  workspaceId?: string;
}

// ============================================================================
// COLLECTION PATH HELPER
// ============================================================================

/**
 * Build the Firestore collection path for CRM entities.
 * Uses workspace path when workspaceId is provided, otherwise user path.
 */
function crmPath(scope: CrmScope, collection: CrmCollection): string {
  if (scope.workspaceId) {
    return `workspaces/${scope.workspaceId}/crm/${collection}`;
  }
  return `users/${scope.userId}/crm/${collection}`;
}

/** @deprecated Use CrmScope overload. Kept for backward compatibility. */
function crmPathLegacy(userId: string, collection: CrmCollection): string {
  return `users/${userId}/crm/${collection}`;
}

function resolveScope(userIdOrScope: string | CrmScope): CrmScope {
  if (typeof userIdOrScope === 'string') {
    return { userId: userIdOrScope };
  }
  return userIdOrScope;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * List entities in a CRM collection.
 *
 * @param userIdOrScope - User ID string (legacy) or CrmScope object
 */
export async function listCrmEntities(
  userIdOrScope: string | CrmScope,
  collection: CrmCollection,
  options?: {
    status?: string;
    ownerId?: string;
    tag?: string;
    limit?: number;
  }
): Promise<CrmEntitySummary[]> {
  const scope = resolveScope(userIdOrScope);
  const path = crmPath(scope, collection);

  log.debug('Listing CRM entities', { scope, collection, options });

  if (options?.status || options?.tag || options?.ownerId) {
    const filters: QueryFilter[] = [];
    if (options.status) {
      filters.push({ field: 'status', op: 'EQUAL', value: options.status });
    }
    if (options.ownerId) {
      filters.push({ field: 'ownerId', op: 'EQUAL', value: options.ownerId });
    }
    if (options.tag) {
      filters.push({ field: 'tags', op: 'ARRAY_CONTAINS', value: options.tag });
    }

    const results = await runQuery(path, filters, {
      limit: options?.limit ?? 100,
    });
    return results.map((doc) => toEntitySummary(doc, collection));
  }

  const { documents } = await listDocuments(path, {
    pageSize: options?.limit ?? 100,
  });
  return documents.map((doc) => toEntitySummary(doc, collection));
}

/**
 * Get a single CRM entity by ID.
 */
export async function getCrmEntity(
  userIdOrScope: string | CrmScope,
  collection: CrmCollection,
  entityId: string
): Promise<CrmEntityDetail | null> {
  const scope = resolveScope(userIdOrScope);
  const path = crmPath(scope, collection);

  log.debug('Getting CRM entity', { scope, collection, entityId });

  const doc = await getDocument(path, entityId);
  if (!doc) return null;

  return toEntityDetail(doc, collection);
}

/**
 * Create a new CRM entity.
 */
export async function createCrmEntity(
  userIdOrScope: string | CrmScope,
  collection: CrmCollection,
  entityId: string,
  data: Record<string, unknown>
): Promise<CrmEntityDetail> {
  const scope = resolveScope(userIdOrScope);
  const path = crmPath(scope, collection);

  log.debug('Creating CRM entity', { scope, collection, entityId });

  const now = new Date().toISOString();
  const entityData = {
    ...data,
    ownerId: data.ownerId ?? scope.userId,
    createdAt: now,
    updatedAt: now,
  };

  const doc = await createDocument(path, entityId, entityData);
  return toEntityDetail(doc, collection);
}

/**
 * Update a CRM entity.
 */
export async function updateCrmEntity(
  userIdOrScope: string | CrmScope,
  collection: CrmCollection,
  entityId: string,
  data: Record<string, unknown>
): Promise<CrmEntityDetail> {
  const scope = resolveScope(userIdOrScope);
  const path = crmPath(scope, collection);

  log.debug('Updating CRM entity', { scope, collection, entityId });

  const updateData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  const doc = await updateDocument(path, entityId, updateData);
  return toEntityDetail(doc, collection);
}

/**
 * Delete a CRM entity.
 *
 * Note: Orders and activities have restricted delete in Firestore rules
 * (audit trail enforcement). These calls may fail with PERMISSION_DENIED.
 */
export async function deleteCrmEntity(
  userIdOrScope: string | CrmScope,
  collection: CrmCollection,
  entityId: string
): Promise<void> {
  const scope = resolveScope(userIdOrScope);
  const path = crmPath(scope, collection);

  log.debug('Deleting CRM entity', { scope, collection, entityId });

  await deleteDocument(path, entityId);
}

/**
 * Get CRM overview stats (document counts per collection).
 */
export async function getCrmStats(userIdOrScope: string | CrmScope): Promise<CrmStats> {
  const scope = resolveScope(userIdOrScope);

  const cols = ['contacts', 'companies', 'deals', 'orders', 'products', 'customers', 'quotes'] as const;
  const counts = await Promise.all(
    cols.map(async (col) => {
      try {
        const { documents } = await listDocuments(crmPath(scope, col), { pageSize: 1 });
        return documents.length > 0 ? -1 : 0; // -1 = "has data"
      } catch {
        return 0;
      }
    })
  );

  return {
    contacts: counts[0],
    companies: counts[1],
    deals: counts[2],
    orders: counts[3],
    products: counts[4],
    customers: counts[5],
    quotes: counts[6],
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function toEntitySummary(
  doc: Record<string, unknown>,
  collection: CrmCollection
): CrmEntitySummary {
  const name =
    (doc.name as string) ||
    (doc.firstName && doc.lastName
      ? `${doc.firstName} ${doc.lastName}`
      : undefined) ||
    (doc.email as string) ||
    (doc.title as string) ||
    (doc.subject as string) ||
    (doc.quoteNumber as string) ||
    (doc.orderNumber as string) ||
    (doc.phoneNumber as string) ||
    (doc.id as string) ||
    'Untitled';

  return {
    id: doc.id as string,
    collection,
    name,
    status: doc.status as string | undefined,
    email: doc.email as string | undefined,
    tags: doc.tags as string[] | undefined,
    ownerId: doc.ownerId as string | undefined,
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toEntityDetail(
  doc: Record<string, unknown>,
  collection: CrmCollection
): CrmEntityDetail {
  const summary = toEntitySummary(doc, collection);
  return {
    ...doc,
    ...summary,
  };
}

/**
 * Validate that a string is a valid CRM collection name.
 */
export function isValidCrmCollection(value: string): value is CrmCollection {
  return CRM_COLLECTIONS.includes(value as CrmCollection);
}
