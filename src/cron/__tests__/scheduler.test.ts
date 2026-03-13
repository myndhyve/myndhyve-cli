import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockLoadJobs,
  mockUpdateJobRunState,
  mockRemoveJob,
  mockGetJob,
  mockGetJobsFilePath,
  mockExecuteAction,
  mockAppendRun,
  mockGenerateRunId,
  mockWatch,
} = vi.hoisted(() => ({
  mockLoadJobs: vi.fn(),
  mockUpdateJobRunState: vi.fn(),
  mockRemoveJob: vi.fn(),
  mockGetJob: vi.fn(),
  mockGetJobsFilePath: vi.fn(),
  mockExecuteAction: vi.fn(),
  mockAppendRun: vi.fn(),
  mockGenerateRunId: vi.fn(),
  mockWatch: vi.fn(),
}));

vi.mock('../store.js', () => ({
  loadJobs: () => mockLoadJobs(),
  updateJobRunState: (...args: unknown[]) => mockUpdateJobRunState(...args),
  removeJob: (...args: unknown[]) => mockRemoveJob(...args),
  getJob: (...args: unknown[]) => mockGetJob(...args),
  getJobsFilePath: () => mockGetJobsFilePath(),
}));

vi.mock('../executor.js', () => ({
  executeAction: (...args: unknown[]) => mockExecuteAction(...args),
}));

vi.mock('../history.js', () => ({
  appendRun: (...args: unknown[]) => mockAppendRun(...args),
  generateRunId: () => mockGenerateRunId(),
}));

vi.mock('node:fs', () => ({
  watch: (...args: unknown[]) => mockWatch(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Cron callback capture — stores callbacks keyed by expression
const cronCallbacks: Map<string, () => void> = new Map();

vi.mock('croner', () => ({
  Cron: vi.fn().mockImplementation((expr: string, _opts: unknown, callback?: () => void) => {
    if (callback) cronCallbacks.set(expr, callback);
    return {
      stop: vi.fn(),
      nextRun: vi.fn(() => new Date('2026-03-08T09:00:00Z')),
    };
  }),
}));

// ── Import SUT ────────────────────────────────────────────────────────────────

import { Scheduler } from '../scheduler.js';
import type { CronJob } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    jobId: 'job-test123',
    name: 'Test Job',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    action: { type: 'workflow', workflowId: 'wf-1', canvasTypeId: 'landing-page' },
    createdAt: '2026-03-07T00:00:00.000Z',
    updatedAt: '2026-03-07T00:00:00.000Z',
    consecutiveFailures: 0,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    mockLoadJobs.mockReset();
    mockUpdateJobRunState.mockReset();
    mockRemoveJob.mockReset();
    mockGetJob.mockReset();
    mockGetJobsFilePath.mockReset();
    mockExecuteAction.mockReset();
    mockAppendRun.mockReset();
    mockGenerateRunId.mockReset();
    mockWatch.mockReset();

    mockLoadJobs.mockReturnValue([]);
    mockGetJobsFilePath.mockReturnValue('/tmp/jobs.json');
    mockGenerateRunId.mockReturnValue('run-test-abc');
    mockWatch.mockReturnValue({ unref: vi.fn(), close: vi.fn() });
    cronCallbacks.clear();

    scheduler = new Scheduler();
  });

  afterEach(() => {
    if (scheduler.isRunning()) {
      scheduler.stop();
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and reports running status', () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
      expect(scheduler.getStatus().running).toBe(true);
    });

    it('stops and clears all state', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
      expect(scheduler.getStatus().jobCount).toBe(0);
    });

    it('loads jobs on start', () => {
      mockLoadJobs.mockReturnValue([makeCronJob()]);
      scheduler.start();
      expect(mockLoadJobs).toHaveBeenCalled();
      expect(scheduler.getStatus().jobCount).toBe(1);
    });

    it('sets up file watcher on start', () => {
      scheduler.start();
      expect(mockWatch).toHaveBeenCalledWith('/tmp/jobs.json', expect.any(Function));
    });
  });

  // ── Scheduling ────────────────────────────────────────────────────────

  describe('scheduling', () => {
    it('schedules enabled cron jobs', () => {
      mockLoadJobs.mockReturnValue([
        makeCronJob({ jobId: 'job-a', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
      ]);
      scheduler.start();
      expect(scheduler.getStatus().jobCount).toBe(1);
    });

    it('schedules interval jobs', () => {
      vi.useFakeTimers();
      mockLoadJobs.mockReturnValue([
        makeCronJob({ jobId: 'job-b', schedule: { kind: 'every', everyMs: 60000 } }),
      ]);
      scheduler.start();
      expect(scheduler.getStatus().jobCount).toBe(1);
      vi.useRealTimers();
    });

    it('schedules one-shot (at) jobs', () => {
      vi.useFakeTimers({ now: new Date('2026-03-07T00:00:00Z') });
      mockLoadJobs.mockReturnValue([
        makeCronJob({
          jobId: 'job-c',
          schedule: { kind: 'at', at: '2026-03-08T00:00:00Z' },
        }),
      ]);
      scheduler.start();
      expect(scheduler.getStatus().jobCount).toBe(1);
      vi.useRealTimers();
    });

    it('does not schedule disabled jobs', () => {
      mockLoadJobs.mockReturnValue([
        makeCronJob({ jobId: 'job-disabled', enabled: false }),
      ]);
      scheduler.start();
      expect(scheduler.getStatus().jobCount).toBe(0);
    });

    it('unschedules removed jobs on reload', () => {
      // First load has job-a
      mockLoadJobs.mockReturnValue([makeCronJob({ jobId: 'job-a' })]);
      scheduler.start();
      expect(scheduler.getStatus().jobCount).toBe(1);

      // Second load removes job-a
      mockLoadJobs.mockReturnValue([]);
      // Trigger the file watcher callback (debounced)
      const watchCallback = mockWatch.mock.calls[0][1] as () => void;
      vi.useFakeTimers();
      watchCallback();
      vi.advanceTimersByTime(600); // Past 500ms debounce
      vi.useRealTimers();

      expect(scheduler.getStatus().jobCount).toBe(0);
    });
  });

  // ── Execution ─────────────────────────────────────────────────────────

  describe('execution', () => {
    it('executes job and records success', async () => {
      const expr = '0 9 * * *';
      const job = makeCronJob({ schedule: { kind: 'cron', expr } });
      mockGetJob.mockReturnValue(job);
      mockExecuteAction.mockResolvedValue('Workflow run created');

      mockLoadJobs.mockReturnValue([job]);
      scheduler.start();

      const callback = cronCallbacks.get(expr);
      expect(callback).toBeDefined();
      await callback!();

      // Should have recorded 'started' and 'success' runs
      expect(mockAppendRun).toHaveBeenCalledTimes(2);
      expect(mockAppendRun.mock.calls[0][0].status).toBe('started');
      expect(mockAppendRun.mock.calls[1][0].status).toBe('success');

      expect(mockUpdateJobRunState).toHaveBeenCalledWith(
        job.jobId,
        expect.objectContaining({
          lastRunStatus: 'success',
          consecutiveFailures: 0,
        }),
      );
    });

    it('records failure and increments consecutiveFailures', async () => {
      const expr = '0 10 * * *';
      const job = makeCronJob({ consecutiveFailures: 2, schedule: { kind: 'cron', expr } });
      mockGetJob.mockReturnValue(job);
      mockExecuteAction.mockRejectedValue(new Error('Network timeout'));

      mockLoadJobs.mockReturnValue([job]);
      scheduler.start();

      const callback = cronCallbacks.get(expr);
      expect(callback).toBeDefined();
      await callback!();

      const failedCall = mockAppendRun.mock.calls.find(
        (call) => call[0].status === 'failed',
      );
      expect(failedCall).toBeTruthy();
      expect(failedCall![0].error.message).toBe('Network timeout');

      expect(mockUpdateJobRunState).toHaveBeenCalledWith(
        job.jobId,
        expect.objectContaining({
          lastRunStatus: 'failed',
          consecutiveFailures: 3,
        }),
      );
    });

    it('skips execution when max concurrent runs reached', async () => {
      const expr = '0 11 * * *';
      const job = makeCronJob({ schedule: { kind: 'cron', expr } });
      mockGetJob.mockReturnValue(job);
      mockExecuteAction.mockReturnValue(new Promise(() => {})); // Never resolves

      const scheduler1Run = new Scheduler({ maxConcurrentRuns: 1 });
      mockLoadJobs.mockReturnValue([job]);
      scheduler1Run.start();

      const callback = cronCallbacks.get(expr);
      expect(callback).toBeDefined();

      // First call: occupies the slot
      callback!(); // Don't await — keeps activeRuns at 1

      // Allow microtask to run
      await new Promise<void>((r) => setTimeout(r, 10));

      // Second call: should be skipped
      await callback!();

      const skippedCall = mockAppendRun.mock.calls.find(
        (call) => call[0].status === 'skipped',
      );
      expect(skippedCall).toBeTruthy();

      scheduler1Run.stop();
    });

    it('auto-deletes one-shot jobs after success', async () => {
      const expr = '0 12 * * *';
      const job = makeCronJob({ deleteAfterRun: true, schedule: { kind: 'cron', expr } });
      mockGetJob.mockReturnValue(job);
      mockExecuteAction.mockResolvedValue('done');

      mockLoadJobs.mockReturnValue([job]);
      scheduler.start();

      const callback = cronCallbacks.get(expr);
      expect(callback).toBeDefined();
      await callback!();

      expect(mockRemoveJob).toHaveBeenCalledWith(job.jobId);
    });

    it('skips execution when job is disabled on re-read', async () => {
      const expr = '0 13 * * *';
      const enabledJob = makeCronJob({ schedule: { kind: 'cron', expr } });
      const disabledJob = makeCronJob({ enabled: false });

      mockLoadJobs.mockReturnValue([enabledJob]);
      mockGetJob.mockReturnValue(disabledJob);

      scheduler.start();

      const callback = cronCallbacks.get(expr);
      expect(callback).toBeDefined();
      await callback!();

      expect(mockExecuteAction).not.toHaveBeenCalled();
    });
  });

  // ── Status ────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('reports activeRuns count', () => {
      const status = scheduler.getStatus();
      expect(status).toEqual({
        running: false,
        jobCount: 0,
        activeRuns: 0,
      });
    });
  });
});
