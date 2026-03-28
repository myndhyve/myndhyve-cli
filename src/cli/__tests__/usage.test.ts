import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

const {
  mockRequireAuth,
  mockPrintError,
  mockGetTodayUsage,
  mockGetUsageForDate,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockGetTodayUsage: vi.fn(),
  mockGetUsageForDate: vi.fn(),
}));

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/usage.js', () => ({
  getTodayUsage: (...args: unknown[]) => mockGetTodayUsage(...args),
  getUsageForDate: (...args: unknown[]) => mockGetUsageForDate(...args),
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
});
