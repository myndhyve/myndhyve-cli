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
  uploadPackContent,
  getPackContent,
  listPackVersions,
  getPackManifest,
  deletePackVersion,
  getPackDownloadUrl,
  formatBytes,
} from '../packStorage.js';

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

describe('PackStorageAPI', () => {
  describe('uploadPackContent()', () => {
    it('sends POST with pack content', async () => {
      const payload = { success: true, packId: 'pack-1', version: '1.0.0', checksum: 'abc123', size: 1024 };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await uploadPackContent('pack-1', '1.0.0', { data: 'test' }, { changelog: 'Initial release' });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/packStorageUpload');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.packId).toBe('pack-1');
      expect(body.version).toBe('1.0.0');
      expect(body.content).toEqual({ data: 'test' });
      expect(body.changelog).toBe('Initial release');
      expect(result.success).toBe(true);
    });
  });

  describe('getPackContent()', () => {
    it('sends GET with query params', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, packId: 'pack-1', version: '1.0.0', content: {} }));

      await getPackContent('pack-1', '1.0.0');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/packStorageContent');
      expect(url).toContain('packId=pack-1');
      expect(url).toContain('version=1.0.0');
      expect(init.method).toBe('GET');
    });

    it('omits version when not provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, packId: 'pack-1', version: '2.0.0', content: {} }));

      await getPackContent('pack-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain('version=');
    });
  });

  describe('listPackVersions()', () => {
    it('sends GET with packId', async () => {
      const versions = [{ version: '1.0.0', checksum: 'abc', size: 512, publishedAt: '2026-01-01', downloads: 10 }];
      mockFetch.mockResolvedValue(jsonResponse({ success: true, versions }));

      const result = await listPackVersions('pack-1', { limit: 5, includeChangelog: true });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('packId=pack-1');
      expect(url).toContain('limit=5');
      expect(url).toContain('includeChangelog=true');
      expect(result.versions).toHaveLength(1);
    });
  });

  describe('getPackManifest()', () => {
    it('sends GET with packId and version', async () => {
      const manifest = { packId: 'pack-1', version: '1.0.0', name: 'Test', packType: 'template' };
      mockFetch.mockResolvedValue(jsonResponse({ success: true, manifest }));

      const result = await getPackManifest('pack-1', '1.0.0');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/packStorageManifest');
      expect(url).toContain('packId=pack-1');
      expect(url).toContain('version=1.0.0');
      expect(result.manifest?.name).toBe('Test');
    });
  });

  describe('deletePackVersion()', () => {
    it('sends DELETE with query params in URL', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      const result = await deletePackVersion('pack-1', '1.0.0');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/packStorageDeleteVersion');
      expect(url).toContain('packId=pack-1');
      expect(url).toContain('version=1.0.0');
      expect(init.method).toBe('DELETE');
      expect(result.success).toBe(true);
    });
  });

  describe('getPackDownloadUrl()', () => {
    it('sends GET and returns URL', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        success: true,
        url: 'https://storage.googleapis.com/signed-url',
        expiresAt: '2026-03-14T15:00:00Z',
      }));

      const result = await getPackDownloadUrl('pack-1', '1.0.0');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/packStorageDownloadUrl');
      expect(result.url).toContain('signed-url');
    });
  });

  describe('formatBytes()', () => {
    it('formats bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1073741824)).toBe('1.0 GB');
    });
  });
});
