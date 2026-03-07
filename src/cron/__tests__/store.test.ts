import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockRandomBytes,
  mockGetCliDir,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRandomBytes: vi.fn(),
  mockGetCliDir: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock('node:crypto', () => ({
  randomBytes: (...args: unknown[]) => mockRandomBytes(...args),
}));

vi.mock('../../config/loader.js', () => ({
  getCliDir: () => mockGetCliDir(),
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
  getCronDir,
  getJobsFilePath,
  generateJobId,
  loadJobs,
  saveJobs,
  getJob,
  addJob,
  updateJob,
  removeJob,
  updateJobRunState,
  listJobs,
} from '../store.js';
import type { CronJob, JobSchedule, JobAction } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    jobId: 'job-abcdef123456',
    name: 'Test Job',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    action: { type: 'workflow', workflowId: 'wf-1', hyveId: 'landing-page' },
    createdAt: '2026-03-07T00:00:00.000Z',
    updatedAt: '2026-03-07T00:00:00.000Z',
    consecutiveFailures: 0,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronStore', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockRandomBytes.mockReset();
    mockGetCliDir.mockReset();

    mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
    mockExistsSync.mockReturnValue(true);
  });

  // ── Paths ─────────────────────────────────────────────────────────────

  describe('getCronDir', () => {
    it('creates directory when it does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const dir = getCronDir();
      expect(dir).toBe('/home/user/.myndhyve-cli/cron');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/home/user/.myndhyve-cli/cron',
        { recursive: true, mode: 0o700 },
      );
    });

    it('skips mkdir when directory exists', () => {
      mockExistsSync.mockReturnValue(true);
      getCronDir();
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('getJobsFilePath', () => {
    it('returns path to jobs.json', () => {
      expect(getJobsFilePath()).toBe('/home/user/.myndhyve-cli/cron/jobs.json');
    });
  });

  // ── ID Generation ─────────────────────────────────────────────────────

  describe('generateJobId', () => {
    it('produces job-{12 hex chars}', () => {
      mockRandomBytes.mockReturnValue(Buffer.from('aabbccddeeff', 'hex'));
      expect(generateJobId()).toBe('job-aabbccddeeff');
    });
  });

  // ── loadJobs ──────────────────────────────────────────────────────────

  describe('loadJobs', () => {
    it('returns empty array when file does not exist', () => {
      // First call: getCronDir existsSync (dir exists)
      // Second call: getJobsFilePath existsSync (file missing)
      mockExistsSync.mockImplementation((path: string) => !path.endsWith('jobs.json'));
      expect(loadJobs()).toEqual([]);
    });

    it('parses valid JSON array', () => {
      const jobs = [makeCronJob()];
      mockReadFileSync.mockReturnValue(JSON.stringify(jobs));
      expect(loadJobs()).toEqual(jobs);
    });

    it('returns empty array for non-array JSON', () => {
      mockReadFileSync.mockReturnValue('{"not": "an array"}');
      expect(loadJobs()).toEqual([]);
    });

    it('returns empty array on parse error', () => {
      mockReadFileSync.mockReturnValue('not json at all');
      expect(loadJobs()).toEqual([]);
    });
  });

  // ── saveJobs ──────────────────────────────────────────────────────────

  describe('saveJobs', () => {
    it('writes formatted JSON with restricted permissions', () => {
      const jobs = [makeCronJob()];
      saveJobs(jobs);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/home/user/.myndhyve-cli/cron/jobs.json',
        JSON.stringify(jobs, null, 2),
        { mode: 0o600 },
      );
    });
  });

  // ── getJob ────────────────────────────────────────────────────────────

  describe('getJob', () => {
    it('returns the job when found', () => {
      const job = makeCronJob({ jobId: 'job-target' });
      mockReadFileSync.mockReturnValue(JSON.stringify([makeCronJob(), job]));
      expect(getJob('job-target')).toEqual(job);
    });

    it('returns null when not found', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify([makeCronJob()]));
      expect(getJob('job-missing')).toBeNull();
    });
  });

  // ── addJob ────────────────────────────────────────────────────────────

  describe('addJob', () => {
    it('creates a job with generated ID and saves to disk', () => {
      mockReadFileSync.mockReturnValue('[]');
      mockRandomBytes.mockReturnValue(Buffer.from('112233445566', 'hex'));

      const schedule: JobSchedule = { kind: 'cron', expr: '0 9 * * *' };
      const action: JobAction = { type: 'workflow', workflowId: 'wf-1', hyveId: 'lp' };

      const job = addJob({ name: 'My Job', schedule, action });

      expect(job.jobId).toBe('job-112233445566');
      expect(job.name).toBe('My Job');
      expect(job.enabled).toBe(true);
      expect(job.consecutiveFailures).toBe(0);
      expect(job.createdAt).toBeTruthy();
      expect(job.updatedAt).toBe(job.createdAt);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('appends to existing jobs', () => {
      const existing = makeCronJob({ jobId: 'job-existing' });
      mockReadFileSync.mockReturnValue(JSON.stringify([existing]));
      mockRandomBytes.mockReturnValue(Buffer.from('aabbccddeeff', 'hex'));

      addJob({
        name: 'New',
        schedule: { kind: 'at', at: '2026-12-01T00:00:00Z' },
        action: { type: 'http', url: 'https://example.com', method: 'GET' },
      });

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(written[0].jobId).toBe('job-existing');
      expect(written[1].jobId).toBe('job-aabbccddeeff');
    });
  });

  // ── updateJob ─────────────────────────────────────────────────────────

  describe('updateJob', () => {
    it('patches fields and updates timestamp', () => {
      const job = makeCronJob({ jobId: 'job-target', name: 'Old Name' });
      mockReadFileSync.mockReturnValue(JSON.stringify([job]));

      const updated = updateJob('job-target', { name: 'New Name', enabled: false });

      expect(updated.name).toBe('New Name');
      expect(updated.enabled).toBe(false);
      expect(updated.updatedAt).not.toBe(job.updatedAt);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('throws when job not found', () => {
      mockReadFileSync.mockReturnValue('[]');
      expect(() => updateJob('job-missing', { name: 'X' })).toThrow('Job not found: job-missing');
    });
  });

  // ── removeJob ─────────────────────────────────────────────────────────

  describe('removeJob', () => {
    it('removes the job and saves', () => {
      const jobs = [makeCronJob({ jobId: 'job-a' }), makeCronJob({ jobId: 'job-b' })];
      mockReadFileSync.mockReturnValue(JSON.stringify(jobs));

      expect(removeJob('job-a')).toBe(true);

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].jobId).toBe('job-b');
    });

    it('returns false when job not found', () => {
      mockReadFileSync.mockReturnValue('[]');
      expect(removeJob('job-missing')).toBe(false);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  // ── updateJobRunState ─────────────────────────────────────────────────

  describe('updateJobRunState', () => {
    it('updates run state fields without changing updatedAt', () => {
      const job = makeCronJob({ jobId: 'job-target', updatedAt: '2026-01-01T00:00:00Z' });
      mockReadFileSync.mockReturnValue(JSON.stringify([job]));

      updateJobRunState('job-target', {
        lastRunAt: '2026-03-07T12:00:00Z',
        lastRunStatus: 'success',
        consecutiveFailures: 0,
        nextRunAt: '2026-03-08T09:00:00Z',
      });

      const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
      expect(written[0].lastRunAt).toBe('2026-03-07T12:00:00Z');
      expect(written[0].lastRunStatus).toBe('success');
      expect(written[0].consecutiveFailures).toBe(0);
      expect(written[0].nextRunAt).toBe('2026-03-08T09:00:00Z');
      expect(written[0].updatedAt).toBe('2026-01-01T00:00:00Z'); // Unchanged
    });

    it('no-ops when job not found', () => {
      mockReadFileSync.mockReturnValue('[]');
      updateJobRunState('job-missing', {
        lastRunAt: 'x',
        lastRunStatus: 'failed',
        consecutiveFailures: 1,
      });
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  // ── listJobs ──────────────────────────────────────────────────────────

  describe('listJobs', () => {
    it('returns all jobs from disk', () => {
      const jobs = [makeCronJob({ jobId: 'a' }), makeCronJob({ jobId: 'b' })];
      mockReadFileSync.mockReturnValue(JSON.stringify(jobs));
      expect(listJobs()).toEqual(jobs);
    });
  });
});
