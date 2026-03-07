/**
 * MyndHyve CLI — Cron Scheduler Engine
 *
 * Core scheduler that uses `croner` to manage job execution.
 * Creates and manages Cron instances, handles the scheduler lifecycle
 * (start/stop), watches jobs.json for changes, and orchestrates execution.
 */

import { Cron } from 'croner';
import { watch, type FSWatcher } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { loadJobs, updateJobRunState, removeJob, getJob, getJobsFilePath } from './store.js';
import { executeAction } from './executor.js';
import { appendRun, generateRunId } from './history.js';
import { type CronJob, type SchedulerConfig, DEFAULT_SCHEDULER_CONFIG } from './types.js';

const log = createLogger('Scheduler');

// ============================================================================
// SCHEDULER
// ============================================================================

export class Scheduler {
  private config: SchedulerConfig;
  private cronInstances: Map<string, Cron>;
  private intervalTimers: Map<string, ReturnType<typeof setInterval>>;
  private atTimers: Map<string, ReturnType<typeof setTimeout>>;
  private running: boolean;
  private activeRuns: number;
  private watcher: FSWatcher | null;
  private log: ReturnType<typeof createLogger>;

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.cronInstances = new Map();
    this.intervalTimers = new Map();
    this.atTimers = new Map();
    this.running = false;
    this.activeRuns = 0;
    this.watcher = null;
    this.log = log;
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /** Load jobs, create timers, and start the file watcher. */
  start(): void {
    this.running = true;
    this.loadAndScheduleAll();
    this.setupFileWatcher();

    const jobCount = this.cronInstances.size + this.intervalTimers.size + this.atTimers.size;
    this.log.info('Scheduler started', { jobs: jobCount.toString() });
  }

  /** Stop all timers, close the file watcher, and clear state. */
  stop(): void {
    this.running = false;

    // Stop all cron instances
    for (const [, cron] of this.cronInstances) {
      cron.stop();
    }

    // Clear all interval timers
    for (const [, timer] of this.intervalTimers) {
      clearInterval(timer);
    }

    // Clear all setTimeout timers
    for (const [, timer] of this.atTimers) {
      clearTimeout(timer);
    }

    // Close file watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear all maps
    this.cronInstances.clear();
    this.intervalTimers.clear();
    this.atTimers.clear();

    this.log.info('Scheduler stopped');
  }

  /** Returns true if the scheduler is running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Returns a snapshot of the scheduler's current state. */
  getStatus(): { running: boolean; jobCount: number; activeRuns: number } {
    return {
      running: this.running,
      jobCount: this.cronInstances.size + this.intervalTimers.size + this.atTimers.size,
      activeRuns: this.activeRuns,
    };
  }

  // ==========================================================================
  // INTERNAL — SCHEDULING
  // ==========================================================================

  /** Reload all jobs from disk and reconcile with current scheduled state. */
  private loadAndScheduleAll(): void {
    const jobs = loadJobs();
    const loadedJobIds = new Set(jobs.map((j) => j.jobId));

    // Unschedule jobs that no longer exist on disk
    for (const jobId of this.cronInstances.keys()) {
      if (!loadedJobIds.has(jobId)) {
        this.unscheduleJob(jobId);
      }
    }
    for (const jobId of this.intervalTimers.keys()) {
      if (!loadedJobIds.has(jobId)) {
        this.unscheduleJob(jobId);
      }
    }
    for (const jobId of this.atTimers.keys()) {
      if (!loadedJobIds.has(jobId)) {
        this.unscheduleJob(jobId);
      }
    }

    // Schedule enabled jobs, unschedule disabled ones
    for (const job of jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      } else {
        this.unscheduleJob(job.jobId);
      }
    }
  }

  /**
   * Schedule a single job based on its schedule kind.
   * Clears any existing timer for this job first.
   */
  private scheduleJob(job: CronJob): void {
    this.unscheduleJob(job.jobId);

    switch (job.schedule.kind) {
      case 'cron': {
        const cron = new Cron(
          job.schedule.expr!,
          { timezone: job.schedule.tz },
          () => { this.executeJob(job); },
        );
        this.cronInstances.set(job.jobId, cron);
        break;
      }

      case 'every': {
        const timer = setInterval(() => { this.executeJob(job); }, job.schedule.everyMs!);
        this.intervalTimers.set(job.jobId, timer);
        break;
      }

      case 'at': {
        const delay = new Date(job.schedule.at!).getTime() - Date.now();
        if (delay <= 0) {
          // Already past — execute immediately
          this.executeJob(job);
          return;
        }
        const timer = setTimeout(() => { this.executeJob(job); }, delay);
        this.atTimers.set(job.jobId, timer);
        break;
      }
    }

    this.log.debug(`Scheduled job "${job.name}" (${job.schedule.kind})`, {
      jobId: job.jobId,
    });
  }

  /** Remove all timers associated with a job ID. */
  private unscheduleJob(jobId: string): void {
    const cron = this.cronInstances.get(jobId);
    if (cron) {
      cron.stop();
      this.cronInstances.delete(jobId);
    }

    const interval = this.intervalTimers.get(jobId);
    if (interval !== undefined) {
      clearInterval(interval);
      this.intervalTimers.delete(jobId);
    }

    const timeout = this.atTimers.get(jobId);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      this.atTimers.delete(jobId);
    }
  }

  // ==========================================================================
  // INTERNAL — EXECUTION
  // ==========================================================================

  /** Execute a job: enforce concurrency, record history, handle success/failure. */
  private async executeJob(job: CronJob): Promise<void> {
    if (!this.running) return;

    const now = new Date().toISOString();
    const runId = generateRunId();

    // Enforce concurrency limit
    if (this.activeRuns >= this.config.maxConcurrentRuns) {
      this.log.warn(`Skipping job "${job.name}": max concurrent runs reached`, {
        jobId: job.jobId,
        activeRuns: this.activeRuns.toString(),
        maxConcurrentRuns: this.config.maxConcurrentRuns.toString(),
      });

      appendRun({
        runId,
        jobId: job.jobId,
        jobName: job.name,
        status: 'skipped',
        startedAt: now,
        endedAt: now,
        durationMs: 0,
        actionType: job.action.type,
        result: 'Skipped: max concurrent runs exceeded',
      });
      return;
    }

    // Re-read the job from disk to get fresh state
    const freshJob = getJob(job.jobId);
    if (!freshJob || !freshJob.enabled) {
      this.unscheduleJob(job.jobId);
      return;
    }

    this.activeRuns++;

    // Record 'started' run
    appendRun({
      runId,
      jobId: freshJob.jobId,
      jobName: freshJob.name,
      status: 'started',
      startedAt: now,
      actionType: freshJob.action.type,
    });

    const startMs = Date.now();

    try {
      const result = await executeAction(freshJob.action, this.config);
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      // Record success
      appendRun({
        runId,
        jobId: freshJob.jobId,
        jobName: freshJob.name,
        status: 'success',
        startedAt: now,
        endedAt,
        durationMs,
        actionType: freshJob.action.type,
        result: result.length > 500 ? result.slice(0, 500) + '...' : result,
      });

      updateJobRunState(freshJob.jobId, {
        lastRunAt: endedAt,
        lastRunStatus: 'success',
        consecutiveFailures: 0,
        nextRunAt: this.calculateNextRun(freshJob),
      });

      // Auto-delete one-shot jobs after success
      if (freshJob.deleteAfterRun) {
        removeJob(freshJob.jobId);
        this.unscheduleJob(freshJob.jobId);
      }

      this.log.info(`Job "${freshJob.name}" completed successfully`, {
        jobId: freshJob.jobId,
        durationMs: durationMs.toString(),
      });
    } catch (error: unknown) {
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof Error && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : 'UNKNOWN';

      // Record failure
      appendRun({
        runId,
        jobId: freshJob.jobId,
        jobName: freshJob.name,
        status: 'failed',
        startedAt: now,
        endedAt,
        durationMs,
        actionType: freshJob.action.type,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      });

      updateJobRunState(freshJob.jobId, {
        lastRunAt: endedAt,
        lastRunStatus: 'failed',
        consecutiveFailures: (freshJob.consecutiveFailures || 0) + 1,
      });

      this.log.error(`Job "${freshJob.name}" failed: ${errorMessage}`, {
        jobId: freshJob.jobId,
        durationMs: durationMs.toString(),
      });
    } finally {
      this.activeRuns--;
    }
  }

  // ==========================================================================
  // INTERNAL — NEXT RUN CALCULATION
  // ==========================================================================

  /** Calculate the next run time for a job based on its schedule kind. */
  private calculateNextRun(job: CronJob): string | undefined {
    switch (job.schedule.kind) {
      case 'cron': {
        try {
          const next = new Cron(job.schedule.expr!, { timezone: job.schedule.tz }).nextRun();
          return next?.toISOString();
        } catch {
          return undefined;
        }
      }

      case 'every':
        return new Date(Date.now() + job.schedule.everyMs!).toISOString();

      case 'at':
        // One-shot — no next run
        return undefined;
    }
  }

  // ==========================================================================
  // INTERNAL — FILE WATCHER
  // ==========================================================================

  /** Watch jobs.json for changes and reload when the file is modified. */
  private setupFileWatcher(): void {
    try {
      const jobsFilePath = getJobsFilePath();
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      this.watcher = watch(jobsFilePath, () => {
        // Debounce rapid file system events (editors often write twice)
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          if (!this.running) return;

          this.log.debug('jobs.json changed, reloading');
          this.loadAndScheduleAll();
        }, 500);
      });

      // Prevent the watcher from keeping the process alive on its own
      this.watcher.unref();
    } catch (err) {
      // File watching can fail on some platforms or if the file doesn't exist yet
      this.log.warn('Failed to set up file watcher for jobs.json', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
