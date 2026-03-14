import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockFormatRelativeTime,
  mockFormatTableRow,
  mockPrintError,
  mockUploadPackContent,
  mockGetPackContent,
  mockListPackVersions,
  mockGetPackManifest,
  mockDeletePackVersion,
  mockGetPackDownloadUrl,
  mockOraStart,
  mockOraStop,
  mockReadFileSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockFormatTableRow: vi.fn(),
  mockPrintError: vi.fn(),
  mockUploadPackContent: vi.fn(),
  mockGetPackContent: vi.fn(),
  mockListPackVersions: vi.fn(),
  mockGetPackManifest: vi.fn(),
  mockDeletePackVersion: vi.fn(),
  mockGetPackDownloadUrl: vi.fn(),
  mockOraStart: vi.fn(),
  mockOraStop: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '\u2026' : s),
  formatRelativeTime: (...args: unknown[]) => mockFormatRelativeTime(...args),
  formatTableRow: (...args: unknown[]) => mockFormatTableRow(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/packStorage.js', () => ({
  uploadPackContent: (...args: unknown[]) => mockUploadPackContent(...args),
  getPackContent: (...args: unknown[]) => mockGetPackContent(...args),
  listPackVersions: (...args: unknown[]) => mockListPackVersions(...args),
  getPackManifest: (...args: unknown[]) => mockGetPackManifest(...args),
  deletePackVersion: (...args: unknown[]) => mockDeletePackVersion(...args),
  getPackDownloadUrl: (...args: unknown[]) => mockGetPackDownloadUrl(...args),
  formatBytes: (bytes: number) => `${bytes} B`,
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
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

import { registerPackCommands } from '../packs.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let program: Command;
let consoleSpy: MockInstance;

function createProgram(): Command {
  const prog = new Command();
  prog.exitOverride();
  registerPackCommands(prog);
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

describe('packs commands', () => {
  describe('packs upload', () => {
    it('uploads pack content from file', async () => {
      mockReadFileSync.mockReturnValue('{"data": "test"}');
      mockUploadPackContent.mockResolvedValue({
        success: true,
        packId: 'pack-1',
        version: '1.0.0',
        checksum: 'abc',
        size: 512,
      });

      await run('packs', 'upload', '--pack-id', 'pack-1', '--version', '1.0.0', '--content', 'pack.json');

      expect(mockUploadPackContent).toHaveBeenCalledWith(
        'pack-1', '1.0.0', { data: 'test' }, { changelog: undefined }
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('uploaded successfully'));
    });

    it('handles invalid file', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await run('packs', 'upload', '--pack-id', 'pack-1', '--version', '1.0.0', '--content', 'bad.json');

      expect(mockUploadPackContent).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('returns early if not authenticated', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run('packs', 'upload', '--pack-id', 'pack-1', '--version', '1.0.0', '--content', 'pack.json');

      expect(mockUploadPackContent).not.toHaveBeenCalled();
    });
  });

  describe('packs download', () => {
    it('downloads and prints content to stdout', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockGetPackContent.mockResolvedValue({
        success: true,
        packId: 'pack-1',
        version: '1.0.0',
        content: { hello: 'world' },
      });

      await run('packs', 'download', 'pack-1');

      expect(mockGetPackContent).toHaveBeenCalledWith('pack-1', undefined);
      expect(stdoutSpy).toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });

    it('writes to file with --output', async () => {
      mockGetPackContent.mockResolvedValue({
        success: true,
        packId: 'pack-1',
        version: '1.0.0',
        content: { data: 'test' },
      });

      await run('packs', 'download', 'pack-1', '1.0.0', '--output', 'out.json');

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        'out.json',
        JSON.stringify({ data: 'test' }, null, 2),
        'utf-8'
      );
    });
  });

  describe('packs versions', () => {
    it('lists versions in a table', async () => {
      mockListPackVersions.mockResolvedValue({
        success: true,
        versions: [
          { version: '1.0.0', checksum: 'abc', size: 512, publishedAt: '2026-01-01', downloads: 10 },
        ],
      });

      await run('packs', 'versions', 'pack-1');

      expect(mockListPackVersions).toHaveBeenCalledWith('pack-1', {
        limit: 20,
        includeChangelog: undefined,
      });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('outputs JSON with --format json', async () => {
      const versions = [{ version: '1.0.0' }];
      mockListPackVersions.mockResolvedValue({ success: true, versions });

      await run('packs', 'versions', 'pack-1', '--format', 'json');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(versions, null, 2));
    });
  });

  describe('packs manifest', () => {
    it('displays manifest details', async () => {
      mockGetPackManifest.mockResolvedValue({
        success: true,
        manifest: {
          packId: 'pack-1',
          version: '1.0.0',
          name: 'Test Pack',
          packType: 'template',
          size: 1024,
          checksum: 'abc123',
          componentCount: 5,
          publisherId: 'user-1',
          dependencies: [],
          createdAt: '2026-01-01',
        },
      });

      await run('packs', 'manifest', 'pack-1', '1.0.0');

      expect(mockGetPackManifest).toHaveBeenCalledWith('pack-1', '1.0.0');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Pack'));
    });

    it('handles not found', async () => {
      mockGetPackManifest.mockResolvedValue({ success: false });

      await run('packs', 'manifest', 'pack-1', '9.9.9');

      expect(process.exitCode).toBe(3);
    });
  });

  describe('packs download-url', () => {
    it('displays signed URL', async () => {
      mockGetPackDownloadUrl.mockResolvedValue({
        success: true,
        url: 'https://storage.example.com/signed',
        expiresAt: '2026-03-14T16:00:00Z',
      });

      await run('packs', 'download-url', 'pack-1', '1.0.0');

      expect(mockGetPackDownloadUrl).toHaveBeenCalledWith('pack-1', '1.0.0');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('https://storage.example.com/signed'));
    });
  });
});
