/**
 * MyndHyve CLI — CRM API
 *
 * Operations for CRM entities via Firestore REST API.
 * All CRM data is user-scoped at `users/{userId}/crm/{collection}/{entityId}`.
 *
 * Entity types: contacts, activities, tasks, deals, sequences,
 * customers, orders, products, coupons, affiliates
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

/** Valid CRM collection names (Firestore subcollections under users/{uid}/crm/). */
export type CrmCollection =
  | 'contacts'
  | 'activities'
  | 'tasks'
  | 'deals'
  | 'sequences'
  | 'customers'
  | 'orders'
  | 'products'
  | 'coupons'
  | 'affiliates';

/** All valid CRM collections. */
export const CRM_COLLECTIONS: CrmCollection[] = [
  'contacts',
  'activities',
  'tasks',
  'deals',
  'sequences',
  'customers',
  'orders',
  'products',
  'coupons',
  'affiliates',
];

/** Lightweight entity summary for list display. */
export interface CrmEntitySummary {
  id: string;
  collection: CrmCollection;
  name: string;
  status?: string;
  email?: string;
  tags?: string[];
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
  deals: number;
  orders: number;
  products: number;
  customers: number;
}

// ============================================================================
// COLLECTION PATH HELPER
// ============================================================================

function crmPath(userId: string, collection: CrmCollection): string {
  return `users/${userId}/crm/${collection}`;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * List entities in a CRM collection.
 */
export async function listCrmEntities(
  userId: string,
  collection: CrmCollection,
  options?: {
    status?: string;
    tag?: string;
    limit?: number;
  }
): Promise<CrmEntitySummary[]> {
  const path = crmPath(userId, collection);

  log.debug('Listing CRM entities', { userId, collection, options });

  if (options?.status || options?.tag) {
    const filters: QueryFilter[] = [];
    if (options.status) {
      filters.push({ field: 'status', op: 'EQUAL', value: options.status });
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
  userId: string,
  collection: CrmCollection,
  entityId: string
): Promise<CrmEntityDetail | null> {
  const path = crmPath(userId, collection);

  log.debug('Getting CRM entity', { userId, collection, entityId });

  const doc = await getDocument(path, entityId);
  if (!doc) return null;

  return toEntityDetail(doc, collection);
}

/**
 * Create a new CRM entity.
 */
export async function createCrmEntity(
  userId: string,
  collection: CrmCollection,
  entityId: string,
  data: Record<string, unknown>
): Promise<CrmEntityDetail> {
  const path = crmPath(userId, collection);

  log.debug('Creating CRM entity', { userId, collection, entityId });

  const now = new Date().toISOString();
  const entityData = {
    ...data,
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
  userId: string,
  collection: CrmCollection,
  entityId: string,
  data: Record<string, unknown>
): Promise<CrmEntityDetail> {
  const path = crmPath(userId, collection);

  log.debug('Updating CRM entity', { userId, collection, entityId });

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
  userId: string,
  collection: CrmCollection,
  entityId: string
): Promise<void> {
  const path = crmPath(userId, collection);

  log.debug('Deleting CRM entity', { userId, collection, entityId });

  await deleteDocument(path, entityId);
}

/**
 * Get CRM overview stats (document counts per collection).
 */
export async function getCrmStats(userId: string): Promise<CrmStats> {
  const counts = await Promise.all(
    (['contacts', 'deals', 'orders', 'products', 'customers'] as const).map(
      async (col) => {
        try {
          const { documents } = await listDocuments(crmPath(userId, col), { pageSize: 1 });
          // REST API doesn't have a count query — use list with pageSize 1 as a proxy.
          // For accurate counts, we'd need a Cloud Function or aggregation query.
          return documents.length > 0 ? -1 : 0; // -1 = "has data" (we can't get exact count cheaply)
        } catch {
          return 0;
        }
      }
    )
  );

  return {
    contacts: counts[0],
    deals: counts[1],
    orders: counts[2],
    products: counts[3],
    customers: counts[4],
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function toEntitySummary(
  doc: Record<string, unknown>,
  collection: CrmCollection
): CrmEntitySummary {
  // Extract a display name — different entities use different fields
  const name =
    (doc.name as string) ||
    (doc.firstName && doc.lastName
      ? `${doc.firstName} ${doc.lastName}`
      : undefined) ||
    (doc.email as string) ||
    (doc.title as string) ||
    (doc.subject as string) ||
    (doc.id as string) ||
    'Untitled';

  return {
    id: doc.id as string,
    collection,
    name,
    status: doc.status as string | undefined,
    email: doc.email as string | undefined,
    tags: doc.tags as string[] | undefined,
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
