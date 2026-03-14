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
  createIntelRun,
  listIntelRuns,
  getIntelRun,
  getVoCRecords,
  getAdAngles,
  getTargetingPack,
  cancelIntelRun,
  listTemplates,
  getTemplate,
  createTemplate,
} from '../marketIntel.js';

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

describe('MarketIntelAPI', () => {
  const mockRun = { runId: 'run-1', status: 'completed', progress: 100, createdAt: '2026-01-01' };

  describe('createIntelRun()', () => {
    it('sends POST to /marketIntelApi/v1/runs', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: mockRun }));

      const request = {
        icp: { roles: ['CTO'], industries: ['SaaS'] },
        product: { name: 'Test', description: 'Desc', outcome: 'Result', differentiators: ['Fast'] },
      };

      const result = await createIntelRun(request);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketIntelApi/v1/runs');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body).product.name).toBe('Test');
      expect(result.runId).toBe('run-1');
    });

    it('throws when API returns success: false', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        success: false,
        error: { code: 'QUOTA_EXCEEDED', message: 'Rate limit exceeded' },
      }));

      const request = {
        icp: { roles: ['CTO'], industries: ['SaaS'] },
        product: { name: 'Test', description: 'Desc', outcome: 'Result', differentiators: ['Fast'] },
      };

      await expect(createIntelRun(request)).rejects.toThrow(/Rate limit exceeded/);
    });
  });

  describe('listIntelRuns()', () => {
    it('sends GET and returns runs array', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [mockRun] }));

      const result = await listIntelRuns();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketIntelApi/v1/runs');
      expect(init.method).toBe('GET');
      expect(result).toHaveLength(1);
    });
  });

  describe('getIntelRun()', () => {
    it('sends GET with run ID', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: mockRun }));

      const result = await getIntelRun('run-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketIntelApi/v1/runs/run-1');
      expect(result?.runId).toBe('run-1');
    });

    it('returns null on error', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

      const result = await getIntelRun('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getVoCRecords()', () => {
    it('sends GET to /runs/:id/voc', async () => {
      const records = [{ id: 'voc-1', quote: 'Test quote' }];
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: records }));

      const result = await getVoCRecords('run-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/runs/run-1/voc');
      expect(result).toHaveLength(1);
    });
  });

  describe('getAdAngles()', () => {
    it('sends GET to /runs/:id/angles', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [{ id: 'angle-1' }] }));

      const result = await getAdAngles('run-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/runs/run-1/angles');
      expect(result).toHaveLength(1);
    });
  });

  describe('getTargetingPack()', () => {
    it('sends GET to /runs/:id/targeting', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: { audiences: [] } }));

      const result = await getTargetingPack('run-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/runs/run-1/targeting');
      expect(result).toBeTruthy();
    });
  });

  describe('cancelIntelRun()', () => {
    it('sends DELETE to /runs/:id', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      await cancelIntelRun('run-1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/runs/run-1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('listTemplates()', () => {
    it('sends GET to /templates', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [{ id: 't-1', name: 'SaaS' }] }));

      const result = await listTemplates();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketIntelApi/v1/templates');
      expect(result).toHaveLength(1);
    });
  });

  describe('getTemplate()', () => {
    it('sends GET with template ID', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: { id: 't-1', name: 'SaaS' } }));

      const result = await getTemplate('t-1');

      expect(result?.name).toBe('SaaS');
    });
  });

  describe('createTemplate()', () => {
    it('sends POST with template data', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: { id: 't-new', name: 'Custom' } }));

      const request = {
        name: 'Custom',
        description: 'A custom template',
        category: 'saas',
        icp: { roles: ['CMO'], industries: ['Tech'] },
      };

      const result = await createTemplate(request);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketIntelApi/v1/templates');
      expect(init.method).toBe('POST');
      expect(result.id).toBe('t-new');
    });

    it('throws when API returns success: false', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
      }));

      const request = {
        name: '',
        description: 'Bad template',
        category: 'saas',
        icp: { roles: ['CMO'], industries: ['Tech'] },
      };

      await expect(createTemplate(request)).rejects.toThrow(/Name is required/);
    });
  });
});
