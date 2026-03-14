import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockFormatRelativeTime,
  mockFormatTableRow,
  mockPrintError,
  mockSearchMarketplace,
  mockGetFeaturedListings,
  mockGetListingDetails,
  mockInstallPack,
  mockUninstallPack,
  mockUpdateInstalledPack,
  mockGetInstalledPacks,
  mockPublishPack,
  mockGetPurchases,
  mockOraStart,
  mockOraStop,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockFormatTableRow: vi.fn(),
  mockPrintError: vi.fn(),
  mockSearchMarketplace: vi.fn(),
  mockGetFeaturedListings: vi.fn(),
  mockGetListingDetails: vi.fn(),
  mockInstallPack: vi.fn(),
  mockUninstallPack: vi.fn(),
  mockUpdateInstalledPack: vi.fn(),
  mockGetInstalledPacks: vi.fn(),
  mockPublishPack: vi.fn(),
  mockGetPurchases: vi.fn(),
  mockOraStart: vi.fn(),
  mockOraStop: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '\u2026' : s),
  formatRelativeTime: (...args: unknown[]) => mockFormatRelativeTime(...args),
  formatTableRow: (...args: unknown[]) => mockFormatTableRow(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/marketplace.js', () => ({
  searchMarketplace: (...args: unknown[]) => mockSearchMarketplace(...args),
  getFeaturedListings: (...args: unknown[]) => mockGetFeaturedListings(...args),
  getListingDetails: (...args: unknown[]) => mockGetListingDetails(...args),
  installPack: (...args: unknown[]) => mockInstallPack(...args),
  uninstallPack: (...args: unknown[]) => mockUninstallPack(...args),
  updateInstalledPack: (...args: unknown[]) => mockUpdateInstalledPack(...args),
  getInstalledPacks: (...args: unknown[]) => mockGetInstalledPacks(...args),
  publishPack: (...args: unknown[]) => mockPublishPack(...args),
  getPurchases: (...args: unknown[]) => mockGetPurchases(...args),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: vi.fn(),
}));

vi.mock('ora', () => {
  const spinner = {
    start: (...args: unknown[]) => { mockOraStart(...args); return spinner; },
    stop: (...args: unknown[]) => { mockOraStop(...args); return spinner; },
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  };
  return { default: () => spinner };
});

vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { registerMarketplaceCommands } from '../marketplace.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let program: Command;
let consoleSpy: MockInstance;

function createProgram(): Command {
  const prog = new Command();
  prog.exitOverride();
  registerMarketplaceCommands(prog);
  return prog;
}

async function run(...args: string[]): Promise<void> {
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  program = createProgram();
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  mockRequireAuth.mockReturnValue({ uid: 'user-1', email: 'test@example.com' });
  mockFormatTableRow.mockReturnValue('  mock-table-row');
  mockFormatRelativeTime.mockReturnValue('2d ago');
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ============================================================================
// Tests
// ============================================================================

describe('marketplace commands', () => {
  describe('marketplace search', () => {
    it('calls searchMarketplace and prints results', async () => {
      mockSearchMarketplace.mockResolvedValue({
        listings: [{ id: 'p1', name: 'Pack', packType: 'template', stats: { rating: 4.5, downloads: 100, reviewCount: 5 }, pricing: { type: 'free' } }],
        total: 1,
        page: 1,
        limit: 20,
      });

      await run('marketplace', 'search', 'landing');

      expect(mockSearchMarketplace).toHaveBeenCalledWith({
        q: 'landing',
        packType: undefined,
        category: undefined,
        pricing: undefined,
        sortBy: 'relevance',
        page: 1,
        limit: 20,
      });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('outputs JSON when --format json', async () => {
      const result = { listings: [], total: 0, page: 1, limit: 20 };
      mockSearchMarketplace.mockResolvedValue(result);

      await run('marketplace', 'search', '--format', 'json');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });

    it('returns early if not authenticated', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run('marketplace', 'search');

      expect(mockSearchMarketplace).not.toHaveBeenCalled();
    });
  });

  describe('marketplace featured', () => {
    it('calls getFeaturedListings', async () => {
      mockGetFeaturedListings.mockResolvedValue({ listings: [] });

      await run('marketplace', 'featured');

      expect(mockGetFeaturedListings).toHaveBeenCalledOnce();
    });
  });

  describe('marketplace info', () => {
    it('displays listing details', async () => {
      mockGetListingDetails.mockResolvedValue({
        id: 'pack-1',
        name: 'My Pack',
        packType: 'template',
        version: '1.0.0',
        category: 'design',
        shortDescription: 'A test pack',
        description: 'A longer description',
        pricing: { type: 'free' },
        stats: { rating: 4.2, downloads: 500, reviewCount: 10 },
        publisherId: 'user-1',
        publisherName: 'Test User',
        license: 'MIT',
        tags: ['design'],
        screenshots: [],
        dependencies: [],
      });

      await run('marketplace', 'info', 'pack-1');

      expect(mockGetListingDetails).toHaveBeenCalledWith('pack-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('My Pack'));
    });

    it('handles not found', async () => {
      mockGetListingDetails.mockResolvedValue(null);

      await run('marketplace', 'info', 'nonexistent');

      expect(process.exitCode).toBe(3);
    });
  });

  describe('marketplace install', () => {
    it('installs a pack', async () => {
      mockInstallPack.mockResolvedValue({ success: true, packId: 'pack-1', version: '1.0.0' });

      await run('marketplace', 'install', 'listing-1');

      expect(mockInstallPack).toHaveBeenCalledWith('listing-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('installed successfully'));
    });
  });

  describe('marketplace uninstall', () => {
    it('uninstalls a pack with --force', async () => {
      mockUninstallPack.mockResolvedValue({ success: true });

      await run('marketplace', 'uninstall', 'pack-1', '--force');

      expect(mockUninstallPack).toHaveBeenCalledWith('pack-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('uninstalled'));
    });

    it('returns early if not authenticated', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run('marketplace', 'uninstall', 'pack-1', '--force');

      expect(mockUninstallPack).not.toHaveBeenCalled();
    });
  });

  describe('marketplace update', () => {
    it('updates a pack', async () => {
      mockUpdateInstalledPack.mockResolvedValue({ success: true, packId: 'pack-1', version: '2.0.0' });

      await run('marketplace', 'update', 'pack-1');

      expect(mockUpdateInstalledPack).toHaveBeenCalledWith('pack-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('updated successfully'));
    });
  });

  describe('marketplace installed', () => {
    it('lists installed packs', async () => {
      mockGetInstalledPacks.mockResolvedValue({
        packs: [{
          packId: 'pack-1',
          name: 'Test Pack',
          packType: 'template',
          installedVersion: '1.0.0',
          hasUpdate: true,
        }],
      });

      await run('marketplace', 'installed');

      expect(mockGetInstalledPacks).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('marketplace publish', () => {
    it('publishes a pack from file', async () => {
      const publishRequest = {
        packType: 'template',
        packData: {},
        name: 'My Pack',
        description: 'Test',
        shortDescription: 'Test',
        category: 'design',
        tags: [],
        pricing: { type: 'free' },
        license: 'MIT',
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(publishRequest));
      mockPublishPack.mockResolvedValue({ success: true, listingId: 'listing-1', version: '1.0.0' });

      await run('marketplace', 'publish', '--file', 'pack.json');

      expect(mockPublishPack).toHaveBeenCalledWith(publishRequest);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('published successfully'));
    });

    it('handles invalid file', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await run('marketplace', 'publish', '--file', 'nonexistent.json');

      expect(mockPublishPack).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('rejects manifest missing required fields', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'Incomplete' }));

      await run('marketplace', 'publish', '--file', 'bad-manifest.json');

      expect(mockPublishPack).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('marketplace purchases', () => {
    it('lists purchases', async () => {
      mockGetPurchases.mockResolvedValue({
        purchases: [{
          purchaseId: 'pur-1',
          name: 'Pro Pack',
          packType: 'template',
          amount: 9.99,
          currency: 'USD',
          purchasedAt: '2026-01-15T00:00:00Z',
        }],
      });

      await run('marketplace', 'purchases');

      expect(mockGetPurchases).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
