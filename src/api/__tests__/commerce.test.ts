import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock firestore module ───────────────────────────────────────────────────

vi.mock('../firestore.js', () => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  runQuery: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
} from '../firestore.js';
import {
  COMMERCE_COLLECTIONS,
  isValidCommerceCollection,
  listCommerceEntities,
  getCommerceEntity,
  createCommerceEntity,
  updateCommerceEntity,
  deleteCommerceEntity,
  fulfillOrder,
  refundOrder,
  cancelOrder,
  getCommerceStats,
  getLowStockProducts,
  formatPrice,
} from '../commerce.js';
import type { CommerceEntitySummary } from '../commerce.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockListDocuments = listDocuments as ReturnType<typeof vi.fn>;
const mockCreateDocument = createDocument as ReturnType<typeof vi.fn>;
const mockUpdateDocument = updateDocument as ReturnType<typeof vi.fn>;
const mockDeleteDocument = deleteDocument as ReturnType<typeof vi.fn>;
const mockRunQuery = runQuery as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockListDocuments.mockReset();
  mockCreateDocument.mockReset();
  mockUpdateDocument.mockReset();
  mockDeleteDocument.mockReset();
  mockRunQuery.mockReset();
});

// ============================================================================
// COMMERCE_COLLECTIONS & isValidCommerceCollection
// ============================================================================

describe('COMMERCE_COLLECTIONS', () => {
  it('contains exactly 5 collection names', () => {
    expect(COMMERCE_COLLECTIONS).toHaveLength(5);
  });

  it('includes all expected collections', () => {
    const expected = ['products', 'orders', 'customers', 'coupons', 'affiliates'];
    for (const col of expected) {
      expect(COMMERCE_COLLECTIONS).toContain(col);
    }
  });
});

describe('isValidCommerceCollection()', () => {
  it('returns true for all valid commerce collection names', () => {
    for (const col of COMMERCE_COLLECTIONS) {
      expect(isValidCommerceCollection(col)).toBe(true);
    }
  });

  it('returns false for invalid collection names', () => {
    expect(isValidCommerceCollection('nonexistent')).toBe(false);
    expect(isValidCommerceCollection('')).toBe(false);
    expect(isValidCommerceCollection('Products')).toBe(false);
    expect(isValidCommerceCollection('contacts')).toBe(false); // CRM, not commerce
    expect(isValidCommerceCollection('deals')).toBe(false);
  });
});

// ============================================================================
// Firestore path format
// ============================================================================

describe('Firestore path format', () => {
  it('uses commerce_ prefix for user-scoped paths', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listCommerceEntities('user-123', 'products');

    expect(mockListDocuments).toHaveBeenCalledWith(
      'workspaces/ws-personal-user-123/commerce_products',
      { pageSize: 100 }
    );
  });

  it('uses commerce_ prefix for workspace-scoped paths', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listCommerceEntities({ userId: 'user-123', workspaceId: 'ws-456' }, 'orders');

    expect(mockListDocuments).toHaveBeenCalledWith(
      'workspaces/ws-456/commerce_orders',
      { pageSize: 100 }
    );
  });
});

// ============================================================================
// listCommerceEntities()
// ============================================================================

describe('listCommerceEntities()', () => {
  const userId = 'user-abc123';

  it('lists entities without filters using listDocuments', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'p1', name: 'T-Shirt', price: 2999, isActive: true },
        { id: 'p2', name: 'Mug', price: 1499, isActive: true },
      ],
    });

    const results = await listCommerceEntities(userId, 'products');

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `workspaces/ws-personal-${userId}/commerce_products`,
      { pageSize: 100 }
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('p1');
    expect(results[0].collection).toBe('products');
    expect(results[0].name).toBe('T-Shirt');
  });

  it('uses runQuery when status filter is provided', async () => {
    mockRunQuery.mockResolvedValue([
      { id: 'o1', orderNumber: 'ORD-001', status: 'pending' },
    ]);

    const results = await listCommerceEntities(userId, 'orders', { status: 'pending' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collectionPath, filters, options] = mockRunQuery.mock.calls[0];
    expect(collectionPath).toBe(`workspaces/ws-personal-${userId}/commerce_orders`);
    expect(filters).toEqual([
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ]);
    expect(options).toEqual({ limit: 100 });
    expect(mockListDocuments).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('respects custom limit', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listCommerceEntities(userId, 'products', { limit: 25 });

    expect(mockListDocuments).toHaveBeenCalledWith(
      `workspaces/ws-personal-${userId}/commerce_products`,
      { pageSize: 25 }
    );
  });

  it('returns empty array when no documents exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listCommerceEntities(userId, 'affiliates');

    expect(results).toEqual([]);
  });

  it('returns CommerceEntitySummary with correct shape', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'p-shape',
          name: 'Widget',
          status: 'active',
          email: undefined,
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-02T00:00:00Z',
        },
      ],
    });

    const [entity] = await listCommerceEntities(userId, 'products');

    expect(entity).toEqual<CommerceEntitySummary>({
      id: 'p-shape',
      collection: 'products',
      name: 'Widget',
      status: 'active',
      email: undefined,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
    });
  });
});

// ============================================================================
// Name extraction (toEntitySummary fallback chain)
// ============================================================================

describe('toEntitySummary name extraction', () => {
  const userId = 'user-names';

  async function extractName(doc: Record<string, unknown>): Promise<string> {
    mockListDocuments.mockResolvedValueOnce({ documents: [doc] });
    const [entity] = await listCommerceEntities(userId, 'products');
    return entity.name;
  }

  it('uses name field when present', async () => {
    expect(await extractName({ id: 'x', name: 'T-Shirt' })).toBe('T-Shirt');
  });

  it('falls back to code for coupons', async () => {
    expect(await extractName({ id: 'x', code: 'SAVE20' })).toBe('SAVE20');
  });

  it('falls back to orderNumber for orders', async () => {
    expect(await extractName({ id: 'x', orderNumber: 'ORD-001' })).toBe('ORD-001');
  });

  it('falls back to referralCode for affiliates', async () => {
    expect(await extractName({ id: 'x', referralCode: 'REF-ABC' })).toBe('REF-ABC');
  });

  it('falls back to email', async () => {
    expect(await extractName({ id: 'x', email: 'alice@test.com' })).toBe('alice@test.com');
  });

  it('falls back to id', async () => {
    expect(await extractName({ id: 'entity-789' })).toBe('entity-789');
  });

  it('falls back to Untitled when no usable fields', async () => {
    expect(await extractName({})).toBe('Untitled');
  });
});

// ============================================================================
// getCommerceEntity()
// ============================================================================

describe('getCommerceEntity()', () => {
  const userId = 'user-xyz';

  it('returns entity detail for existing document', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'prod-1',
      name: 'T-Shirt',
      price: 2999,
      type: 'physical',
      isActive: true,
      createdAt: '2026-01-15T10:00:00Z',
    });

    const entity = await getCommerceEntity(userId, 'products', 'prod-1');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `workspaces/ws-personal-${userId}/commerce_products`,
      'prod-1'
    );
    expect(entity).not.toBeNull();
    expect(entity!.id).toBe('prod-1');
    expect(entity!.collection).toBe('products');
    expect(entity!.name).toBe('T-Shirt');
    expect(entity!.price).toBe(2999);
  });

  it('returns null for non-existent entity', async () => {
    mockGetDocument.mockResolvedValue(null);

    const entity = await getCommerceEntity(userId, 'orders', 'nonexistent');

    expect(entity).toBeNull();
  });

  it('propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Network error'));

    await expect(getCommerceEntity(userId, 'products', 'p1')).rejects.toThrow('Network error');
  });
});

// ============================================================================
// createCommerceEntity()
// ============================================================================

describe('createCommerceEntity()', () => {
  const userId = 'user-create';

  it('creates entity with timestamps', async () => {
    const inputData = { name: 'New Product', price: 1999, type: 'physical' };

    mockCreateDocument.mockImplementation(
      async (_path: string, _id: string, data: Record<string, unknown>) => ({
        id: 'prod-new',
        ...data,
      })
    );

    const entity = await createCommerceEntity(userId, 'products', 'prod-new', inputData);

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [path, entityId, sentData] = mockCreateDocument.mock.calls[0];
    expect(path).toBe(`workspaces/ws-personal-${userId}/commerce_products`);
    expect(entityId).toBe('prod-new');
    expect(sentData.name).toBe('New Product');
    expect(sentData.price).toBe(1999);
    expect(sentData.createdAt).toBeDefined();
    expect(sentData.updatedAt).toBeDefined();
    expect(sentData.createdAt).toBe(sentData.updatedAt);

    expect(entity.id).toBe('prod-new');
    expect(entity.collection).toBe('products');
  });

  it('propagates errors from createDocument', async () => {
    mockCreateDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(
      createCommerceEntity(userId, 'products', 'p1', { name: 'X' })
    ).rejects.toThrow('Permission denied');
  });
});

// ============================================================================
// updateCommerceEntity()
// ============================================================================

describe('updateCommerceEntity()', () => {
  const userId = 'user-update';

  it('updates entity with updatedAt timestamp', async () => {
    mockUpdateDocument.mockImplementation(
      async (_path: string, _id: string, data: Record<string, unknown>) => ({
        id: 'p1',
        name: 'Updated Product',
        ...data,
      })
    );

    const entity = await updateCommerceEntity(userId, 'products', 'p1', {
      name: 'Updated Product',
    });

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [path, entityId, sentData] = mockUpdateDocument.mock.calls[0];
    expect(path).toBe(`workspaces/ws-personal-${userId}/commerce_products`);
    expect(entityId).toBe('p1');
    expect(sentData.name).toBe('Updated Product');
    expect(sentData.updatedAt).toBeDefined();

    expect(entity.id).toBe('p1');
    expect(entity.collection).toBe('products');
  });

  it('does not add createdAt on update', async () => {
    mockUpdateDocument.mockResolvedValue({ id: 'p1', name: 'Test' });

    await updateCommerceEntity(userId, 'products', 'p1', { name: 'Test' });

    const [, , sentData] = mockUpdateDocument.mock.calls[0];
    expect(sentData.updatedAt).toBeDefined();
    expect(sentData.createdAt).toBeUndefined();
  });
});

// ============================================================================
// deleteCommerceEntity()
// ============================================================================

describe('deleteCommerceEntity()', () => {
  const userId = 'user-delete';

  it('calls deleteDocument with correct commerce_ path', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteCommerceEntity(userId, 'products', 'p1');

    expect(mockDeleteDocument).toHaveBeenCalledOnce();
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      `workspaces/ws-personal-${userId}/commerce_products`,
      'p1'
    );
  });

  it('uses workspace-scoped path when workspaceId provided', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteCommerceEntity(
      { userId: 'u1', workspaceId: 'ws-1' },
      'coupons',
      'cpn-99'
    );

    expect(mockDeleteDocument).toHaveBeenCalledWith(
      'workspaces/ws-1/commerce_coupons',
      'cpn-99'
    );
  });

  it('propagates errors from deleteDocument', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(
      deleteCommerceEntity(userId, 'orders', 'o1')
    ).rejects.toThrow('PERMISSION_DENIED');
  });
});

// ============================================================================
// Order lifecycle
// ============================================================================

describe('fulfillOrder()', () => {
  const userId = 'user-fulfill';

  it('updates order with fulfilled status and tracking', async () => {
    mockUpdateDocument.mockImplementation(
      async (_path: string, _id: string, data: Record<string, unknown>) => ({
        id: 'ord-1',
        ...data,
      })
    );

    await fulfillOrder(userId, 'ord-1', {
      trackingNumber: 'TRK-123',
      trackingUrl: 'https://tracking.example.com/TRK-123',
    });

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [path, entityId, sentData] = mockUpdateDocument.mock.calls[0];
    expect(path).toBe(`workspaces/ws-personal-${userId}/commerce_orders`);
    expect(entityId).toBe('ord-1');
    expect(sentData.status).toBe('fulfilled');
    expect(sentData.fulfillmentStatus).toBe('shipped');
    expect(sentData.trackingNumber).toBe('TRK-123');
    expect(sentData.trackingUrl).toBe('https://tracking.example.com/TRK-123');
    expect(sentData.fulfilledAt).toBeDefined();
  });

  it('works without tracking info', async () => {
    mockUpdateDocument.mockResolvedValue({ id: 'ord-1' });

    await fulfillOrder(userId, 'ord-1');

    const [, , sentData] = mockUpdateDocument.mock.calls[0];
    expect(sentData.status).toBe('fulfilled');
    expect(sentData.trackingNumber).toBeUndefined();
    expect(sentData.trackingUrl).toBeUndefined();
  });

  it('propagates errors from updateDocument', async () => {
    mockUpdateDocument.mockRejectedValue(new Error('Not found'));

    await expect(fulfillOrder(userId, 'ord-1')).rejects.toThrow('Not found');
  });
});

describe('refundOrder()', () => {
  it('updates order with refunded status', async () => {
    mockUpdateDocument.mockResolvedValue({ id: 'ord-1' });

    await refundOrder('user-1', 'ord-1');

    const [, , sentData] = mockUpdateDocument.mock.calls[0];
    expect(sentData.status).toBe('refunded');
  });

  it('propagates errors from updateDocument', async () => {
    mockUpdateDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(refundOrder('user-1', 'ord-1')).rejects.toThrow('Permission denied');
  });
});

describe('cancelOrder()', () => {
  it('updates order with canceled status', async () => {
    mockUpdateDocument.mockResolvedValue({ id: 'ord-1' });

    await cancelOrder('user-1', 'ord-1');

    const [, , sentData] = mockUpdateDocument.mock.calls[0];
    expect(sentData.status).toBe('canceled');
  });

  it('propagates errors from updateDocument', async () => {
    mockUpdateDocument.mockRejectedValue(new Error('Server error'));

    await expect(cancelOrder('user-1', 'ord-1')).rejects.toThrow('Server error');
  });
});

// ============================================================================
// getCommerceStats()
// ============================================================================

describe('getCommerceStats()', () => {
  const userId = 'user-stats';

  it('returns counts and revenue from paid/fulfilled orders', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [{ id: 'p1' }, { id: 'p2' }] }) // products
      .mockResolvedValueOnce({
        documents: [
          { id: 'o1', status: 'paid', total: 2999 },
          { id: 'o2', status: 'pending', total: 1500 },
          { id: 'o3', status: 'fulfilled', total: 4999 },
        ],
      }) // orders
      .mockResolvedValueOnce({ documents: [{ id: 'c1' }] }) // customers
      .mockResolvedValueOnce({ documents: [] }) // coupons
      .mockResolvedValueOnce({ documents: [{ id: 'a1' }] }); // affiliates

    const stats = await getCommerceStats(userId);

    expect(stats).toEqual({
      products: 2,
      orders: 3,
      customers: 1,
      coupons: 0,
      affiliates: 1,
      revenue: 7998, // 2999 + 4999
      pendingOrders: 1,
      truncated: false,
    });
  });

  it('queries all 5 collections with pageSize 200', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await getCommerceStats(userId);

    expect(mockListDocuments).toHaveBeenCalledTimes(5);
    const expectedCollections = ['products', 'orders', 'customers', 'coupons', 'affiliates'];
    for (let i = 0; i < 5; i++) {
      const [path, options] = mockListDocuments.mock.calls[i];
      expect(path).toBe(`workspaces/ws-personal-${userId}/commerce_${expectedCollections[i]}`);
      expect(options).toEqual({ pageSize: 200 });
    }
  });

  it('returns 0 for collections when query throws', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [{ id: 'p1' }] }) // products OK
      .mockRejectedValueOnce(new Error('Network error')) // orders fail
      .mockResolvedValueOnce({ documents: [] }) // customers
      .mockRejectedValueOnce(new Error('Timeout')) // coupons fail
      .mockResolvedValueOnce({ documents: [] }); // affiliates

    const stats = await getCommerceStats(userId);

    expect(stats.products).toBe(1);
    expect(stats.orders).toBe(0);
    expect(stats.customers).toBe(0);
    expect(stats.coupons).toBe(0);
    expect(stats.affiliates).toBe(0);
    expect(stats.revenue).toBe(0);
    expect(stats.pendingOrders).toBe(0);
    expect(stats.truncated).toBe(false);
  });

  it('sets truncated to true when nextPageToken is returned', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [{ id: 'p1' }] }) // products
      .mockResolvedValueOnce({ documents: [], nextPageToken: 'abc' }) // orders (truncated)
      .mockResolvedValueOnce({ documents: [] }) // customers
      .mockResolvedValueOnce({ documents: [] }) // coupons
      .mockResolvedValueOnce({ documents: [] }); // affiliates

    const stats = await getCommerceStats(userId);

    expect(stats.truncated).toBe(true);
  });

  it('sets truncated to false when no collections have nextPageToken', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const stats = await getCommerceStats(userId);

    expect(stats.truncated).toBe(false);
  });
});

// ============================================================================
// getLowStockProducts()
// ============================================================================

describe('getLowStockProducts()', () => {
  const userId = 'user-stock';

  it('returns products below their low inventory threshold', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'p1', name: 'Low', inventory: 3, lowInventoryThreshold: 5, isActive: true },
        { id: 'p2', name: 'OK', inventory: 50, lowInventoryThreshold: 10, isActive: true },
        { id: 'p3', name: 'Critical', inventory: 0, lowInventoryThreshold: 10, isActive: true },
        { id: 'p4', name: 'Inactive', inventory: 1, lowInventoryThreshold: 5, isActive: false },
      ],
    });

    const results = await getLowStockProducts(userId);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Low');
    expect(results[1].name).toBe('Critical');
  });

  it('uses default threshold of 10 when not set', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'p1', name: 'Below Default', inventory: 8, isActive: true },
        { id: 'p2', name: 'Above Default', inventory: 15, isActive: true },
      ],
    });

    const results = await getLowStockProducts(userId);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Below Default');
  });

  it('skips products without inventory tracking', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'p1', name: 'Digital', isActive: true }, // no inventory field
      ],
    });

    const results = await getLowStockProducts(userId);

    expect(results).toHaveLength(0);
  });

  it('uses commerce_ path prefix', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await getLowStockProducts(userId);

    expect(mockListDocuments).toHaveBeenCalledWith(
      `workspaces/ws-personal-${userId}/commerce_products`,
      { pageSize: 200 }
    );
  });
});

// ============================================================================
// formatPrice()
// ============================================================================

describe('formatPrice()', () => {
  it('formats USD correctly', () => {
    expect(formatPrice(2999, 'usd')).toBe('$29.99');
    expect(formatPrice(100, 'usd')).toBe('$1.00');
    expect(formatPrice(0, 'usd')).toBe('$0.00');
  });

  it('formats EUR correctly', () => {
    expect(formatPrice(1999, 'eur')).toBe('\u20AC19.99');
  });

  it('formats GBP correctly', () => {
    expect(formatPrice(9999, 'gbp')).toBe('\u00A399.99');
  });

  it('formats JPY as zero-decimal (no cents division)', () => {
    expect(formatPrice(500, 'jpy')).toBe('\u00A5500');
    expect(formatPrice(1200, 'jpy')).toBe('\u00A51,200');
  });

  it('defaults to USD when no currency provided', () => {
    expect(formatPrice(4999)).toBe('$49.99');
  });
});
