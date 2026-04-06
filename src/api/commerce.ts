/**
 * MyndHyve CLI — Commerce API
 *
 * Operations for standalone e-commerce entities via Firestore REST API.
 *
 * Firestore paths use the `commerce_` prefix (NOT `crm/`):
 * - User-scoped:      `users/{userId}/commerce_{collection}/{entityId}`
 * - Workspace-scoped: `workspaces/{workspaceId}/commerce_{collection}/{entityId}`
 *
 * Entity types: products, orders, customers, coupons, affiliates
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

const log = createLogger('CommerceAPI');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Valid commerce collection names.
 * Firestore path: `users/{uid}/commerce_{collection}`
 */
export type CommerceCollection =
  | 'products'
  | 'orders'
  | 'customers'
  | 'coupons'
  | 'affiliates';

/** All valid commerce collections. */
export const COMMERCE_COLLECTIONS: CommerceCollection[] = [
  'products',
  'orders',
  'customers',
  'coupons',
  'affiliates',
];

/** Lightweight entity summary for list display. */
export interface CommerceEntitySummary {
  id: string;
  collection: CommerceCollection;
  name: string;
  status?: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Full entity detail (raw Firestore fields). */
export interface CommerceEntityDetail extends CommerceEntitySummary {
  [key: string]: unknown;
}

/** Commerce dashboard stats. */
export interface CommerceStats {
  products: number;
  orders: number;
  customers: number;
  coupons: number;
  affiliates: number;
  /** Total revenue from paid/fulfilled orders (cents). */
  revenue: number;
  /** Number of pending orders. */
  pendingOrders: number;
  /** True if any collection had more documents than the fetch limit (200). */
  truncated: boolean;
}

/** Commerce scope context — determines Firestore path. */
export interface CommerceScope {
  userId: string;
  workspaceId?: string;
}

// ============================================================================
// COLLECTION PATH HELPER
// ============================================================================

/**
 * Build the Firestore collection path for commerce entities.
 * Uses `commerce_` prefix to match the main project's standalone module.
 */
function commercePath(scope: CommerceScope, collection: CommerceCollection): string {
  const wsId = scope.workspaceId ?? `ws-personal-${scope.userId}`;
  return `workspaces/${wsId}/commerce_${collection}`;
}

function resolveScope(userIdOrScope: string | CommerceScope): CommerceScope {
  if (typeof userIdOrScope === 'string') {
    return { userId: userIdOrScope };
  }
  return userIdOrScope;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * List entities in a commerce collection.
 */
export async function listCommerceEntities(
  userIdOrScope: string | CommerceScope,
  collection: CommerceCollection,
  options?: {
    status?: string;
    limit?: number;
  }
): Promise<CommerceEntitySummary[]> {
  const scope = resolveScope(userIdOrScope);
  const path = commercePath(scope, collection);

  log.debug('Listing commerce entities', { scope, collection, options });

  if (options?.status) {
    const filters: QueryFilter[] = [
      { field: 'status', op: 'EQUAL', value: options.status },
    ];

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
 * Get a single commerce entity by ID.
 */
export async function getCommerceEntity(
  userIdOrScope: string | CommerceScope,
  collection: CommerceCollection,
  entityId: string
): Promise<CommerceEntityDetail | null> {
  const scope = resolveScope(userIdOrScope);
  const path = commercePath(scope, collection);

  log.debug('Getting commerce entity', { scope, collection, entityId });

  const doc = await getDocument(path, entityId);
  if (!doc) return null;

  return toEntityDetail(doc, collection);
}

/**
 * Create a new commerce entity.
 */
export async function createCommerceEntity(
  userIdOrScope: string | CommerceScope,
  collection: CommerceCollection,
  entityId: string,
  data: Record<string, unknown>
): Promise<CommerceEntityDetail> {
  const scope = resolveScope(userIdOrScope);
  const path = commercePath(scope, collection);

  log.debug('Creating commerce entity', { scope, collection, entityId });

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
 * Update a commerce entity.
 */
export async function updateCommerceEntity(
  userIdOrScope: string | CommerceScope,
  collection: CommerceCollection,
  entityId: string,
  data: Record<string, unknown>
): Promise<CommerceEntityDetail> {
  const scope = resolveScope(userIdOrScope);
  const path = commercePath(scope, collection);

  log.debug('Updating commerce entity', { scope, collection, entityId });

  const updateData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  const doc = await updateDocument(path, entityId, updateData);
  return toEntityDetail(doc, collection);
}

/**
 * Delete a commerce entity.
 *
 * Note: Orders cannot be deleted (audit trail enforcement in Firestore rules).
 * This call will fail with PERMISSION_DENIED for orders.
 */
export async function deleteCommerceEntity(
  userIdOrScope: string | CommerceScope,
  collection: CommerceCollection,
  entityId: string
): Promise<void> {
  const scope = resolveScope(userIdOrScope);
  const path = commercePath(scope, collection);

  log.debug('Deleting commerce entity', { scope, collection, entityId });

  await deleteDocument(path, entityId);
}

// ============================================================================
// ORDER LIFECYCLE
// ============================================================================

/**
 * Mark an order as fulfilled.
 */
export async function fulfillOrder(
  userIdOrScope: string | CommerceScope,
  orderId: string,
  options?: { trackingNumber?: string; trackingUrl?: string }
): Promise<CommerceEntityDetail> {
  const now = new Date().toISOString();
  const data: Record<string, unknown> = {
    status: 'fulfilled',
    fulfillmentStatus: 'shipped',
    fulfilledAt: now,
  };
  if (options?.trackingNumber) data.trackingNumber = options.trackingNumber;
  if (options?.trackingUrl) data.trackingUrl = options.trackingUrl;

  return updateCommerceEntity(userIdOrScope, 'orders', orderId, data);
}

/**
 * Refund an order.
 */
export async function refundOrder(
  userIdOrScope: string | CommerceScope,
  orderId: string
): Promise<CommerceEntityDetail> {
  return updateCommerceEntity(userIdOrScope, 'orders', orderId, {
    status: 'refunded',
  });
}

/**
 * Cancel an order.
 */
export async function cancelOrder(
  userIdOrScope: string | CommerceScope,
  orderId: string
): Promise<CommerceEntityDetail> {
  return updateCommerceEntity(userIdOrScope, 'orders', orderId, {
    status: 'canceled',
  });
}

// ============================================================================
// STATS & QUERIES
// ============================================================================

/**
 * Get commerce dashboard stats (document counts + revenue).
 */
export async function getCommerceStats(
  userIdOrScope: string | CommerceScope
): Promise<CommerceStats> {
  const scope = resolveScope(userIdOrScope);

  const STATS_PAGE_SIZE = 200;
  const cols = ['products', 'orders', 'customers', 'coupons', 'affiliates'] as const;

  let truncated = false;
  const results = await Promise.all(
    cols.map(async (col) => {
      try {
        const { documents, nextPageToken } = await listDocuments(commercePath(scope, col), {
          pageSize: STATS_PAGE_SIZE,
        });
        if (nextPageToken) truncated = true;
        return documents;
      } catch {
        return [];
      }
    })
  );
  const [productsDocs, ordersDocs, customersDocs, couponsDocs, affiliatesDocs] = results;

  // Calculate revenue from paid/fulfilled orders
  let revenue = 0;
  let pendingOrders = 0;
  for (const order of ordersDocs) {
    const status = order.status as string;
    if (status === 'paid' || status === 'fulfilled') {
      revenue += (order.total as number) || 0;
    }
    if (status === 'pending') {
      pendingOrders++;
    }
  }

  return {
    products: productsDocs.length,
    orders: ordersDocs.length,
    customers: customersDocs.length,
    coupons: couponsDocs.length,
    affiliates: affiliatesDocs.length,
    revenue,
    pendingOrders,
    truncated,
  };
}

/**
 * Get products with low stock.
 */
export async function getLowStockProducts(
  userIdOrScope: string | CommerceScope,
  options?: { limit?: number }
): Promise<CommerceEntityDetail[]> {
  const scope = resolveScope(userIdOrScope);
  const path = commercePath(scope, 'products');

  const { documents } = await listDocuments(path, {
    pageSize: options?.limit ?? 200,
  });

  return documents
    .filter((doc) => {
      const inventory = doc.inventory as number | undefined;
      const threshold = (doc.lowInventoryThreshold as number) || 10;
      const isActive = doc.isActive as boolean;
      return isActive !== false && inventory != null && inventory <= threshold;
    })
    .map((doc) => toEntityDetail(doc, 'products'));
}

// ============================================================================
// HELPERS
// ============================================================================

function toEntitySummary(
  doc: Record<string, unknown>,
  collection: CommerceCollection
): CommerceEntitySummary {
  const name =
    (doc.name as string) ||
    (doc.code as string) || // coupons
    (doc.orderNumber as string) || // orders
    (doc.referralCode as string) || // affiliates
    (doc.email as string) ||
    (doc.id as string) ||
    'Untitled';

  return {
    id: doc.id as string,
    collection,
    name,
    status: doc.status as string | undefined,
    email: doc.email as string | undefined,
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toEntityDetail(
  doc: Record<string, unknown>,
  collection: CommerceCollection
): CommerceEntityDetail {
  const summary = toEntitySummary(doc, collection);
  return {
    ...doc,
    ...summary,
  };
}

/**
 * Validate that a string is a valid commerce collection name.
 */
export function isValidCommerceCollection(value: string): value is CommerceCollection {
  return COMMERCE_COLLECTIONS.includes(value as CommerceCollection);
}

/**
 * Format a price to display string.
 * Most currencies store amounts in cents (smallest unit).
 * Zero-decimal currencies (JPY) store as whole units.
 */
export function formatPrice(amount: number, currency = 'usd'): string {
  const sym = CURRENCY_SYMBOLS[currency] || '$';
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
    return `${sym}${amount.toLocaleString()}`;
  }
  return `${sym}${(amount / 100).toFixed(2)}`;
}

/** Currencies that don't use subunits (no cents). */
const ZERO_DECIMAL_CURRENCIES = new Set(['jpy']);

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '\u20AC',
  gbp: '\u00A3',
  cad: 'CA$',
  aud: 'A$',
  jpy: '\u00A5',
};
