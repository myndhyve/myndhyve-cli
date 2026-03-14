import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockFormatRelativeTime,
  mockFormatTableRow,
  mockPrintError,
  mockCreateIntelRun,
  mockListIntelRuns,
  mockGetIntelRun,
  mockGetVoCRecords,
  mockGetAdAngles,
  mockGetTargetingPack,
  mockCancelIntelRun,
  mockListTemplates,
  mockGetTemplate,
  mockCreateTemplate,
  mockOraStart,
  mockOraStop,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockFormatTableRow: vi.fn(),
  mockPrintError: vi.fn(),
  mockCreateIntelRun: vi.fn(),
  mockListIntelRuns: vi.fn(),
  mockGetIntelRun: vi.fn(),
  mockGetVoCRecords: vi.fn(),
  mockGetAdAngles: vi.fn(),
  mockGetTargetingPack: vi.fn(),
  mockCancelIntelRun: vi.fn(),
  mockListTemplates: vi.fn(),
  mockGetTemplate: vi.fn(),
  mockCreateTemplate: vi.fn(),
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

vi.mock('../../api/marketIntel.js', () => ({
  createIntelRun: (...args: unknown[]) => mockCreateIntelRun(...args),
  listIntelRuns: (...args: unknown[]) => mockListIntelRuns(...args),
  getIntelRun: (...args: unknown[]) => mockGetIntelRun(...args),
  getVoCRecords: (...args: unknown[]) => mockGetVoCRecords(...args),
  getAdAngles: (...args: unknown[]) => mockGetAdAngles(...args),
  getTargetingPack: (...args: unknown[]) => mockGetTargetingPack(...args),
  cancelIntelRun: (...args: unknown[]) => mockCancelIntelRun(...args),
  listTemplates: (...args: unknown[]) => mockListTemplates(...args),
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
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

import { registerIntelCommands } from '../intel.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let program: Command;
let consoleSpy: MockInstance;

function createProgram(): Command {
  const prog = new Command();
  prog.exitOverride();
  registerIntelCommands(prog);
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

describe('intel commands', () => {
  describe('intel runs', () => {
    it('lists runs in a table', async () => {
      mockListIntelRuns.mockResolvedValue([
        { runId: 'run-1', status: 'completed', progress: 100, createdAt: '2026-01-01', resultsSummary: { vocRecordsExtracted: 50, anglesGenerated: 5, threadsAnalyzed: 20, duplicatesDetected: 3 } },
      ]);

      await run('intel', 'runs');

      expect(mockListIntelRuns).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('outputs JSON with --format json', async () => {
      const runs = [{ runId: 'run-1' }];
      mockListIntelRuns.mockResolvedValue(runs);

      await run('intel', 'runs', '--format', 'json');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(runs, null, 2));
    });
  });

  describe('intel run create', () => {
    it('creates a run from file', async () => {
      const config = {
        icp: { roles: ['CTO'], industries: ['SaaS'] },
        product: { name: 'Test', description: 'Desc', outcome: 'Result', differentiators: ['Fast'] },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(config));
      mockCreateIntelRun.mockResolvedValue({ runId: 'run-new', status: 'pending', progress: 0 });

      await run('intel', 'run', 'create', '--file', 'config.json');

      expect(mockCreateIntelRun).toHaveBeenCalledWith(config);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('run started'));
    });

    it('handles invalid file', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await run('intel', 'run', 'create', '--file', 'bad.json');

      expect(mockCreateIntelRun).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('intel run info', () => {
    it('shows run details', async () => {
      mockGetIntelRun.mockResolvedValue({
        runId: 'run-1',
        status: 'completed',
        progress: 100,
        createdAt: '2026-01-01',
        resultsSummary: { vocRecordsExtracted: 50, anglesGenerated: 5, threadsAnalyzed: 20, duplicatesDetected: 3 },
      });

      await run('intel', 'run', 'info', 'run-1');

      expect(mockGetIntelRun).toHaveBeenCalledWith('run-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('run-1'));
    });

    it('handles not found', async () => {
      mockGetIntelRun.mockResolvedValue(null);

      await run('intel', 'run', 'info', 'nonexistent');

      expect(process.exitCode).toBe(3);
    });
  });

  describe('intel run cancel', () => {
    it('cancels a run', async () => {
      mockCancelIntelRun.mockResolvedValue({ success: true });

      await run('intel', 'run', 'cancel', 'run-1');

      expect(mockCancelIntelRun).toHaveBeenCalledWith('run-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
    });
  });

  describe('intel voc', () => {
    it('outputs VoC records as JSON', async () => {
      const records = [{ id: 'voc-1', quote: 'Great product' }];
      mockGetVoCRecords.mockResolvedValue(records);

      await run('intel', 'voc', 'run-1');

      expect(mockGetVoCRecords).toHaveBeenCalledWith('run-1');
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(records, null, 2));
    });
  });

  describe('intel angles', () => {
    it('outputs ad angles as JSON', async () => {
      const angles = [{ id: 'angle-1', hook: 'Save time' }];
      mockGetAdAngles.mockResolvedValue(angles);

      await run('intel', 'angles', 'run-1');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(angles, null, 2));
    });
  });

  describe('intel targeting', () => {
    it('outputs targeting pack as JSON', async () => {
      const targeting = { audiences: [{ name: 'CTOs' }] };
      mockGetTargetingPack.mockResolvedValue(targeting);

      await run('intel', 'targeting', 'run-1');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(targeting, null, 2));
    });
  });

  describe('intel templates', () => {
    it('lists templates', async () => {
      mockListTemplates.mockResolvedValue([
        { id: 't-1', name: 'SaaS B2B', category: 'saas', source: 'builtin', tags: [] },
      ]);

      await run('intel', 'templates');

      expect(mockListTemplates).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('intel template info', () => {
    it('shows template details', async () => {
      mockGetTemplate.mockResolvedValue({
        id: 't-1', name: 'SaaS B2B', category: 'saas', source: 'builtin',
        description: 'For SaaS companies', tags: ['saas'], createdAt: '2026-01-01', updatedAt: '2026-01-01',
      });

      await run('intel', 'template', 'info', 't-1');

      expect(mockGetTemplate).toHaveBeenCalledWith('t-1');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SaaS B2B'));
    });
  });

  describe('intel template create', () => {
    it('creates a template from file', async () => {
      const templateDef = {
        name: 'Custom', description: 'Custom template', category: 'saas',
        icp: { roles: ['CMO'], industries: ['Tech'] },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(templateDef));
      mockCreateTemplate.mockResolvedValue({ id: 't-new', name: 'Custom', category: 'saas' });

      await run('intel', 'template', 'create', '--file', 'template.json');

      expect(mockCreateTemplate).toHaveBeenCalledWith(templateDef);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Template created'));
    });
  });
});
