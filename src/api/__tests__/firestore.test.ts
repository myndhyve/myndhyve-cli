import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock auth module ─────────────────────────────────────────────────────────

vi.mock('../../auth/index.js', () => ({
  getToken: vi.fn(),
}));

// ── Mock logger (suppress output in tests) ───────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { getToken } from '../../auth/index.js';
import {
  toFirestoreValue,
  fromFirestoreValue,
  toFirestoreFields,
  fromFirestoreFields,
  extractDocId,
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
  FirestoreError,
  type FirestoreValue as FV,
  type QueryFilter,
} from '../firestore.js';

const mockGetToken = getToken as ReturnType<typeof vi.fn>;

// ── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Constants ────────────────────────────────────────────────────────────────

const FIRESTORE_BASE =
  'https://firestore.googleapis.com/v1/projects/myndhyve-prod/databases/(default)/documents';

// ── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetToken.mockReset();
  mockFetch.mockReset();
  mockGetToken.mockResolvedValue('test-firebase-token');
});

// ============================================================================
// VALUE SERIALIZATION — toFirestoreValue
// ============================================================================

describe('toFirestoreValue', () => {
  it('serializes strings', () => {
    expect(toFirestoreValue('hello')).toEqual({ stringValue: 'hello' });
  });

  it('serializes empty string', () => {
    expect(toFirestoreValue('')).toEqual({ stringValue: '' });
  });

  it('serializes integers', () => {
    expect(toFirestoreValue(42)).toEqual({ integerValue: '42' });
  });

  it('serializes zero as integer', () => {
    expect(toFirestoreValue(0)).toEqual({ integerValue: '0' });
  });

  it('serializes negative integers', () => {
    expect(toFirestoreValue(-10)).toEqual({ integerValue: '-10' });
  });

  it('serializes floats as doubleValue', () => {
    expect(toFirestoreValue(3.14)).toEqual({ doubleValue: 3.14 });
  });

  it('serializes booleans', () => {
    expect(toFirestoreValue(true)).toEqual({ booleanValue: true });
    expect(toFirestoreValue(false)).toEqual({ booleanValue: false });
  });

  it('serializes null', () => {
    expect(toFirestoreValue(null)).toEqual({ nullValue: null });
  });

  it('serializes undefined as null', () => {
    expect(toFirestoreValue(undefined)).toEqual({ nullValue: null });
  });

  it('serializes Date as timestampValue', () => {
    const date = new Date('2025-06-15T10:30:00.000Z');
    expect(toFirestoreValue(date)).toEqual({
      timestampValue: '2025-06-15T10:30:00.000Z',
    });
  });

  it('serializes arrays', () => {
    expect(toFirestoreValue([1, 'two', true])).toEqual({
      arrayValue: {
        values: [
          { integerValue: '1' },
          { stringValue: 'two' },
          { booleanValue: true },
        ],
      },
    });
  });

  it('serializes empty arrays', () => {
    expect(toFirestoreValue([])).toEqual({
      arrayValue: { values: [] },
    });
  });

  it('serializes nested objects as mapValue', () => {
    expect(toFirestoreValue({ name: 'test', count: 5 })).toEqual({
      mapValue: {
        fields: {
          name: { stringValue: 'test' },
          count: { integerValue: '5' },
        },
      },
    });
  });

  it('serializes empty objects', () => {
    expect(toFirestoreValue({})).toEqual({
      mapValue: { fields: {} },
    });
  });

  it('skips undefined values in objects', () => {
    const obj = { name: 'test', missing: undefined, count: 1 };
    const result = toFirestoreValue(obj);
    expect(result).toEqual({
      mapValue: {
        fields: {
          name: { stringValue: 'test' },
          count: { integerValue: '1' },
        },
      },
    });
    // Ensure 'missing' key is not present at all
    expect('missing' in (result as { mapValue: { fields: Record<string, unknown> } }).mapValue.fields).toBe(false);
  });

  it('serializes deeply nested structures', () => {
    const nested = {
      level1: {
        level2: {
          value: 'deep',
        },
      },
    };
    expect(toFirestoreValue(nested)).toEqual({
      mapValue: {
        fields: {
          level1: {
            mapValue: {
              fields: {
                level2: {
                  mapValue: {
                    fields: {
                      value: { stringValue: 'deep' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('serializes arrays containing objects', () => {
    expect(toFirestoreValue([{ id: '1' }, { id: '2' }])).toEqual({
      arrayValue: {
        values: [
          { mapValue: { fields: { id: { stringValue: '1' } } } },
          { mapValue: { fields: { id: { stringValue: '2' } } } },
        ],
      },
    });
  });
});

// ============================================================================
// VALUE DESERIALIZATION — fromFirestoreValue
// ============================================================================

describe('fromFirestoreValue', () => {
  it('deserializes stringValue', () => {
    expect(fromFirestoreValue({ stringValue: 'hello' })).toBe('hello');
  });

  it('deserializes integerValue to number', () => {
    expect(fromFirestoreValue({ integerValue: '42' })).toBe(42);
  });

  it('deserializes doubleValue', () => {
    expect(fromFirestoreValue({ doubleValue: 3.14 })).toBe(3.14);
  });

  it('deserializes booleanValue', () => {
    expect(fromFirestoreValue({ booleanValue: true })).toBe(true);
    expect(fromFirestoreValue({ booleanValue: false })).toBe(false);
  });

  it('deserializes timestampValue as string', () => {
    expect(fromFirestoreValue({ timestampValue: '2025-06-15T10:30:00.000Z' })).toBe(
      '2025-06-15T10:30:00.000Z'
    );
  });

  it('deserializes nullValue', () => {
    expect(fromFirestoreValue({ nullValue: null })).toBeNull();
  });

  it('deserializes arrayValue', () => {
    const input: FV = {
      arrayValue: {
        values: [
          { stringValue: 'a' },
          { integerValue: '1' },
        ],
      },
    };
    expect(fromFirestoreValue(input)).toEqual(['a', 1]);
  });

  it('deserializes arrayValue with no values (empty)', () => {
    expect(fromFirestoreValue({ arrayValue: {} })).toEqual([]);
  });

  it('deserializes mapValue', () => {
    const input: FV = {
      mapValue: {
        fields: {
          name: { stringValue: 'test' },
          active: { booleanValue: true },
        },
      },
    };
    expect(fromFirestoreValue(input)).toEqual({ name: 'test', active: true });
  });

  it('deserializes mapValue with no fields (empty)', () => {
    expect(fromFirestoreValue({ mapValue: {} })).toEqual({});
  });
});

// ============================================================================
// ROUND-TRIP SERIALIZATION
// ============================================================================

describe('round-trip serialization', () => {
  it('string round-trips', () => {
    const val = 'hello world';
    expect(fromFirestoreValue(toFirestoreValue(val))).toBe(val);
  });

  it('integer round-trips', () => {
    expect(fromFirestoreValue(toFirestoreValue(100))).toBe(100);
  });

  it('float round-trips', () => {
    expect(fromFirestoreValue(toFirestoreValue(2.718))).toBe(2.718);
  });

  it('boolean round-trips', () => {
    expect(fromFirestoreValue(toFirestoreValue(true))).toBe(true);
    expect(fromFirestoreValue(toFirestoreValue(false))).toBe(false);
  });

  it('null round-trips', () => {
    expect(fromFirestoreValue(toFirestoreValue(null))).toBeNull();
  });

  it('array round-trips', () => {
    const arr = ['a', 1, true, null];
    expect(fromFirestoreValue(toFirestoreValue(arr))).toEqual(arr);
  });

  it('nested object round-trips', () => {
    const obj = {
      name: 'project',
      settings: {
        theme: 'dark',
        notifications: true,
      },
      tags: ['alpha', 'beta'],
    };
    expect(fromFirestoreValue(toFirestoreValue(obj))).toEqual(obj);
  });

  it('Date serializes to timestamp string (one-way)', () => {
    const date = new Date('2025-01-01T00:00:00.000Z');
    // Date -> timestampValue string (not reconstructed as Date)
    expect(fromFirestoreValue(toFirestoreValue(date))).toBe('2025-01-01T00:00:00.000Z');
  });
});

// ============================================================================
// FIELD HELPERS — toFirestoreFields / fromFirestoreFields
// ============================================================================

describe('toFirestoreFields', () => {
  it('serializes a flat object', () => {
    const result = toFirestoreFields({ name: 'test', count: 3 });
    expect(result).toEqual({
      name: { stringValue: 'test' },
      count: { integerValue: '3' },
    });
  });

  it('skips undefined values', () => {
    const result = toFirestoreFields({ a: 'keep', b: undefined, c: null });
    expect(result).toEqual({
      a: { stringValue: 'keep' },
      c: { nullValue: null },
    });
    expect('b' in result).toBe(false);
  });

  it('handles nested maps', () => {
    const result = toFirestoreFields({
      metadata: { createdBy: 'user1', version: 2 },
    });
    expect(result).toEqual({
      metadata: {
        mapValue: {
          fields: {
            createdBy: { stringValue: 'user1' },
            version: { integerValue: '2' },
          },
        },
      },
    });
  });

  it('handles empty object', () => {
    expect(toFirestoreFields({})).toEqual({});
  });
});

describe('fromFirestoreFields', () => {
  it('deserializes Firestore fields to a plain object', () => {
    const fields: Record<string, FV> = {
      name: { stringValue: 'project-1' },
      active: { booleanValue: true },
      count: { integerValue: '7' },
    };
    expect(fromFirestoreFields(fields)).toEqual({
      name: 'project-1',
      active: true,
      count: 7,
    });
  });

  it('handles nested mapValue fields', () => {
    const fields: Record<string, FV> = {
      config: {
        mapValue: {
          fields: {
            theme: { stringValue: 'dark' },
          },
        },
      },
    };
    expect(fromFirestoreFields(fields)).toEqual({
      config: { theme: 'dark' },
    });
  });

  it('handles empty fields', () => {
    expect(fromFirestoreFields({})).toEqual({});
  });

  it('round-trips with toFirestoreFields', () => {
    const original = {
      name: 'Test',
      count: 5,
      tags: ['a', 'b'],
      nested: { key: 'value' },
    };
    const serialized = toFirestoreFields(original);
    const deserialized = fromFirestoreFields(serialized);
    expect(deserialized).toEqual(original);
  });
});

// ============================================================================
// extractDocId
// ============================================================================

describe('extractDocId', () => {
  it('extracts document ID from a full Firestore path', () => {
    const name = 'projects/myndhyve-prod/databases/(default)/documents/projects/abc123';
    expect(extractDocId(name)).toBe('abc123');
  });

  it('extracts ID from a subcollection document path', () => {
    const name = 'projects/myndhyve-prod/databases/(default)/documents/users/uid1/hyveDocuments/doc456';
    expect(extractDocId(name)).toBe('doc456');
  });

  it('extracts ID from a simple path', () => {
    expect(extractDocId('collection/docId')).toBe('docId');
  });

  it('returns the string itself if no slashes', () => {
    expect(extractDocId('singleSegment')).toBe('singleSegment');
  });
});

// ============================================================================
// HELPERS — mock Firestore response builders
// ============================================================================

function mockOkResponse(body: unknown): ReturnType<typeof vi.fn> {
  return mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockErrorResponse(status: number, errorBody: string): ReturnType<typeof vi.fn> {
  return mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(errorBody),
  });
}

// ============================================================================
// AUTH TOKEN INJECTION
// ============================================================================

describe('Auth Token Injection', () => {
  it('includes Bearer token in Authorization header', async () => {
    mockGetToken.mockResolvedValue('my-firebase-token');
    mockOkResponse({
      name: `${FIRESTORE_BASE}/projects/doc1`,
      fields: { title: { stringValue: 'Test' } },
    });

    await getDocument('projects', 'doc1');

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer my-firebase-token');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('calls getToken for every request', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/col/d1`,
      fields: { a: { stringValue: '1' } },
    });
    mockOkResponse({
      name: `${FIRESTORE_BASE}/col/d2`,
      fields: { a: { stringValue: '2' } },
    });

    await getDocument('col', 'd1');
    await getDocument('col', 'd2');

    expect(mockGetToken).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// CRUD — getDocument
// ============================================================================

describe('getDocument', () => {
  it('returns deserialized document on success', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/projects/proj-1`,
      fields: {
        name: { stringValue: 'My Project' },
        version: { integerValue: '3' },
        active: { booleanValue: true },
      },
    });

    const result = await getDocument('projects', 'proj-1');

    expect(result).toEqual({
      id: 'proj-1',
      name: 'My Project',
      version: 3,
      active: true,
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${FIRESTORE_BASE}/projects/proj-1`);
    expect(init.method).toBe('GET');
  });

  it('returns null when document is not found (404)', async () => {
    mockErrorResponse(404, JSON.stringify({ error: { message: 'Not found' } }));

    const result = await getDocument('projects', 'nonexistent');

    expect(result).toBeNull();
  });

  it('returns null when document has no fields', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/projects/empty-doc`,
      // no fields
    });

    const result = await getDocument('projects', 'empty-doc');

    expect(result).toBeNull();
  });

  it('builds correct URL for subcollections', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/users/uid1/hyveDocuments/doc1`,
      fields: { title: { stringValue: 'Doc' } },
    });

    await getDocument('users/uid1/hyveDocuments', 'doc1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${FIRESTORE_BASE}/users/uid1/hyveDocuments/doc1`);
  });

  it('throws FirestoreError for 403 Permission Denied', async () => {
    mockErrorResponse(403, JSON.stringify({ error: { message: 'Insufficient permissions' } }));

    await expect(getDocument('projects', 'forbidden')).rejects.toThrow(FirestoreError);
    try {
      mockErrorResponse(403, JSON.stringify({ error: { message: 'Insufficient permissions' } }));
      await getDocument('projects', 'forbidden');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).code).toBe('PERMISSION_DENIED');
      expect((err as FirestoreError).statusCode).toBe(403);
    }
  });

  it('throws FirestoreError for 500 server errors', async () => {
    mockErrorResponse(500, JSON.stringify({ error: { message: 'Internal error' } }));

    try {
      await getDocument('projects', 'err');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).code).toBe('REQUEST_FAILED');
      expect((err as FirestoreError).statusCode).toBe(500);
    }
  });
});

// ============================================================================
// CRUD — listDocuments
// ============================================================================

describe('listDocuments', () => {
  it('returns deserialized documents', async () => {
    mockOkResponse({
      documents: [
        {
          name: `${FIRESTORE_BASE}/projects/p1`,
          fields: { name: { stringValue: 'Project 1' } },
        },
        {
          name: `${FIRESTORE_BASE}/projects/p2`,
          fields: { name: { stringValue: 'Project 2' } },
        },
      ],
    });

    const result = await listDocuments('projects');

    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]).toEqual({ id: 'p1', name: 'Project 1' });
    expect(result.documents[1]).toEqual({ id: 'p2', name: 'Project 2' });
    expect(result.nextPageToken).toBeUndefined();
  });

  it('includes nextPageToken for pagination', async () => {
    mockOkResponse({
      documents: [
        {
          name: `${FIRESTORE_BASE}/items/i1`,
          fields: { val: { integerValue: '1' } },
        },
      ],
      nextPageToken: 'page2token',
    });

    const result = await listDocuments('items', { pageSize: 1 });

    expect(result.documents).toHaveLength(1);
    expect(result.nextPageToken).toBe('page2token');
  });

  it('passes pageSize, pageToken, and orderBy as query params', async () => {
    mockOkResponse({ documents: [] });

    await listDocuments('projects', {
      pageSize: 10,
      pageToken: 'abc123',
      orderBy: 'name',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('pageSize=10');
    expect(url).toContain('pageToken=abc123');
    expect(url).toContain('orderBy=name');
  });

  it('returns empty array when no documents field', async () => {
    mockOkResponse({}); // No documents key

    const result = await listDocuments('empty-collection');

    expect(result.documents).toEqual([]);
    expect(result.nextPageToken).toBeUndefined();
  });

  it('skips documents without fields', async () => {
    mockOkResponse({
      documents: [
        {
          name: `${FIRESTORE_BASE}/col/d1`,
          fields: { a: { stringValue: 'ok' } },
        },
        {
          name: `${FIRESTORE_BASE}/col/d2`,
          // no fields
        },
      ],
    });

    const result = await listDocuments('col');
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].id).toBe('d1');
  });
});

// ============================================================================
// CRUD — createDocument
// ============================================================================

describe('createDocument', () => {
  it('sends POST with correct URL and serialized body', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/projects/new-doc`,
      fields: {
        title: { stringValue: 'New Project' },
        count: { integerValue: '0' },
      },
    });

    const data = { title: 'New Project', count: 0 };
    const result = await createDocument('projects', 'new-doc', data);

    // Verify URL
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${FIRESTORE_BASE}/projects?documentId=new-doc`);
    expect(init.method).toBe('POST');

    // Verify body
    const body = JSON.parse(init.body);
    expect(body.fields).toEqual({
      title: { stringValue: 'New Project' },
      count: { integerValue: '0' },
    });

    // Verify result
    expect(result).toEqual({
      id: 'new-doc',
      title: 'New Project',
      count: 0,
    });
  });

  it('URL-encodes the document ID', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/col/id%20with%20spaces`,
      fields: {},
    });

    await createDocument('col', 'id with spaces', { a: 1 });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('documentId=id%20with%20spaces');
  });

  it('falls back to original data when response has no fields', async () => {
    const data = { title: 'Fallback' };
    mockOkResponse({
      name: `${FIRESTORE_BASE}/col/doc1`,
      // no fields in response
    });

    const result = await createDocument('col', 'doc1', data);

    expect(result.title).toBe('Fallback');
    expect(result.id).toBe('doc1');
  });
});

// ============================================================================
// CRUD — updateDocument
// ============================================================================

describe('updateDocument', () => {
  it('sends PATCH with updateMask derived from data keys', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/projects/proj-1`,
      fields: {
        title: { stringValue: 'Updated' },
        status: { stringValue: 'active' },
      },
    });

    const data = { title: 'Updated', status: 'active' };
    const result = await updateDocument('projects', 'proj-1', data);

    const [url, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('PATCH');

    // Check updateMask params
    expect(url).toContain('updateMask.fieldPaths=title');
    expect(url).toContain('updateMask.fieldPaths=status');

    expect(result).toEqual({
      id: 'proj-1',
      title: 'Updated',
      status: 'active',
    });
  });

  it('uses explicit fieldPaths when provided', async () => {
    mockOkResponse({
      name: `${FIRESTORE_BASE}/projects/proj-1`,
      fields: {
        title: { stringValue: 'Updated' },
        description: { stringValue: 'New desc' },
        status: { stringValue: 'active' },
      },
    });

    const data = { title: 'Updated', description: 'New desc', status: 'active' };
    await updateDocument('projects', 'proj-1', data, ['title', 'description']);

    const [url] = mockFetch.mock.calls[0];
    // Only the explicit fields should appear
    expect(url).toContain('updateMask.fieldPaths=title');
    expect(url).toContain('updateMask.fieldPaths=description');
    // 'status' should NOT be in the mask
    const params = new URL(url).searchParams;
    const maskPaths = params.getAll('updateMask.fieldPaths');
    expect(maskPaths).toEqual(['title', 'description']);
  });

  it('falls back to original data when response has no fields', async () => {
    const data = { title: 'Fallback' };
    mockOkResponse({
      name: `${FIRESTORE_BASE}/col/doc1`,
    });

    const result = await updateDocument('col', 'doc1', data);
    expect(result.title).toBe('Fallback');
    expect(result.id).toBe('doc1');
  });
});

// ============================================================================
// CRUD — deleteDocument
// ============================================================================

describe('deleteDocument', () => {
  it('sends DELETE to the correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });

    await deleteDocument('projects', 'proj-1');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${FIRESTORE_BASE}/projects/proj-1`);
    expect(init.method).toBe('DELETE');
  });

  it('works with subcollection paths', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });

    await deleteDocument('users/uid1/hyveDocuments', 'doc1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${FIRESTORE_BASE}/users/uid1/hyveDocuments/doc1`);
  });

  it('throws FirestoreError on failure', async () => {
    mockErrorResponse(500, 'Internal error');

    await expect(deleteDocument('projects', 'doc1')).rejects.toThrow(FirestoreError);
  });
});

// ============================================================================
// runQuery
// ============================================================================

describe('runQuery', () => {
  it('sends structured query with a single filter', async () => {
    mockOkResponse([
      {
        document: {
          name: `${FIRESTORE_BASE}/projects/p1`,
          fields: {
            name: { stringValue: 'Match' },
            status: { stringValue: 'active' },
          },
        },
      },
    ]);

    const filters: QueryFilter[] = [
      { field: 'status', op: 'EQUAL', value: 'active' },
    ];
    const result = await runQuery('projects', filters);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'p1', name: 'Match', status: 'active' });

    // Verify request structure
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${FIRESTORE_BASE}:runQuery`);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.structuredQuery.from).toEqual([{ collectionId: 'projects' }]);
    // Single filter should NOT be wrapped in compositeFilter
    expect(body.structuredQuery.where).toEqual({
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'EQUAL',
        value: { stringValue: 'active' },
      },
    });
  });

  it('builds composite AND filter for multiple filters', async () => {
    mockOkResponse([
      {
        document: {
          name: `${FIRESTORE_BASE}/tasks/t1`,
          fields: {
            status: { stringValue: 'active' },
            priority: { integerValue: '1' },
          },
        },
      },
    ]);

    const filters: QueryFilter[] = [
      { field: 'status', op: 'EQUAL', value: 'active' },
      { field: 'priority', op: 'GREATER_THAN', value: 0 },
    ];
    const result = await runQuery('tasks', filters);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.structuredQuery.where).toEqual({
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'active' },
            },
          },
          {
            fieldFilter: {
              field: { fieldPath: 'priority' },
              op: 'GREATER_THAN',
              value: { integerValue: '0' },
            },
          },
        ],
      },
    });

    expect(result).toHaveLength(1);
  });

  it('sends query without where clause when no filters', async () => {
    mockOkResponse([
      {
        document: {
          name: `${FIRESTORE_BASE}/projects/p1`,
          fields: { name: { stringValue: 'All' } },
        },
      },
    ]);

    await runQuery('projects', []);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.structuredQuery.where).toBeUndefined();
  });

  it('includes orderBy and limit in the query', async () => {
    mockOkResponse([]);

    await runQuery('projects', [], {
      orderBy: 'createdAt',
      orderDirection: 'DESCENDING',
      limit: 5,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.structuredQuery.orderBy).toEqual([
      {
        field: { fieldPath: 'createdAt' },
        direction: 'DESCENDING',
      },
    ]);
    expect(body.structuredQuery.limit).toBe(5);
  });

  it('defaults orderDirection to ASCENDING', async () => {
    mockOkResponse([]);

    await runQuery('projects', [], { orderBy: 'name' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.structuredQuery.orderBy[0].direction).toBe('ASCENDING');
  });

  it('handles subcollection queries with parent path', async () => {
    mockOkResponse([
      {
        document: {
          name: `${FIRESTORE_BASE}/users/uid1/hyveDocuments/doc1`,
          fields: { title: { stringValue: 'My Doc' } },
        },
      },
    ]);

    await runQuery('users/uid1/hyveDocuments', [
      { field: 'hyveId', op: 'EQUAL', value: 'app-builder' },
    ]);

    const [url] = mockFetch.mock.calls[0];
    // Subcollection query should target the parent path
    expect(url).toBe(`${FIRESTORE_BASE}/users/uid1:runQuery`);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.structuredQuery.from).toEqual([{ collectionId: 'hyveDocuments' }]);
  });

  it('returns empty array when results have no documents', async () => {
    mockOkResponse([{ readTime: '2025-06-15T00:00:00Z' }]); // Firestore returns this for empty results

    const result = await runQuery('projects', [
      { field: 'status', op: 'EQUAL', value: 'nonexistent' },
    ]);

    expect(result).toEqual([]);
  });

  it('returns empty array when response is not an array', async () => {
    mockOkResponse({}); // Unexpected response shape

    const result = await runQuery('projects', []);

    expect(result).toEqual([]);
  });

  it('handles ARRAY_CONTAINS filter', async () => {
    mockOkResponse([
      {
        document: {
          name: `${FIRESTORE_BASE}/projects/p1`,
          fields: { tags: { arrayValue: { values: [{ stringValue: 'alpha' }] } } },
        },
      },
    ]);

    await runQuery('projects', [
      { field: 'tags', op: 'ARRAY_CONTAINS', value: 'alpha' },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.structuredQuery.where.fieldFilter.op).toBe('ARRAY_CONTAINS');
    expect(body.structuredQuery.where.fieldFilter.value).toEqual({ stringValue: 'alpha' });
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('FirestoreError', () => {
  it('has correct name, code, statusCode, and message', () => {
    const err = new FirestoreError('Not found', 'NOT_FOUND', 404);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FirestoreError);
    expect(err.name).toBe('FirestoreError');
    expect(err.message).toBe('Not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('statusCode is optional', () => {
    const err = new FirestoreError('Unknown error', 'UNKNOWN');

    expect(err.statusCode).toBeUndefined();
  });
});

describe('Error Handling in firestoreRequest', () => {
  it('throws NOT_FOUND with correct code for 404', async () => {
    mockErrorResponse(404, JSON.stringify({ error: { message: 'doc missing' } }));

    try {
      await listDocuments('missing-collection');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).code).toBe('NOT_FOUND');
      expect((err as FirestoreError).statusCode).toBe(404);
      expect((err as FirestoreError).message).toBe('Document not found');
    }
  });

  it('throws PERMISSION_DENIED for 403 with error message', async () => {
    mockErrorResponse(
      403,
      JSON.stringify({ error: { message: 'User lacks access' } })
    );

    try {
      await listDocuments('forbidden');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).code).toBe('PERMISSION_DENIED');
      expect((err as FirestoreError).statusCode).toBe(403);
      expect((err as FirestoreError).message).toContain('User lacks access');
    }
  });

  it('throws REQUEST_FAILED for other HTTP errors', async () => {
    mockErrorResponse(502, 'Bad Gateway');

    try {
      await listDocuments('col');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).code).toBe('REQUEST_FAILED');
      expect((err as FirestoreError).statusCode).toBe(502);
      expect((err as FirestoreError).message).toContain('Bad Gateway');
    }
  });

  it('extracts error.status from JSON error body', async () => {
    mockErrorResponse(
      500,
      JSON.stringify({ error: { status: 'INTERNAL' } })
    );

    try {
      await listDocuments('col');
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as FirestoreError).message).toContain('INTERNAL');
    }
  });

  it('handles non-JSON error response body', async () => {
    mockErrorResponse(503, 'Service Unavailable');

    try {
      await listDocuments('col');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).message).toContain('Service Unavailable');
    }
  });

  it('handles empty error response body', async () => {
    mockErrorResponse(500, '');

    try {
      await listDocuments('col');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      expect((err as FirestoreError).message).toContain('HTTP 500');
    }
  });

  it('handles text() failure in error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('read failed')),
    });

    try {
      await listDocuments('col');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirestoreError);
      // text() failure caught, falls back to HTTP status
      expect((err as FirestoreError).message).toContain('HTTP 500');
    }
  });

  it('propagates getToken errors', async () => {
    mockGetToken.mockRejectedValue(new Error('Not authenticated'));

    await expect(getDocument('col', 'doc1')).rejects.toThrow('Not authenticated');
  });
});

// ============================================================================
// QUERY HELPERS (tested via runQuery behavior)
// ============================================================================

describe('Query Helpers (via runQuery)', () => {
  describe('getCollectionId', () => {
    it('extracts collection ID from top-level path', async () => {
      mockOkResponse([]);

      await runQuery('projects', []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.structuredQuery.from[0].collectionId).toBe('projects');
    });

    it('extracts last segment from subcollection path', async () => {
      mockOkResponse([]);

      await runQuery('users/uid1/hyveDocuments', []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.structuredQuery.from[0].collectionId).toBe('hyveDocuments');
    });

    it('extracts from deeply nested subcollection', async () => {
      mockOkResponse([]);

      await runQuery('users/uid1/hyveDocuments/doc1/runs', []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.structuredQuery.from[0].collectionId).toBe('runs');
    });
  });

  describe('getParentPath', () => {
    it('uses root :runQuery for top-level collections', async () => {
      mockOkResponse([]);

      await runQuery('projects', []);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${FIRESTORE_BASE}:runQuery`);
    });

    it('uses parent document path for subcollections', async () => {
      mockOkResponse([]);

      await runQuery('users/uid1/hyveDocuments', []);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${FIRESTORE_BASE}/users/uid1:runQuery`);
    });

    it('uses parent path for deeply nested subcollection', async () => {
      mockOkResponse([]);

      await runQuery('users/uid1/hyveDocuments/doc1/runs', []);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${FIRESTORE_BASE}/users/uid1/hyveDocuments/doc1:runQuery`);
    });
  });
});

// ============================================================================
// INTEGRATION-STYLE: Full CRUD workflow
// ============================================================================

describe('Full CRUD workflow', () => {
  it('create, read, update, delete cycle', async () => {
    // CREATE
    mockOkResponse({
      name: `${FIRESTORE_BASE}/items/item-1`,
      fields: {
        title: { stringValue: 'Task' },
        done: { booleanValue: false },
      },
    });
    const created = await createDocument('items', 'item-1', { title: 'Task', done: false });
    expect(created).toEqual({ id: 'item-1', title: 'Task', done: false });

    // READ
    mockOkResponse({
      name: `${FIRESTORE_BASE}/items/item-1`,
      fields: {
        title: { stringValue: 'Task' },
        done: { booleanValue: false },
      },
    });
    const read = await getDocument('items', 'item-1');
    expect(read).toEqual({ id: 'item-1', title: 'Task', done: false });

    // UPDATE
    mockOkResponse({
      name: `${FIRESTORE_BASE}/items/item-1`,
      fields: {
        title: { stringValue: 'Task' },
        done: { booleanValue: true },
      },
    });
    const updated = await updateDocument('items', 'item-1', { done: true });
    expect(updated.done).toBe(true);

    // DELETE
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });
    await expect(deleteDocument('items', 'item-1')).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
