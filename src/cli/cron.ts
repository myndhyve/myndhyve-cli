/**
 * MyndHyve CLI — Cron Commands
 *
 * Commander subcommand group for the cron scheduler:
 *   myndhyve-cli cron start [--foreground] [--allow-shell]
 *   myndhyve-cli cron stop
 *   myndhyve-cli cron status [--format=<format>]
 *   myndhyve-cli cron add --name="..." --cron="..." --workflow=<id> --canvas-type=<id>
 *   myndhyve-cli cron list [--enabled] [--disabled]
 *   myndhyve-cli cron info <job-id>
 *   myndhyve-cli cron edit <job-id> [--name=<name>] [--enabled=<bool>] ...
 *   myndhyve-cli cron run <job-id>
 *   myndhyve-cli cron remove <job-id> [--force]
 *   myndhyve-cli cron runs <job-id> [--limit=<n>]
 *   myndhyve-cli cron logs [--follow] [--lines=<n>]
 */

import type { Command } from 'commander';
import { requireAuth, truncate, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import { loadJobs, getJob, addJob, updateJob, removeJob } from '../cron/store.js';
import { listRuns } from '../cron/history.js';
import {
  getSchedulerPid,
  spawnScheduler,
  stopScheduler,
  getSchedulerLogFilePath,
} from '../cron/daemon.js';
import { Scheduler } from '../cron/scheduler.js';
import type { JobSchedule, JobAction, JobDelivery } from '../cron/types.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerCronCommands(program: Command): void {
  const cron = program
    .command('cron')
    .description('Manage scheduled jobs and the cron scheduler');

  // ── Start ────────────────────────────────────────────────────────────

  cron
    .command('start')
    .description('Start the cron scheduler')
    .option('--foreground', 'Run in foreground instead of as a daemon')
    .option('--allow-shell', 'Enable shell actions')
    .action(async (opts) => {
      if (!opts.foreground) {
        const existingPid = getSchedulerPid();
        if (existingPid) {
          console.log(`\n  Scheduler already running (PID: ${existingPid})`);
          console.log('');
          return;
        }

        const pid = spawnScheduler({ allowShell: opts.allowShell });
        console.log(`\n  Scheduler started (PID: ${pid})`);
        console.log('  Logs: myndhyve-cli cron logs');
        console.log('');
        return;
      }

      // Foreground mode
      const scheduler = new Scheduler({ allowShell: opts.allowShell ?? false });
      scheduler.start();

      const shutdown = () => {
        scheduler.stop();
        process.exit(0);
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      console.log('\n  Scheduler running in foreground. Press Ctrl+C to stop.\n');

      // Keep process alive
      setInterval(() => {}, 60_000);
    });

  // ── Stop ─────────────────────────────────────────────────────────────

  cron
    .command('stop')
    .description('Stop the cron scheduler daemon')
    .action(() => {
      const stopped = stopScheduler();
      if (stopped) {
        console.log('\n  Scheduler stopped.');
      } else {
        console.log('\n  Scheduler is not running.');
      }
      console.log('');
    });

  // ── Status ───────────────────────────────────────────────────────────

  cron
    .command('status')
    .description('Show scheduler and job status')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((opts) => {
      const pid = getSchedulerPid();
      const jobs = loadJobs();

      const enabledCount = jobs.filter((j) => j.enabled).length;
      const disabledCount = jobs.length - enabledCount;

      let nextDueJob: { name: string; nextRunAt: string } | null = null;
      for (const job of jobs) {
        if (!job.enabled || !job.nextRunAt) continue;
        if (!nextDueJob || job.nextRunAt < nextDueJob.nextRunAt) {
          nextDueJob = { name: job.name, nextRunAt: job.nextRunAt };
        }
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify({
          daemon: pid ? { running: true, pid } : { running: false },
          jobs: { total: jobs.length, enabled: enabledCount, disabled: disabledCount },
          nextDue: nextDueJob,
        }, null, 2));
        return;
      }

      console.log('\n  Cron Scheduler Status\n');
      console.log('  ' + '\u2500'.repeat(40));
      console.log(`  Daemon:     ${pid ? `running (PID: ${pid})` : 'not running'}`);
      console.log(`  Jobs:       ${jobs.length} total (${enabledCount} enabled, ${disabledCount} disabled)`);
      console.log(`  Next due:   ${nextDueJob ? `${nextDueJob.name} at ${nextDueJob.nextRunAt}` : '-'}`);
      console.log('');
    });

  // ── Add ──────────────────────────────────────────────────────────────

  cron
    .command('add')
    .description('Add a new cron job')
    .requiredOption('--name <name>', 'Job name')
    .option('--cron <expr>', 'Cron expression (e.g. "0 9 * * *")')
    .option('--at <timestamp>', 'One-time run at ISO timestamp')
    .option('--every <ms>', 'Repeat interval in milliseconds')
    .option('--tz <timezone>', 'Timezone for cron schedule')
    .option('--description <desc>', 'Job description')
    .option('--delete-after-run', 'Delete job after successful execution')
    .option('--workflow <id>', 'Run a workflow')
    .option('--agent <id>', 'Run an agent')
    .option('--crm-sync', 'Run a CRM sync')
    .option('--shell <cmd>', 'Run a shell command')
    .option('--http <url>', 'Make an HTTP request')
    .option('--canvas-type <id>', 'Canvas type ID (required for --workflow)')
    .option('--message <text>', 'Message text (required for --agent)')
    .option('--collections <list>', 'Comma-separated collection names (for --crm-sync)')
    .option('--method <method>', 'HTTP method (for --http, default GET)', 'GET')
    .option('--announce <channel>', 'Announce result to channel')
    .option('--to <target>', 'Deliver result to target')
    .option('--webhook-url <url>', 'Deliver result via webhook')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Validate schedule — exactly one required
      const scheduleCount = [opts.cron, opts.at, opts.every].filter(Boolean).length;
      if (scheduleCount === 0) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'A schedule is required: --cron, --at, or --every.',
          suggestion: 'Example: --cron "0 9 * * *" or --every 3600000 or --at "2026-03-08T10:00:00Z"',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      if (scheduleCount > 1) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'Only one schedule type allowed: --cron, --at, or --every.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // Validate action — exactly one required
      const actionCount = [opts.workflow, opts.agent, opts.crmSync, opts.shell, opts.http].filter(Boolean).length;
      if (actionCount === 0) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'An action is required: --workflow, --agent, --crm-sync, --shell, or --http.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      if (actionCount > 1) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'Only one action type allowed.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // Validate action dependencies
      if (opts.workflow && !opts.canvasType) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: '--workflow requires --canvas-type.',
          suggestion: 'Example: --workflow abc123 --canvas-type landing-page',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      if (opts.agent && !opts.message) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: '--agent requires --message.',
          suggestion: 'Example: --agent my-agent --message "Run daily report"',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // Build schedule
      let schedule: JobSchedule;
      if (opts.cron) {
        schedule = { kind: 'cron', expr: opts.cron, tz: opts.tz };
      } else if (opts.at) {
        schedule = { kind: 'at', at: opts.at, tz: opts.tz };
      } else {
        schedule = { kind: 'every', everyMs: parseInt(opts.every, 10), tz: opts.tz };
      }

      // Build action
      let action: JobAction;
      if (opts.workflow) {
        action = { type: 'workflow', workflowId: opts.workflow, canvasTypeId: opts.canvasType };
      } else if (opts.agent) {
        action = { type: 'agent', agentId: opts.agent, message: opts.message };
      } else if (opts.crmSync) {
        action = {
          type: 'crm-sync',
          collections: opts.collections ? opts.collections.split(',') : undefined,
        };
      } else if (opts.shell) {
        action = { type: 'shell', command: opts.shell };
      } else {
        action = { type: 'http', url: opts.http, method: opts.method };
      }

      // Build delivery (optional)
      let delivery: JobDelivery | undefined;
      if (opts.announce || opts.to || opts.webhookUrl) {
        delivery = {
          mode: opts.announce ? 'relay' : opts.webhookUrl ? 'webhook' : 'none',
          channel: opts.announce,
          to: opts.to,
          webhookUrl: opts.webhookUrl,
        };
      }

      try {
        const job = addJob({
          name: opts.name,
          description: opts.description,
          schedule,
          action,
          delivery,
          deleteAfterRun: opts.deleteAfterRun ?? false,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(job, null, 2));
          return;
        }

        console.log('\n  Job created:');
        console.log(`  ID:       ${job.jobId}`);
        console.log(`  Name:     ${job.name}`);
        console.log(`  Schedule: ${formatSchedule(job.schedule)}`);
        console.log(`  Action:   ${formatAction(job.action)}`);
        console.log('');
      } catch (error) {
        printError('Failed to add job', error);
      }
    });

  // ── List ─────────────────────────────────────────────────────────────

  cron
    .command('list')
    .description('List all cron jobs')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--enabled', 'Show only enabled jobs')
    .option('--disabled', 'Show only disabled jobs')
    .action((opts) => {
      let jobs = loadJobs();

      if (opts.enabled) {
        jobs = jobs.filter((j) => j.enabled);
      } else if (opts.disabled) {
        jobs = jobs.filter((j) => !j.enabled);
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(jobs, null, 2));
        return;
      }

      if (jobs.length === 0) {
        console.log('\n  No cron jobs. Create one: myndhyve-cli cron add --name \'...\' --cron \'...\' --workflow <id> --canvas-type <id>');
        console.log('');
        return;
      }

      console.log(`\n  Cron Jobs (${jobs.length})\n`);
      console.log(
        '  ' +
          'ID'.padEnd(18) +
          'Name'.padEnd(20) +
          'Schedule'.padEnd(26) +
          'Action'.padEnd(20) +
          'Status'.padEnd(10) +
          'Last Run'.padEnd(14) +
          'Next Run'
      );
      console.log('  ' + '\u2500'.repeat(120));

      for (const job of jobs) {
        console.log(
          '  ' +
            truncate(job.jobId, 16).padEnd(18) +
            truncate(job.name, 18).padEnd(20) +
            truncate(formatSchedule(job.schedule), 24).padEnd(26) +
            truncate(formatAction(job.action), 18).padEnd(20) +
            (job.enabled ? 'enabled' : 'disabled').padEnd(10) +
            (job.lastRunAt || '-').padEnd(14) +
            (job.nextRunAt || '-')
        );
      }

      console.log('');
    });

  // ── Info ──────────────────────────────────────────────────────────────

  cron
    .command('info <job-id>')
    .description('Show detailed information about a cron job')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((jobId: string, opts) => {
      const job = getJob(jobId);

      if (!job) {
        printErrorResult({
          code: 'NOT_FOUND',
          message: `Job "${jobId}" not found.`,
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(job, null, 2));
        return;
      }

      console.log(`\n  ${job.name}`);
      console.log('  ' + '\u2500'.repeat(50));
      console.log(`  ID:            ${job.jobId}`);
      console.log(`  Status:        ${job.enabled ? 'enabled' : 'disabled'}`);
      if (job.description) console.log(`  Description:   ${job.description}`);
      console.log(`  Schedule:      ${formatSchedule(job.schedule)}`);
      console.log(`  Action:        ${formatAction(job.action)}`);

      if (job.delivery) {
        if (job.delivery.channel) console.log(`  Channel:       ${job.delivery.channel}`);
        if (job.delivery.to) console.log(`  Deliver to:    ${job.delivery.to}`);
        if (job.delivery.webhookUrl) console.log(`  Webhook:       ${job.delivery.webhookUrl}`);
      }

      console.log(`  Delete after:  ${job.deleteAfterRun ? 'yes' : 'no'}`);
      console.log(`  Last run:      ${job.lastRunAt || '-'}`);
      console.log(`  Next run:      ${job.nextRunAt || '-'}`);
      if (job.consecutiveFailures != null && job.consecutiveFailures > 0) {
        console.log(`  Failures:      ${job.consecutiveFailures} consecutive`);
      }
      console.log('');
    });

  // ── Edit ──────────────────────────────────────────────────────────────

  cron
    .command('edit <job-id>')
    .description('Edit an existing cron job')
    .option('--name <name>', 'Update job name')
    .option('--enabled <bool>', 'Enable or disable (true/false)')
    .option('--description <desc>', 'Update description')
    .option('--cron <expr>', 'Update cron expression')
    .option('--at <timestamp>', 'Update one-time timestamp')
    .option('--every <ms>', 'Update repeat interval')
    .option('--tz <timezone>', 'Update timezone')
    .action((jobId: string, opts) => {
      const patch: Record<string, unknown> = {};

      if (opts.name !== undefined) patch.name = opts.name;
      if (opts.description !== undefined) patch.description = opts.description;

      if (opts.enabled !== undefined) {
        if (opts.enabled !== 'true' && opts.enabled !== 'false') {
          printErrorResult({
            code: 'INVALID_ARGUMENT',
            message: '--enabled must be "true" or "false".',
          });
          process.exitCode = ExitCode.USAGE_ERROR;
          return;
        }
        patch.enabled = opts.enabled === 'true';
      }

      // Build new schedule if any schedule option provided
      if (opts.cron || opts.at || opts.every) {
        let schedule: JobSchedule;
        if (opts.cron) {
          schedule = { kind: 'cron', expr: opts.cron, tz: opts.tz };
        } else if (opts.at) {
          schedule = { kind: 'at', at: opts.at, tz: opts.tz };
        } else {
          schedule = { kind: 'every', everyMs: parseInt(opts.every, 10), tz: opts.tz };
        }
        patch.schedule = schedule;
      } else if (opts.tz) {
        // Only tz provided — need existing schedule to merge
        const existing = getJob(jobId);
        if (existing) {
          patch.schedule = { ...existing.schedule, tz: opts.tz };
        }
      }

      if (Object.keys(patch).length === 0) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'No fields to update. Provide at least one option.',
          suggestion: 'Options: --name, --enabled, --description, --cron, --at, --every, --tz',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        updateJob(jobId, patch);
        console.log(`\n  Job "${jobId}" updated.`);
        console.log('');
      } catch (error) {
        printError('Failed to update job', error);
      }
    });

  // ── Run ───────────────────────────────────────────────────────────────

  cron
    .command('run <job-id>')
    .description('Force-execute a job immediately')
    .action(async (jobId: string) => {
      const job = getJob(jobId);

      if (!job) {
        printErrorResult({
          code: 'NOT_FOUND',
          message: `Job "${jobId}" not found.`,
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      try {
        const { executeAction } = await import('../cron/executor.js');
        const { DEFAULT_SCHEDULER_CONFIG } = await import('../cron/types.js');

        console.log(`\n  Executing job "${job.name}"...`);
        const result = await executeAction(job.action, DEFAULT_SCHEDULER_CONFIG);
        console.log(`  Result: ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`);
        console.log('');
      } catch (error) {
        printError('Failed to execute job', error);
      }
    });

  // ── Remove ────────────────────────────────────────────────────────────

  cron
    .command('remove <job-id>')
    .description('Remove a cron job')
    .option('--force', 'Skip confirmation')
    .action((jobId: string, opts) => {
      if (!opts.force) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm removal of job "${jobId}".`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        removeJob(jobId);
        console.log(`\n  Job "${jobId}" removed.`);
        console.log('');
      } catch (error) {
        printError('Failed to remove job', error);
      }
    });

  // ── Runs ──────────────────────────────────────────────────────────────

  cron
    .command('runs <job-id>')
    .description('Show run history for a job')
    .option('--limit <n>', 'Max results', '20')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((jobId: string, opts) => {
      const limit = parseInt(opts.limit, 10);
      const runs = listRuns(jobId, isNaN(limit) || limit < 1 ? 20 : limit);

      if (opts.format === 'json') {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }

      if (runs.length === 0) {
        console.log(`\n  No run history for job "${jobId}".`);
        console.log('');
        return;
      }

      console.log(`\n  Run History (${runs.length})\n`);
      console.log(
        '  ' +
          'Run ID'.padEnd(22) +
          'Status'.padEnd(12) +
          'Started'.padEnd(22) +
          'Duration'.padEnd(12) +
          'Result / Error'
      );
      console.log('  ' + '\u2500'.repeat(100));

      for (const run of runs) {
        const duration = run.durationMs != null ? formatDuration(run.durationMs) : '-';
        const result = run.error
          ? truncate(run.error.message, 30)
          : run.result
            ? truncate(run.result, 30)
            : '-';

        console.log(
          '  ' +
            truncate(run.runId, 20).padEnd(22) +
            (run.status || '-').padEnd(12) +
            (run.startedAt || '-').padEnd(22) +
            duration.padEnd(12) +
            result
        );
      }

      console.log('');
    });

  // ── Logs ──────────────────────────────────────────────────────────────

  cron
    .command('logs')
    .description('View scheduler logs')
    .option('--follow', 'Follow log output')
    .option('--lines <n>', 'Number of lines to show', '50')
    .action(async (opts) => {
      const { existsSync, statSync, openSync, readSync, closeSync } = await import('node:fs');
      const { open } = await import('node:fs/promises');

      const logFile = getSchedulerLogFilePath();

      if (!existsSync(logFile)) {
        console.log('\n  No scheduler logs found. Start the scheduler first.');
        console.log(`  Run: myndhyve-cli cron start`);
        console.log('');
        return;
      }

      // Show daemon status
      const pid = getSchedulerPid();
      console.log(pid ? `  Scheduler running (PID ${pid})` : '  Scheduler not running');
      console.log(`  Log file: ${logFile}\n`);

      // Read tail
      const numLines = parseInt(opts.lines, 10) || 50;
      const INITIAL_TAIL_BYTES = 8192;
      const stat = statSync(logFile);

      if (stat.size > 0) {
        const readBytes = Math.min(stat.size, INITIAL_TAIL_BYTES);
        const startOffset = stat.size - readBytes;
        const buf = Buffer.alloc(readBytes);
        const fd = openSync(logFile, 'r');
        try {
          readSync(fd, buf, 0, readBytes, startOffset);
        } finally {
          closeSync(fd);
        }
        const content = buf.toString('utf-8');
        const allLines = content.split('\n');
        if (startOffset > 0 && allLines.length > 1) {
          allLines.shift();
        }
        const lastLines = allLines.slice(-numLines - 1);
        process.stdout.write(lastLines.join('\n'));
      }

      // Follow mode
      if (opts.follow) {
        const controller = new AbortController();

        const shutdown = () => {
          controller.abort();
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        try {
          const handle = await open(logFile, 'r');
          let offset = statSync(logFile).size;

          while (!controller.signal.aborted) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 500);
              controller.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
              }, { once: true });
            });

            if (controller.signal.aborted) break;

            const currentSize = statSync(logFile).size;
            if (currentSize > offset) {
              const newBuf = Buffer.alloc(currentSize - offset);
              await handle.read(newBuf, 0, newBuf.length, offset);
              process.stdout.write(newBuf.toString('utf-8'));
              offset = currentSize;
            } else if (currentSize < offset) {
              // File was truncated/rotated
              offset = 0;
            }
          }

          await handle.close();
        } finally {
          process.removeListener('SIGINT', shutdown);
          process.removeListener('SIGTERM', shutdown);
        }
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

function formatSchedule(schedule: JobSchedule): string {
  switch (schedule.kind) {
    case 'cron':
      return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
    case 'every':
      return `every: ${schedule.everyMs}ms`;
    case 'at':
      return `at: ${schedule.at}`;
    default:
      return 'unknown';
  }
}

function formatAction(action: JobAction): string {
  switch (action.type) {
    case 'workflow':
      return `workflow: ${action.workflowId}`;
    case 'agent':
      return `agent: ${action.agentId}`;
    case 'crm-sync':
      return 'crm-sync';
    case 'shell':
      return `shell: ${truncate(action.command, 30)}`;
    case 'http':
      return `http: ${action.method || 'GET'} ${truncate(action.url, 30)}`;
    default:
      return 'unknown';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
