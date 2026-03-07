import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockStatSync,
  mockUnlinkSync,
  mockRandomBytes,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockRandomBytes: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readdirSync: vi.fn(() => []),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock('node:crypto', () => ({
  randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
}));

vi.mock('../store.js', () => ({
  getCronDir: () => '/home/user/.myndhyve-cli/cron',
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Import SUT ────────────────────────────────────────────────────────────────

import {
  getRunsDir,
  generateRunId,
  appendRun,
  listRuns,
  getLastRun,
  pruneRunLog,
  clearRunHistory,
} from '../history.js';
import type { RunRecord } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run-abc123-deadbeef',
    jobId: 'job-test123',
    jobName: 'Test Job',
    status: 'success',
    startedAt: '2026-03-07T12:00:00.000Z',
    actionType: 'workflow',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronHistory', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockStatSync.mockReset();
    mockUnlinkSync.mockReset();
    mockRandomBytes.mockReset();

    mockExistsSync.mockReturnValue(true);
    // Default: file is small enough to skip pruning
    mockStatSync.mockReturnValue({ size: 100 });
  });

  // ── getRunsDir ────────────────────────────────────────────────────────

  describe('getRunsDir', () => {
    it('creates runs directory when missing', () => {
      mockExistsSync.mockReturnValue(false);
      const dir = getRunsDir();
      expect(dir).toBe('/home/user/.myndhyve-cli/cron/runs');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/home/user/.myndhyve-cli/cron/runs',
        { recursive: true, mode: 0o700 },
      );
    });
  });

  // ── generateRunId ─────────────────────────────────────────────────────

  describe('generateRunId', () => {
    it('produces run-{base36timestamp}-{8hex}', () => {
      mockRandomBytes.mockReturnValue(Buffer.from('aabbccdd', 'hex'));
      const id = generateRunId();
      expect(id).toMatch(/^run-[a-z0-9]+-aabbccdd$/);
    });
  });

  // ── appendRun ─────────────────────────────────────────────────────────

  describe('appendRun', () => {
    it('appends JSONL line to existing file', () => {
      const existing = JSON.stringify(makeRunRecord({ runId: 'run-old' })) + '\n';
      mockReadFileSync.mockReturnValue(existing);

      const record = makeRunRecord({ runId: 'run-new' });
      appendRun(record);

      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      expect(writtenContent).toContain('"run-old"');
      expect(writtenContent).toContain('"run-new"');
    });

    it('creates new file when none exists', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.endsWith('.jsonl')) return false;
        return true; // directories exist
      });

      const record = makeRunRecord();
      appendRun(record);

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      expect(writtenContent).toContain(record.runId);
    });
  });

  // ── listRuns ──────────────────────────────────────────────────────────

  describe('listRuns', () => {
    it('returns records newest-first', () => {
      const r1 = makeRunRecord({ runId: 'run-1', startedAt: '2026-03-07T10:00:00Z' });
      const r2 = makeRunRecord({ runId: 'run-2', startedAt: '2026-03-07T11:00:00Z' });
      const content = JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n';
      mockReadFileSync.mockReturnValue(content);

      const runs = listRuns('job-test123');
      expect(runs).toHaveLength(2);
      expect(runs[0].runId).toBe('run-2'); // Newest first (reversed)
      expect(runs[1].runId).toBe('run-1');
    });

    it('respects limit', () => {
      const records = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify(makeRunRecord({ runId: `run-${i}` })),
      );
      mockReadFileSync.mockReturnValue(records.join('\n') + '\n');

      const runs = listRuns('job-test123', 3);
      expect(runs).toHaveLength(3);
    });

    it('returns empty array when file does not exist', () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.endsWith('.jsonl')) return false;
        return true;
      });

      expect(listRuns('job-missing')).toEqual([]);
    });

    it('skips unparseable lines', () => {
      const valid = JSON.stringify(makeRunRecord({ runId: 'run-good' }));
      const content = valid + '\nnot-json\n' + valid + '\n';
      mockReadFileSync.mockReturnValue(content);

      const runs = listRuns('job-test123');
      expect(runs).toHaveLength(2);
    });
  });

  // ── getLastRun ────────────────────────────────────────────────────────

  describe('getLastRun', () => {
    it('returns the most recent run', () => {
      const r1 = makeRunRecord({ runId: 'run-1' });
      const r2 = makeRunRecord({ runId: 'run-2' });
      mockReadFileSync.mockReturnValue(
        JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n',
      );

      const last = getLastRun('job-test123');
      expect(last?.runId).toBe('run-2'); // Last appended = newest after reverse
    });

    it('returns null for empty history', () => {
      mockExistsSync.mockImplementation((path: string) =>
        !path.endsWith('.jsonl'),
      );
      expect(getLastRun('job-missing')).toBeNull();
    });
  });

  // ── pruneRunLog ───────────────────────────────────────────────────────

  describe('pruneRunLog', () => {
    it('no-ops when file is within size limit', () => {
      mockStatSync.mockReturnValue({ size: 500 });
      pruneRunLog('job-test123', 2_000_000, 2000);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('truncates to keepLines when file exceeds maxBytes', () => {
      mockStatSync.mockReturnValue({ size: 3_000_000 });
      const lines = Array.from({ length: 100 }, (_, i) =>
        JSON.stringify(makeRunRecord({ runId: `run-${i}` })),
      );
      mockReadFileSync.mockReturnValue(lines.join('\n') + '\n');

      pruneRunLog('job-test123', 1000, 10);

      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      const keptLines = writtenContent.trim().split('\n');
      expect(keptLines).toHaveLength(10);
      // Should keep the last 10 lines (newest)
      expect(keptLines[0]).toContain('run-90');
    });
  });

  // ── clearRunHistory ───────────────────────────────────────────────────

  describe('clearRunHistory', () => {
    it('deletes the JSONL file and returns true', () => {
      expect(clearRunHistory('job-test123')).toBe(true);
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('returns false when file does not exist', () => {
      mockExistsSync.mockImplementation((path: string) =>
        !path.endsWith('.jsonl'),
      );
      expect(clearRunHistory('job-missing')).toBe(false);
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });
});
