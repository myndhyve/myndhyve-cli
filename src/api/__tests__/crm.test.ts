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
  CRM_COLLECTIONS,
  isValidCrmCollection,
  listCrmEntities,
  getCrmEntity,
  createCrmEntity,
  updateCrmEntity,
  deleteCrmEntity,
  getCrmStats,
} from '../crm.js';
import type { CrmEntitySummary } from '../crm.js';

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
// CRM_COLLECTIONS & isValidCrmCollection
// ============================================================================

describe('CRM_COLLECTIONS', () => {
  it('contains exactly 10 collection names', () => {
    expect(CRM_COLLECTIONS).toHaveLength(10);
  });

  it('includes all expected collections', () => {
    const expected = [
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
    for (const col of expected) {
      expect(CRM_COLLECTIONS).toContain(col);
    }
  });
});

describe('isValidCrmCollection()', () => {
  it('returns true for all valid CRM collection names', () => {
    for (const col of CRM_COLLECTIONS) {
      expect(isValidCrmCollection(col)).toBe(true);
    }
  });

  it('returns false for invalid collection names', () => {
    expect(isValidCrmCollection('nonexistent')).toBe(false);
    expect(isValidCrmCollection('')).toBe(false);
    expect(isValidCrmCollection('Contacts')).toBe(false); // case-sensitive
    expect(isValidCrmCollection('DEALS')).toBe(false);
    expect(isValidCrmCollection('users')).toBe(false);
    expect(isValidCrmCollection('leads')).toBe(false);
  });
});

// ============================================================================
// listCrmEntities()
// ============================================================================

describe('listCrmEntities()', () => {
  const userId = 'user-abc123';

  it('lists entities without filters using listDocuments', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'c1', name: 'Alice', status: 'active', tags: ['vip'] },
        { id: 'c2', name: 'Bob', email: 'bob@test.com' },
      ],
    });

    const results = await listCrmEntities(userId, 'contacts');

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${userId}/crm/contacts`,
      { pageSize: 100 }
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('c1');
    expect(results[0].collection).toBe('contacts');
    expect(results[0].name).toBe('Alice');
    expect(results[1].id).toBe('c2');
  });

  it('uses runQuery when status filter is provided', async () => {
    mockRunQuery.mockResolvedValue([
      { id: 'd1', name: 'Big Deal', status: 'won' },
    ]);

    const results = await listCrmEntities(userId, 'deals', { status: 'won' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collectionPath, filters, options] = mockRunQuery.mock.calls[0];
    expect(collectionPath).toBe(`users/${userId}/crm/deals`);
    expect(filters).toEqual([
      { field: 'status', op: 'EQUAL', value: 'won' },
    ]);
    expect(options).toEqual({ limit: 100 });
    expect(mockListDocuments).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Big Deal');
  });

  it('uses runQuery when tag filter is provided', async () => {
    mockRunQuery.mockResolvedValue([
      { id: 'c1', name: 'Alice', tags: ['vip'] },
    ]);

    const results = await listCrmEntities(userId, 'contacts', { tag: 'vip' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'tags', op: 'ARRAY_CONTAINS', value: 'vip' },
    ]);
    expect(results).toHaveLength(1);
  });

  it('combines status and tag filters in a single query', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listCrmEntities(userId, 'tasks', { status: 'pending', tag: 'urgent' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toHaveLength(2);
    expect(filters).toEqual([
      { field: 'status', op: 'EQUAL', value: 'pending' },
      { field: 'tags', op: 'ARRAY_CONTAINS', value: 'urgent' },
    ]);
  });

  it('uses listDocuments when options is empty object (no filters)', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listCrmEntities(userId, 'orders', {});

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('respects custom limit option without filters', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listCrmEntities(userId, 'products', { limit: 25 });

    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${userId}/crm/products`,
      { pageSize: 25 }
    );
  });

  it('respects custom limit option with filters', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listCrmEntities(userId, 'deals', { status: 'open', limit: 50 });

    const [, , options] = mockRunQuery.mock.calls[0];
    expect(options).toEqual({ limit: 50 });
  });

  it('returns empty array when no documents exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listCrmEntities(userId, 'affiliates');

    expect(results).toEqual([]);
  });

  it('returns empty array from query when no matches', async () => {
    mockRunQuery.mockResolvedValue([]);

    const results = await listCrmEntities(userId, 'contacts', { status: 'archived' });

    expect(results).toEqual([]);
  });

  it('returns CrmEntitySummary with correct shape', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'c-shape',
          name: 'Test Contact',
          status: 'active',
          email: 'test@example.com',
          tags: ['vip', 'enterprise'],
          createdAt: '2024-06-01T00:00:00Z',
          updatedAt: '2024-06-02T00:00:00Z',
        },
      ],
    });

    const [entity] = await listCrmEntities(userId, 'contacts');

    expect(entity).toEqual<CrmEntitySummary>({
      id: 'c-shape',
      collection: 'contacts',
      name: 'Test Contact',
      status: 'active',
      email: 'test@example.com',
      tags: ['vip', 'enterprise'],
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-02T00:00:00Z',
    });
  });
});

// ============================================================================
// Name extraction (toEntitySummary fallback chain)
// ============================================================================

describe('toEntitySummary name extraction', () => {
  const userId = 'user-names';

  beforeEach(() => {
    mockListDocuments.mockImplementation(async (_path: string, _opts: unknown) => ({
      documents: [],
    }));
  });

  async function extractName(doc: Record<string, unknown>): Promise<string> {
    mockListDocuments.mockResolvedValueOnce({ documents: [doc] });
    const [entity] = await listCrmEntities(userId, 'contacts');
    return entity.name;
  }

  it('uses name field when present', async () => {
    expect(await extractName({ id: 'x', name: 'Alice Corp' })).toBe('Alice Corp');
  });

  it('falls back to firstName + lastName', async () => {
    expect(await extractName({ id: 'x', firstName: 'Jane', lastName: 'Doe' }))
      .toBe('Jane Doe');
  });

  it('falls back to email when no name fields', async () => {
    expect(await extractName({ id: 'x', email: 'jane@test.com' }))
      .toBe('jane@test.com');
  });

  it('falls back to title when no name or email', async () => {
    expect(await extractName({ id: 'x', title: 'Follow Up Call' }))
      .toBe('Follow Up Call');
  });

  it('falls back to subject when no title', async () => {
    expect(await extractName({ id: 'x', subject: 'Re: Proposal' }))
      .toBe('Re: Proposal');
  });

  it('falls back to id when no other name fields', async () => {
    expect(await extractName({ id: 'entity-789' })).toBe('entity-789');
  });

  it('falls back to Untitled when doc has no usable fields', async () => {
    expect(await extractName({})).toBe('Untitled');
  });

  it('prefers name over firstName+lastName', async () => {
    expect(
      await extractName({ id: 'x', name: 'Company', firstName: 'Jane', lastName: 'Doe' })
    ).toBe('Company');
  });

  it('prefers firstName+lastName over email', async () => {
    expect(
      await extractName({ id: 'x', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com' })
    ).toBe('Jane Doe');
  });
});

// ============================================================================
// getCrmEntity()
// ============================================================================

describe('getCrmEntity()', () => {
  const userId = 'user-xyz';

  it('returns entity detail for existing document', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'contact-1',
      name: 'Alice',
      email: 'alice@example.com',
      status: 'active',
      tags: ['vip'],
      phone: '+1234567890',
      company: 'Acme Corp',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
    });

    const entity = await getCrmEntity(userId, 'contacts', 'contact-1');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${userId}/crm/contacts`,
      'contact-1'
    );

    expect(entity).not.toBeNull();
    expect(entity!.id).toBe('contact-1');
    expect(entity!.collection).toBe('contacts');
    expect(entity!.name).toBe('Alice');
    expect(entity!.email).toBe('alice@example.com');
    expect(entity!.status).toBe('active');
    expect(entity!.tags).toEqual(['vip']);
    // Detail fields (raw Firestore data passed through)
    expect(entity!.phone).toBe('+1234567890');
    expect(entity!.company).toBe('Acme Corp');
  });

  it('returns null for non-existent entity', async () => {
    mockGetDocument.mockResolvedValue(null);

    const entity = await getCrmEntity(userId, 'deals', 'nonexistent');

    expect(entity).toBeNull();
  });

  it('propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Network error'));

    await expect(getCrmEntity(userId, 'contacts', 'c1')).rejects.toThrow(
      'Network error'
    );
  });

  it('uses correct path for different collections', async () => {
    mockGetDocument.mockResolvedValue({ id: 'o1', name: 'Order #42' });

    await getCrmEntity(userId, 'orders', 'o1');

    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${userId}/crm/orders`,
      'o1'
    );
  });
});

// ============================================================================
// createCrmEntity()
// ============================================================================

describe('createCrmEntity()', () => {
  const userId = 'user-create';

  it('creates entity with timestamps and passes data through', async () => {
    const inputData = { name: 'New Contact', email: 'new@test.com', tags: ['lead'] };

    mockCreateDocument.mockImplementation(
      async (_path: string, _id: string, data: Record<string, unknown>) => ({
        id: 'contact-new',
        ...data,
      })
    );

    const entity = await createCrmEntity(userId, 'contacts', 'contact-new', inputData);

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [path, entityId, sentData] = mockCreateDocument.mock.calls[0];
    expect(path).toBe(`users/${userId}/crm/contacts`);
    expect(entityId).toBe('contact-new');
    expect(sentData.name).toBe('New Contact');
    expect(sentData.email).toBe('new@test.com');
    expect(sentData.tags).toEqual(['lead']);
    // Timestamps added
    expect(sentData.createdAt).toBeDefined();
    expect(sentData.updatedAt).toBeDefined();
    expect(sentData.createdAt).toBe(sentData.updatedAt);
    // ISO string format
    expect(() => new Date(sentData.createdAt)).not.toThrow();

    // Returned entity is wrapped as CrmEntityDetail
    expect(entity.id).toBe('contact-new');
    expect(entity.collection).toBe('contacts');
    expect(entity.name).toBe('New Contact');
  });

  it('returns CrmEntityDetail with all raw fields', async () => {
    mockCreateDocument.mockResolvedValue({
      id: 'deal-1',
      title: 'Big Deal',
      value: 50000,
      stage: 'negotiation',
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-01T00:00:00Z',
    });

    const entity = await createCrmEntity(userId, 'deals', 'deal-1', {
      title: 'Big Deal',
      value: 50000,
      stage: 'negotiation',
    });

    expect(entity.collection).toBe('deals');
    // Raw fields pass through to detail
    expect(entity.value).toBe(50000);
    expect(entity.stage).toBe('negotiation');
  });

  it('propagates errors from createDocument', async () => {
    mockCreateDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(
      createCrmEntity(userId, 'orders', 'o1', { total: 100 })
    ).rejects.toThrow('Permission denied');
  });
});

// ============================================================================
// updateCrmEntity()
// ============================================================================

describe('updateCrmEntity()', () => {
  const userId = 'user-update';

  it('updates entity with updatedAt timestamp', async () => {
    mockUpdateDocument.mockImplementation(
      async (_path: string, _id: string, data: Record<string, unknown>) => ({
        id: 'c1',
        name: 'Updated Name',
        ...data,
      })
    );

    const entity = await updateCrmEntity(userId, 'contacts', 'c1', {
      name: 'Updated Name',
    });

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [path, entityId, sentData] = mockUpdateDocument.mock.calls[0];
    expect(path).toBe(`users/${userId}/crm/contacts`);
    expect(entityId).toBe('c1');
    expect(sentData.name).toBe('Updated Name');
    expect(sentData.updatedAt).toBeDefined();
    expect(() => new Date(sentData.updatedAt)).not.toThrow();

    expect(entity.id).toBe('c1');
    expect(entity.collection).toBe('contacts');
  });

  it('does not add createdAt on update', async () => {
    mockUpdateDocument.mockResolvedValue({ id: 'c1', name: 'Test' });

    await updateCrmEntity(userId, 'contacts', 'c1', { name: 'Test' });

    const [, , sentData] = mockUpdateDocument.mock.calls[0];
    expect(sentData.updatedAt).toBeDefined();
    expect(sentData.createdAt).toBeUndefined();
  });

  it('propagates errors from updateDocument', async () => {
    mockUpdateDocument.mockRejectedValue(new Error('Not found'));

    await expect(
      updateCrmEntity(userId, 'deals', 'd1', { stage: 'closed' })
    ).rejects.toThrow('Not found');
  });
});

// ============================================================================
// deleteCrmEntity()
// ============================================================================

describe('deleteCrmEntity()', () => {
  const userId = 'user-delete';

  it('calls deleteDocument with correct path and entityId', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteCrmEntity(userId, 'contacts', 'c1');

    expect(mockDeleteDocument).toHaveBeenCalledOnce();
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      `users/${userId}/crm/contacts`,
      'c1'
    );
  });

  it('uses correct path for different collections', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteCrmEntity(userId, 'coupons', 'coupon-99');

    expect(mockDeleteDocument).toHaveBeenCalledWith(
      `users/${userId}/crm/coupons`,
      'coupon-99'
    );
  });

  it('propagates errors from deleteDocument', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(
      deleteCrmEntity(userId, 'orders', 'o1')
    ).rejects.toThrow('PERMISSION_DENIED');
  });
});

// ============================================================================
// getCrmStats()
// ============================================================================

describe('getCrmStats()', () => {
  const userId = 'user-stats';

  it('returns -1 for collections with data, 0 for empty', async () => {
    // contacts: has data, deals: empty, orders: has data, products: empty, customers: has data
    mockListDocuments
      .mockResolvedValueOnce({ documents: [{ id: 'c1' }] }) // contacts
      .mockResolvedValueOnce({ documents: [] })              // deals
      .mockResolvedValueOnce({ documents: [{ id: 'o1' }] }) // orders
      .mockResolvedValueOnce({ documents: [] })              // products
      .mockResolvedValueOnce({ documents: [{ id: 'cu1' }] }); // customers

    const stats = await getCrmStats(userId);

    expect(stats).toEqual({
      contacts: -1,
      deals: 0,
      orders: -1,
      products: 0,
      customers: -1,
    });
  });

  it('queries exactly 5 collections with pageSize 1', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await getCrmStats(userId);

    expect(mockListDocuments).toHaveBeenCalledTimes(5);

    const expectedCollections = ['contacts', 'deals', 'orders', 'products', 'customers'];
    for (let i = 0; i < 5; i++) {
      const [path, options] = mockListDocuments.mock.calls[i];
      expect(path).toBe(`users/${userId}/crm/${expectedCollections[i]}`);
      expect(options).toEqual({ pageSize: 1 });
    }
  });

  it('returns 0 for all when all collections are empty', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const stats = await getCrmStats(userId);

    expect(stats).toEqual({
      contacts: 0,
      deals: 0,
      orders: 0,
      products: 0,
      customers: 0,
    });
  });

  it('returns 0 for a collection when its query throws an error', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [{ id: 'c1' }] }) // contacts: OK
      .mockRejectedValueOnce(new Error('Network error'))      // deals: error
      .mockResolvedValueOnce({ documents: [{ id: 'o1' }] }) // orders: OK
      .mockResolvedValueOnce({ documents: [] })              // products: empty
      .mockRejectedValueOnce(new Error('Timeout'));           // customers: error

    const stats = await getCrmStats(userId);

    expect(stats).toEqual({
      contacts: -1,
      deals: 0,    // error treated as 0
      orders: -1,
      products: 0,
      customers: 0, // error treated as 0
    });
  });

  it('returns -1 for all when all collections have data', async () => {
    mockListDocuments.mockResolvedValue({ documents: [{ id: 'x' }] });

    const stats = await getCrmStats(userId);

    expect(stats).toEqual({
      contacts: -1,
      deals: -1,
      orders: -1,
      products: -1,
      customers: -1,
    });
  });
});
