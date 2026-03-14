import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockFormatRelativeTime,
  mockFormatTableRow,
  mockPrintError,
  mockListEntities,
  mockGetEntity,
  mockCreateEntity,
  mockUpdateEntity,
  mockDeleteEntity,
  mockExportEntities,
  mockImportEntities,
  mockGetActiveContext,
  mockOraStart,
  mockOraStop,
  mockReadFileSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockFormatTableRow: vi.fn(),
  mockPrintError: vi.fn(),
  mockListEntities: vi.fn(),
  mockGetEntity: vi.fn(),
  mockCreateEntity: vi.fn(),
  mockUpdateEntity: vi.fn(),
  mockDeleteEntity: vi.fn(),
  mockExportEntities: vi.fn(),
  mockImportEntities: vi.fn(),
  mockGetActiveContext: vi.fn(),
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

vi.mock('../../api/entities.js', () => ({
  listEntities: (...args: unknown[]) => mockListEntities(...args),
  getEntity: (...args: unknown[]) => mockGetEntity(...args),
  createEntity: (...args: unknown[]) => mockCreateEntity(...args),
  updateEntity: (...args: unknown[]) => mockUpdateEntity(...args),
  deleteEntity: (...args: unknown[]) => mockDeleteEntity(...args),
  exportEntities: (...args: unknown[]) => mockExportEntities(...args),
  importEntities: (...args: unknown[]) => mockImportEntities(...args),
}));

vi.mock('../../context.js', () => ({
  getActiveContext: (...args: unknown[]) => mockGetActiveContext(...args),
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

import { registerEntityCommands } from '../entities.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let program: Command;
let consoleSpy: MockInstance;

function createProgram(): Command {
  const prog = new Command();
  prog.exitOverride();
  registerEntityCommands(prog);
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
  mockGetActiveContext.mockReturnValue({ projectId: 'proj-1', projectName: 'Test Project' });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ============================================================================
// Tests
// ============================================================================

describe('entities commands', () => {
  describe('entities list', () => {
    it('lists entities using active project', async () => {
      mockListEntities.mockResolvedValue({
        data: [{ id: 'e-1', title: 'Widget', status: 'published', updatedAt: '2026-01-01' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
      });

      await run('entities', 'list', 'products');

      expect(mockListEntities).toHaveBeenCalledWith('proj-1', 'products', expect.any(Object));
    });

    it('uses explicit --project over active context', async () => {
      mockListEntities.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      });

      await run('entities', 'list', 'products', '--project', 'other-proj');

      expect(mockListEntities).toHaveBeenCalledWith('other-proj', 'products', expect.any(Object));
    });

    it('errors when no project available', async () => {
      mockGetActiveContext.mockReturnValue(null);

      await run('entities', 'list', 'products');

      expect(mockListEntities).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
    });
  });

  describe('entities get', () => {
    it('shows entity details', async () => {
      mockGetEntity.mockResolvedValue({
        id: 'e-1', title: 'Widget', slug: 'widget', status: 'published',
        data: { price: 9.99 }, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      });

      await run('entities', 'get', 'products', 'e-1');

      expect(mockGetEntity).toHaveBeenCalledWith('proj-1', 'products', 'e-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Widget'));
    });

    it('handles not found', async () => {
      mockGetEntity.mockResolvedValue(null);

      await run('entities', 'get', 'products', 'nonexistent');

      expect(process.exitCode).toBe(3);
    });
  });

  describe('entities create', () => {
    it('creates an entity', async () => {
      mockCreateEntity.mockResolvedValue({
        id: 'e-new', title: 'Gadget', slug: 'gadget', status: 'draft',
      });

      await run('entities', 'create', 'products', '--title', 'Gadget', '--data', '{"price":19.99}');

      expect(mockCreateEntity).toHaveBeenCalledWith('proj-1', 'products', {
        title: 'Gadget',
        data: { price: 19.99 },
        status: 'draft',
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Entity created'));
    });

    it('errors on invalid JSON data', async () => {
      await run('entities', 'create', 'products', '--title', 'Bad', '--data', 'not-json');

      expect(process.exitCode).toBe(1);
      expect(mockCreateEntity).not.toHaveBeenCalled();
    });
  });

  describe('entities update', () => {
    it('updates an entity', async () => {
      mockUpdateEntity.mockResolvedValue({
        id: 'e-1', title: 'Updated', slug: 'widget', status: 'published',
      });

      await run('entities', 'update', 'products', 'e-1', '--title', 'Updated');

      expect(mockUpdateEntity).toHaveBeenCalledWith('proj-1', 'products', 'e-1', { title: 'Updated' });
    });

    it('errors when no update fields provided', async () => {
      await run('entities', 'update', 'products', 'e-1');

      expect(process.exitCode).toBe(2);
      expect(mockUpdateEntity).not.toHaveBeenCalled();
    });
  });

  describe('entities export', () => {
    it('exports to stdout by default', async () => {
      const data = [{ id: 'e-1', title: 'Widget' }];
      mockExportEntities.mockResolvedValue(data);
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await run('entities', 'export', 'products');

      expect(mockExportEntities).toHaveBeenCalledWith('proj-1', 'products');
      expect(stdoutSpy).toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });

    it('writes to file with --output', async () => {
      mockExportEntities.mockResolvedValue([{ id: 'e-1' }]);

      await run('entities', 'export', 'products', '--output', 'out.json');

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        'out.json',
        JSON.stringify([{ id: 'e-1' }], null, 2),
        'utf-8'
      );
    });
  });

  describe('entities import', () => {
    it('imports entities from file', async () => {
      const entities = [{ title: 'A' }, { title: 'B' }];
      mockReadFileSync.mockReturnValue(JSON.stringify(entities));
      mockImportEntities.mockResolvedValue({ imported: 2, errors: 0 });

      await run('entities', 'import', 'products', '--file', 'data.json');

      expect(mockImportEntities).toHaveBeenCalledWith('proj-1', 'products', entities);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Import complete'));
    });

    it('errors on invalid file', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await run('entities', 'import', 'products', '--file', 'bad.json');

      expect(process.exitCode).toBe(1);
    });
  });
});
