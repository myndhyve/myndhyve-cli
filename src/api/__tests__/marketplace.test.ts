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
  searchMarketplace,
  getFeaturedListings,
  getListingDetails,
  installPack,
  uninstallPack,
  updateInstalledPack,
  getInstalledPacks,
  publishPack,
  getPurchases,
} from '../marketplace.js';

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

describe('MarketplaceAPI', () => {
  describe('searchMarketplace()', () => {
    it('sends GET request with query params', async () => {
      const payload = { listings: [], total: 0, page: 1, limit: 20 };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await searchMarketplace({ q: 'landing', packType: 'template', page: 2 });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceSearch');
      expect(url).toContain('q=landing');
      expect(url).toContain('packType=template');
      expect(url).toContain('page=2');
      expect(init.method).toBe('GET');
      expect(result).toEqual(payload);
    });

    it('sends request without params when none provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ listings: [], total: 0, page: 1, limit: 20 }));

      await searchMarketplace({});

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceSearch');
      expect(url).not.toContain('?');
    });
  });

  describe('getFeaturedListings()', () => {
    it('sends GET request to /marketplaceFeatured', async () => {
      const payload = { listings: [{ id: 'pack-1', name: 'Test Pack' }] };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await getFeaturedListings();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceFeatured');
      expect(init.method).toBe('GET');
      expect(result.listings).toHaveLength(1);
    });
  });

  describe('getListingDetails()', () => {
    it('sends GET request with encoded listing ID', async () => {
      const listing = { id: 'pack-1', name: 'Test', packType: 'template' };
      mockFetch.mockResolvedValue(jsonResponse({ listing }));

      const result = await getListingDetails('pack-1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceListing/pack-1');
      expect(result).toEqual(listing);
    });

    it('returns null on error', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

      const result = await getListingDetails('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('installPack()', () => {
    it('sends POST request with listingId', async () => {
      const payload = { success: true, packId: 'pack-1', version: '1.0.0' };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await installPack('listing-1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceInstall');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ listingId: 'listing-1' });
      expect(result.success).toBe(true);
    });

    it('throws on server error', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Internal error' }, 500));

      await expect(installPack('listing-1')).rejects.toThrow(/Internal error/);
    });
  });

  describe('uninstallPack()', () => {
    it('sends POST request with packId', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      const result = await uninstallPack('pack-1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceUninstall');
      expect(JSON.parse(init.body)).toEqual({ packId: 'pack-1' });
      expect(result.success).toBe(true);
    });
  });

  describe('updateInstalledPack()', () => {
    it('sends POST request with packId', async () => {
      const payload = { success: true, packId: 'pack-1', version: '2.0.0' };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await updateInstalledPack('pack-1');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceUpdatePack');
      expect(JSON.parse(init.body)).toEqual({ packId: 'pack-1' });
      expect(result.version).toBe('2.0.0');
    });
  });

  describe('getInstalledPacks()', () => {
    it('sends GET request to /marketplaceInstalled', async () => {
      const payload = { packs: [{ packId: 'pack-1', name: 'Test' }] };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await getInstalledPacks();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplaceInstalled');
      expect(init.method).toBe('GET');
      expect(result.packs).toHaveLength(1);
    });
  });

  describe('publishPack()', () => {
    it('sends POST request with full publish request', async () => {
      const payload = { success: true, listingId: 'listing-1', version: '1.0.0' };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const request = {
        packType: 'template' as const,
        packData: {},
        name: 'My Pack',
        description: 'A test pack',
        shortDescription: 'Test',
        category: 'templates',
        tags: ['test'],
        pricing: { type: 'free' as const },
        license: 'MIT',
      };

      const result = await publishPack(request);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplacePublish');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body).name).toBe('My Pack');
      expect(result.success).toBe(true);
    });
  });

  describe('getPurchases()', () => {
    it('sends GET request to /marketplacePurchases', async () => {
      const payload = { purchases: [] };
      mockFetch.mockResolvedValue(jsonResponse(payload));

      const result = await getPurchases();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/marketplacePurchases');
      expect(init.method).toBe('GET');
      expect(result.purchases).toEqual([]);
    });
  });
});
