/**
 * MyndHyve CLI — Cron Job Store
 *
 * Manages ~/.myndhyve-cli/cron/jobs.json — a JSON file containing
 * an array of CronJob objects. Provides CRUD operations and file persistence.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getCliDir } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';
import type { CronJob, JobSchedule, JobAction, JobDelivery } from './types.js';

const log = createLogger('CronStore');

// ============================================================================
// PATHS
// ============================================================================

/** Returns ~/.myndhyve-cli/cron/, creating the directory if it does not exist. */
export function getCronDir(): string {
  const dir = join(getCliDir(), 'cron');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/** Returns the path to ~/.myndhyve-cli/cron/jobs.json */
export function getJobsFilePath(): string {
  return join(getCronDir(), 'jobs.json');
}

// ============================================================================
// ID GENERATION
// ============================================================================

/** Generates a unique job ID: job-{12 hex chars} */
export function generateJobId(): string {
  return `job-${randomBytes(6).toString('hex')}`;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/** Loads jobs from disk. Returns [] if the file is missing. Logs a warning on parse error. */
export function loadJobs(): CronJob[] {
  const filePath = getJobsFilePath();

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      log.warn('jobs.json does not contain an array, returning empty list');
      return [];
    }

    return parsed as CronJob[];
  } catch (err) {
    log.warn('Failed to parse jobs.json', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Writes jobs.json atomically with mode 0o600. */
export function saveJobs(jobs: CronJob[]): void {
  const filePath = getJobsFilePath();
  writeFileSync(filePath, JSON.stringify(jobs, null, 2), { mode: 0o600 });
}

// ============================================================================
// CRUD
// ============================================================================

/** Finds a job by ID, or returns null if not found. */
export function getJob(jobId: string): CronJob | null {
  const jobs = loadJobs();
  return jobs.find((j) => j.jobId === jobId) ?? null;
}

/** Creates a new job, saves to disk, and returns the created job. */
export function addJob(data: {
  name: string;
  description?: string;
  schedule: JobSchedule;
  action: JobAction;
  delivery?: JobDelivery;
  deleteAfterRun?: boolean;
}): CronJob {
  const jobs = loadJobs();
  const now = new Date().toISOString();

  const job: CronJob = {
    jobId: generateJobId(),
    name: data.name,
    description: data.description,
    enabled: true,
    schedule: data.schedule,
    action: data.action,
    delivery: data.delivery,
    deleteAfterRun: data.deleteAfterRun,
    createdAt: now,
    updatedAt: now,
    consecutiveFailures: 0,
  };

  jobs.push(job);
  saveJobs(jobs);

  log.info('Job created', { id: job.jobId, name: job.name });
  return job;
}

/** Patches allowed fields on a job, sets updatedAt, and saves. Throws if job not found. */
export function updateJob(
  jobId: string,
  patch: Partial<
    Pick<
      CronJob,
      'name' | 'description' | 'enabled' | 'schedule' | 'action' | 'delivery' | 'deleteAfterRun'
    >
  >,
): CronJob {
  const jobs = loadJobs();
  const index = jobs.findIndex((j) => j.jobId === jobId);

  if (index === -1) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const job = jobs[index];

  if (patch.name !== undefined) job.name = patch.name;
  if (patch.description !== undefined) job.description = patch.description;
  if (patch.enabled !== undefined) job.enabled = patch.enabled;
  if (patch.schedule !== undefined) job.schedule = patch.schedule;
  if (patch.action !== undefined) job.action = patch.action;
  if (patch.delivery !== undefined) job.delivery = patch.delivery;
  if (patch.deleteAfterRun !== undefined) job.deleteAfterRun = patch.deleteAfterRun;

  job.updatedAt = new Date().toISOString();

  jobs[index] = job;
  saveJobs(jobs);

  log.info('Job updated', { id: jobId });
  return job;
}

/** Removes a job by ID and saves. Returns true if found and removed, false otherwise. */
export function removeJob(jobId: string): boolean {
  const jobs = loadJobs();
  const index = jobs.findIndex((j) => j.jobId === jobId);

  if (index === -1) {
    return false;
  }

  jobs.splice(index, 1);
  saveJobs(jobs);

  log.info('Job removed', { id: jobId });
  return true;
}

/**
 * Updates run state fields on a job without changing updatedAt.
 * Used by the scheduler after job execution.
 */
export function updateJobRunState(
  jobId: string,
  state: Pick<CronJob, 'lastRunAt' | 'lastRunStatus' | 'consecutiveFailures'> & {
    nextRunAt?: string;
  },
): void {
  const jobs = loadJobs();
  const index = jobs.findIndex((j) => j.jobId === jobId);

  if (index === -1) {
    log.warn('Cannot update run state: job not found', { id: jobId });
    return;
  }

  const job = jobs[index];

  job.lastRunAt = state.lastRunAt;
  job.lastRunStatus = state.lastRunStatus;
  job.consecutiveFailures = state.consecutiveFailures;

  if (state.nextRunAt !== undefined) {
    job.nextRunAt = state.nextRunAt;
  }

  jobs[index] = job;
  saveJobs(jobs);
}

/** Alias for loadJobs(). Returns all jobs from disk. */
export function listJobs(): CronJob[] {
  return loadJobs();
}
