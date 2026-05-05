import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

const {
  mockRequireAuth,
  mockPrintError,
  mockGetTodayUsage,
  mockGetUsageForDate,
  mockGetWorkspaceUsage,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockGetTodayUsage: vi.fn(),
  mockGetUsageForDate: vi.fn(),
  mockGetWorkspaceUsage: vi.fn(),
}));

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/usage.js', () => ({
  getTodayUsage: (...args: unknown[]) => mockGetTodayUsage(...args),
  getUsageForDate: (...args: unknown[]) => mockGetUsageForDate(...args),
  getWorkspaceUsage: (...args: unknown[]) => mockGetWorkspaceUsage(...args),
}));

vi.mock('../../api/client.js', () => ({
  MyndHyveClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: vi.fn(),
}));

import { registerUsageCommands } from '../usage.js';

const AUTH = { uid: 'user-1', email: 'test@test.com' };

const SAMPLE_USAGE = {
  date: '2026-03-28',
  userId: 'user-1',
  totalTokens: 50000,
  totalPromptTokens: 30000,
  totalCompletionTokens: 20000,
  totalEstimatedCostUsd: 0.15,
  requestCount: 25,
  byProvider: {
    anthropic: { tokens: 40000, requests: 20, estimatedCostUsd: 0.12 },
    openai: { tokens: 10000, requests: 5, estimatedCostUsd: 0.03 },
  },
  byCanvasType: {},
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerUsageCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

describe('usage commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    process.exitCode = undefined;
  });

  describe('usage summary', () => {
    it('shows today usage data', async () => {
      mockGetTodayUsage.mockResolvedValue(SAMPLE_USAGE);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['usage', 'summary']);
      expect(mockGetTodayUsage).toHaveBeenCalledWith('user-1');
      spy.mockRestore();
    });

    it('shows empty message when no data', async () => {
      mockGetTodayUsage.mockResolvedValue(null);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['usage', 'summary']);
      expect(mockGetTodayUsage).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('requires auth', async () => {
      mockRequireAuth.mockReturnValue(null);
      await run(['usage', 'summary']);
      expect(mockGetTodayUsage).not.toHaveBeenCalled();
    });
  });

  describe('usage date', () => {
    it('shows usage for specific date', async () => {
      mockGetUsageForDate.mockResolvedValue(SAMPLE_USAGE);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['usage', 'date', '2026-03-28']);
      expect(mockGetUsageForDate).toHaveBeenCalledWith('user-1', '2026-03-28');
      spy.mockRestore();
    });

    it('rejects invalid date format', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['usage', 'date', 'bad-date']);
      expect(mockGetUsageForDate).not.toHaveBeenCalled();
      expect(mockPrintError).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('shows empty message for date with no data', async () => {
      mockGetUsageForDate.mockResolvedValue(null);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['usage', 'date', '2026-01-01']);
      expect(mockGetUsageForDate).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // Phase 1.6 of the WOP A-grade closeout — `usage workspace` surfaces
  // the bySecretScope breakdown (run / user / tenant / platform) when
  // the Cloud Functions callable returns it. Optional in the response
  // shape so older deployments that don't surface bySecretScope still
  // render cleanly.
  describe('usage workspace — bySecretScope breakdown', () => {
    function workspaceSummary(extras: Partial<Record<string, unknown>> = {}) {
      return {
        workspaceId: 'ws-1',
        range: '7d' as const,
        fromDate: '2026-04-28',
        toDate: '2026-05-05',
        totalCostCents: 1234,
        totalTokens: 100_000,
        promptTokens: 60_000,
        completionTokens: 40_000,
        requestCount: 50,
        byProvider: { anthropic: { tokens: 80_000, costCents: 1000, requests: 40 } },
        byModel: { 'claude-sonnet-4-6': { tokens: 80_000, costCents: 1000, requests: 40 } },
        earliestHourBucket: '2026-04-28-09',
        ...extras,
      };
    }

    it('renders the human-label "By Secret Scope" block when populated', async () => {
      mockGetWorkspaceUsage.mockResolvedValue(
        workspaceSummary({
          bySecretScope: {
            user: { tokens: 60_000, costCents: 800, requests: 30 },
            platform: { tokens: 40_000, costCents: 434, requests: 20 },
          },
        }),
      );
      const captured: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        captured.push(args.map(String).join(' '));
      });
      try {
        await run(['usage', 'workspace', 'ws-1']);
      } finally {
        spy.mockRestore();
      }
      const out = captured.join('\n');
      expect(out).toContain('By Secret Scope:');
      expect(out).toContain('User BYOK');
      expect(out).toContain('Platform fallback');
      // Raw enum surfaced in dim text alongside the human label so
      // operators can match against logs / Firestore docs.
      expect(out).toContain('(user)');
      expect(out).toContain('(platform)');
    });

    it('omits the block when bySecretScope is missing or empty', async () => {
      mockGetWorkspaceUsage.mockResolvedValue(workspaceSummary()); // no bySecretScope
      const captured: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        captured.push(args.map(String).join(' '));
      });
      try {
        await run(['usage', 'workspace', 'ws-1']);
      } finally {
        spy.mockRestore();
      }
      const out = captured.join('\n');
      expect(out).not.toContain('By Secret Scope:');
    });
  });
});
