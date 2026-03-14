import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock auth module ─────────────────────────────────────────────────────────

vi.mock('../../auth/index.js', () => ({
  getToken: vi.fn(),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
    }
  },
}));

import { getToken } from '../../auth/index.js';
import { _resetAPIClientForTests } from '../client.js';
import {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  exportEntities,
  importEntities,
} from '../entities.js';

const mockGetToken = getToken as ReturnType<typeof vi.fn>;

// ── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetToken.mockReset();
  mockFetch.mockReset();
  mockGetToken.mockResolvedValue('test-id-token');
  _resetAPIClientForTests();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('EntityAPI', () => {
  const basePath = '/entityApi/api/v1/projects/proj-1/entities/products';

  describe('listEntities()', () => {
    it('sends GET with project and entity type in path', async () => {
      const payload = {
        data: [{ id: 'e-1', title: 'Widget', status: 'published' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
      };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await listEntities('proj-1', 'products', { page: 1, limit: 20 });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(basePath);
      expect(url).toContain('page=1');
      expect(url).toContain('limit=20');
      expect(init.method).toBe('GET');
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getEntity()', () => {
    it('sends GET with entity ID', async () => {
      const entity = { id: 'e-1', title: 'Widget', slug: 'widget', status: 'published', data: { price: 9.99 } };
      mockFetch.mockResolvedValue(jsonResponse({ data: entity }));

      const result = await getEntity('proj-1', 'products', 'e-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`${basePath}/e-1`);
      expect(result?.title).toBe('Widget');
    });

    it('returns null on error', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

      const result = await getEntity('proj-1', 'products', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createEntity()', () => {
    it('sends POST with entity data', async () => {
      const created = { id: 'e-new', title: 'Gadget', slug: 'gadget', status: 'draft', data: { price: 19.99 } };
      mockFetch.mockResolvedValue(jsonResponse({ data: created }));

      const result = await createEntity('proj-1', 'products', {
        title: 'Gadget',
        data: { price: 19.99 },
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(basePath);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body).title).toBe('Gadget');
      expect(result.id).toBe('e-new');
    });
  });

  describe('updateEntity()', () => {
    it('sends PATCH with update data', async () => {
      const updated = { id: 'e-1', title: 'Updated Widget', slug: 'widget', status: 'published', data: {} };
      mockFetch.mockResolvedValue(jsonResponse({ data: updated }));

      const result = await updateEntity('proj-1', 'products', 'e-1', {
        title: 'Updated Widget',
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`${basePath}/e-1`);
      expect(init.method).toBe('PATCH');
      expect(result.title).toBe('Updated Widget');
    });
  });

  describe('deleteEntity()', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 204));

      await deleteEntity('proj-1', 'products', 'e-1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`${basePath}/e-1`);
      expect(init.method).toBe('DELETE');
    });
  });

  describe('exportEntities()', () => {
    it('sends GET to /export', async () => {
      const data = [{ id: 'e-1', title: 'Widget' }];
      mockFetch.mockResolvedValue(jsonResponse(data));

      const result = await exportEntities('proj-1', 'products');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(`${basePath}/export`);
      expect(result).toHaveLength(1);
    });
  });

  describe('importEntities()', () => {
    it('sends POST to /import with entities array', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ imported: 5, errors: 0 }));

      const entities = [{ title: 'A' }, { title: 'B' }];
      const result = await importEntities('proj-1', 'products', entities);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(`${basePath}/import`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body).entities).toHaveLength(2);
      expect(result.imported).toBe(5);
    });
  });
});
