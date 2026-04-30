/**
 * MyndHyve CLI — Workflow Commands
 *
 * Commander subcommand group for workflow automation:
 *   myndhyve-cli workflows list
 *   myndhyve-cli workflows info <workflow-id>
 *   myndhyve-cli workflows run <workflow-id>
 *   myndhyve-cli workflows status <run-id>
 *   myndhyve-cli workflows logs <run-id>
 *   myndhyve-cli workflows artifacts list --run=<runId>
 *   myndhyve-cli workflows artifacts get <artifact-id> --run=<runId>
 *   myndhyve-cli workflows approve <run-id>
 *   myndhyve-cli workflows reject <run-id>
 *   myndhyve-cli workflows revise <run-id>
 */

import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import {
  listWorkflows,
  getWorkflow,
  listRuns,
  listPendingApprovals,
  getRun,
  createRun,
  getRunLogs,
  approveRun,
  rejectRun,
  reviseRun,
  listArtifacts,
  getArtifact,
  dryRunReplay,
  type DryRunReport,
  type InvocationSummary,
  type WorkflowRunStatus,
  type RunSummary,
} from '../api/workflows.js';
import { getActiveContext } from '../context.js';
import {
  requireAuth,
  truncate,
  formatRelativeTime,
  printError,
} from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import { formatRunError } from '../utils/format.js';
import { isTerminalRunStatus } from '@myndhyve/types';
import {
  WorkflowRuntimeClient,
  WorkflowRuntimeAuthError,
  WorkflowRuntimeError,
  type StreamMode,
} from '../api/workflowRuntimeClient.js';

// ============================================================================
// CONSTANTS
// ============================================================================

// Sourced from the canonical engine union via `@myndhyve/types` so adding a
// new status server-side (e.g. `waiting-external`) makes it valid here too.
const VALID_RUN_STATUSES: WorkflowRunStatus[] = [
  'pending',
  'planned',
  'running',
  'executing',
  'paused',
  'waiting-approval',
  'waiting-external',
  'completed',
  'failed',
  'cancelled',
  'timed-out',
  'interrupted',
];

// ============================================================================
// REGISTER
// ============================================================================

export function registerWorkflowCommands(program: Command): void {
  const workflows = program
    .command('workflows')
    .description('Manage and run canvas type workflows')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli workflows list --canvas-type=app-builder
  $ myndhyve-cli workflows run <workflow-id> --canvas-type=app-builder
  $ myndhyve-cli workflows status <run-id> --canvas-type=app-builder
  $ myndhyve-cli workflows approve <run-id> --canvas-type=app-builder`);

  registerListCommand(workflows);
  registerInfoCommand(workflows);
  registerRunCommand(workflows);
  registerSubmitCommand(workflows);
  registerRunsCommand(workflows);
  registerPendingCommand(workflows);
  registerStatusCommand(workflows);
  registerWaitCommand(workflows);
  registerTailCommand(workflows);
  registerLogsCommand(workflows);
  registerArtifactCommands(workflows);
  registerApprovalCommands(workflows);
  registerReplayCommand(workflows);
}

// ============================================================================
// LIST WORKFLOWS
// ============================================================================

function registerListCommand(workflows: Command): void {
  workflows
    .command('list')
    .description('List available workflows for a canvas type')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      try {
        const results = await listWorkflows(canvasTypeId);

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log(`\n  No workflows found for canvas type "${canvasTypeId}".`);
          console.log('  Workflows are configured in the web app.\n');
          return;
        }

        console.log(`\n  Workflows for "${canvasTypeId}" (${results.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(28) +
            'Nodes'.padEnd(8) +
            'Triggers'.padEnd(20) +
            'Status'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const wf of results) {
          const triggers = wf.triggerTypes.join(', ') || 'none';
          const status = wf.enabled ? 'enabled' : 'disabled';

          console.log(
            '  ' +
              truncate(wf.id, 22).padEnd(24) +
              truncate(wf.name, 26).padEnd(28) +
              String(wf.nodeCount).padEnd(8) +
              truncate(triggers, 18).padEnd(20) +
              status
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list workflows', error);
      }
    });
}

// ============================================================================
// INFO (WORKFLOW DETAIL)
// ============================================================================

function registerInfoCommand(workflows: Command): void {
  workflows
    .command('info <workflow-id>')
    .description('Show detailed information about a workflow')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (workflowId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      try {
        const workflow = await getWorkflow(canvasTypeId, workflowId);

        if (!workflow) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Workflow "${workflowId}" not found in canvas type "${canvasTypeId}".`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(workflow, null, 2));
          return;
        }

        console.log(`\n  ${workflow.name}`);
        console.log('  ' + '\u2500'.repeat(60));
        console.log(`  ID:           ${workflow.id}`);
        console.log(`  Canvas Type:  ${workflow.canvasTypeId}`);
        console.log(`  Version:      ${workflow.version}`);
        console.log(`  Status:       ${workflow.enabled ? 'enabled' : 'disabled'}`);

        if (workflow.description) {
          console.log(`  Description:  ${workflow.description}`);
        }

        // Triggers
        if (workflow.triggers.length > 0) {
          console.log('');
          console.log('  Triggers:');
          for (const trigger of workflow.triggers) {
            console.log(`    \u2022 ${trigger.type}`);
          }
        }

        // Nodes
        if (workflow.nodes.length > 0) {
          console.log('');
          console.log(`  Nodes (${workflow.nodes.length}):`);
          for (let i = 0; i < workflow.nodes.length; i++) {
            const node = workflow.nodes[i];
            const approval = node.requiresApproval ? ' [approval gate]' : '';
            console.log(`    ${i + 1}. [${node.type}] ${node.label}${approval}`);
          }
        }

        // Edges
        if (workflow.edges.length > 0) {
          console.log('');
          console.log(`  Edges (${workflow.edges.length}):`);
          for (const edge of workflow.edges) {
            const label = edge.label ? ` (${edge.label})` : '';
            console.log(`    ${edge.source} \u2192 ${edge.target}${label}`);
          }
        }

        console.log('');
        console.log(`  Run this workflow: myndhyve-cli workflows run ${workflow.id} --canvas-type=${workflow.canvasTypeId}`);
        console.log('');
      } catch (error) {
        printError('Failed to get workflow info', error);
      }
    });
}

// ============================================================================
// RUN (TRIGGER WORKFLOW)
// ============================================================================

function registerRunCommand(workflows: Command): void {
  workflows
    .command('run <workflow-id>')
    .description('Trigger a workflow run')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--input <json>', 'Input data as JSON string')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('--watch', 'After creating the run, attach to its event stream and exit when terminal (composes with `workflows tail` semantics)')
    .option(
      '--stream-mode <mode>',
      'When --watch is set, the SSE stream mode (updates | values | messages | debug | comma-separated mixed)',
      'updates',
    )
    .action(async (workflowId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      // Parse and validate input data if provided
      let inputData: Record<string, unknown> | undefined;
      if (opts.input) {
        try {
          const parsed = JSON.parse(opts.input);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            printErrorResult({
              code: 'INVALID_INPUT',
              message: '--input must be a JSON object, not a string, array, or primitive.',
              suggestion: 'Example: --input \'{"topic":"AI chatbots"}\'',
            });
            process.exitCode = ExitCode.USAGE_ERROR;
            return;
          }
          inputData = parsed;
        } catch {
          printErrorResult({
            code: 'INVALID_JSON',
            message: 'Invalid JSON for --input flag.',
            suggestion: 'Example: --input \'{"topic":"AI chatbots"}\'',
          });
          process.exitCode = ExitCode.USAGE_ERROR;
          return;
        }
      }

      try {
        // Verify workflow exists
        const workflow = await getWorkflow(canvasTypeId, workflowId);
        if (!workflow) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Workflow "${workflowId}" not found in canvas type "${canvasTypeId}".`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (!workflow.enabled) {
          printErrorResult({
            code: 'WORKFLOW_DISABLED',
            message: `Workflow "${workflowId}" is disabled.`,
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }

        const run = await createRun(auth.uid, canvasTypeId, workflowId, {
          inputData,
          triggerType: 'manual',
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(run, null, 2));
          if (opts.watch) {
            // JSON mode + watch: emit the run-created envelope first,
            // then continue streaming events as one-line JSON
            // objects. Shell consumers can `jq` the stream.
            await streamRunUntilTerminal(run.id, opts);
          }
          return;
        }

        console.log('\n  Workflow run created.');
        console.log(`  Run ID:     ${run.id}`);
        console.log(`  Workflow:   ${workflow.name}`);
        console.log(`  Status:     ${run.status}`);
        console.log('');
        if (opts.watch) {
          console.log(`  Watching event stream (Ctrl-C to detach):`);
          console.log('');
          await streamRunUntilTerminal(run.id, opts);
        } else {
          console.log(`  Check status: myndhyve-cli workflows status ${run.id} --canvas-type=${canvasTypeId}`);
          console.log(`  View logs:    myndhyve-cli workflows logs ${run.id} --canvas-type=${canvasTypeId}`);
          console.log('');
        }
      } catch (error) {
        printError('Failed to trigger workflow run', error);
      }
    });
}

// ============================================================================
// STATUS (RUN STATUS)
// ============================================================================

function registerStatusCommand(workflows: Command): void {
  workflows
    .command('status <run-id>')
    .description('Show workflow run status and progress')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      try {
        const run = await getRun(auth.uid, canvasTypeId, runId);

        if (!run) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Run "${runId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(run, null, 2));
          return;
        }

        console.log(`\n  Workflow Run: ${run.id}`);
        console.log('  ' + '\u2500'.repeat(60));
        console.log(`  Workflow:   ${run.workflowName || run.workflowId}`);
        console.log(`  Status:     ${formatRunStatus(run.status)}`);
        console.log(`  Trigger:    ${run.triggerType}`);

        if (run.totalNodes > 0) {
          const pct = Math.round((run.progress / run.totalNodes) * 100);
          const bar = buildProgressBar(pct);
          console.log(`  Progress:   ${bar} ${pct}% (${run.progress}/${run.totalNodes} nodes)`);
        }

        if (run.currentNodeLabel || run.currentNodeId) {
          console.log(`  Current:    ${run.currentNodeLabel || run.currentNodeId}`);
        }

        if (run.startedAt) {
          console.log(`  Started:    ${formatRelativeTime(run.startedAt)}`);
        }

        if (run.completedAt) {
          console.log(`  Completed:  ${formatRelativeTime(run.completedAt)}`);
        }

        if (run.durationMs !== undefined) {
          console.log(`  Duration:   ${formatDuration(run.durationMs)}`);
        }

        if (run.error) {
          // run.error is the structured wire shape from @myndhyve/types:
          // { code, message, nodeId? }. `formatRunError(... withHint: true)`
          // surfaces both the raw `[code] message (node)` line AND an
          // operator-actionable hint when the code is in the canonical
          // RUN_ERROR_CODES set with a known remediation. The hint
          // turns a bare wire code into directly-actionable guidance —
          // e.g. `recursion_limit_exceeded` becomes "Increase
          // RunOptions.configurable.recursionLimit or simplify the
          // workflow."
          const formatted = formatRunError(run.error, { withHint: true });
          const [headLine, ...hintLines] = formatted.split('\n');
          console.log(`  Error:      ${headLine}`);
          for (const hintLine of hintLines) {
            // Hint lines come pre-indented with two spaces from the
            // helper; align under the "Error:      " label so the
            // visual column stays consistent.
            console.log(`              ${hintLine.trimStart()}`);
          }
        }

        // Show node states
        if (run.nodeStates.length > 0) {
          console.log('');
          console.log('  Node Status:');
          for (const ns of run.nodeStates) {
            const icon = getStatusIcon(ns.status);
            const label = ns.label || ns.nodeId;
            let extra = '';
            if (ns.error) extra = ` — ${truncate(ns.error, 40)}`;
            if (ns.approval?.decision) extra = ` — ${ns.approval.decision}`;
            console.log(`    ${icon} ${label}${extra}`);
          }
        }

        // Show approval hint if waiting
        if (run.status === 'waiting-approval') {
          console.log('');
          console.log(`  Approve: myndhyve-cli workflows approve ${run.id} --canvas-type=${canvasTypeId}`);
          console.log(`  Reject:  myndhyve-cli workflows reject ${run.id} --canvas-type=${canvasTypeId}`);
          console.log(`  Revise:  myndhyve-cli workflows revise ${run.id} --feedback="..." --canvas-type=${canvasTypeId}`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to get run status', error);
      }
    });
}

// ============================================================================
// WAIT
// ============================================================================

/**
 * G13 — `workflows wait <run-id>` blocks until the run reaches a
 * terminal status. Useful for shell pipelines + CI:
 *
 *   myndhyve-cli workflows run my-workflow --canvas-type=cad \
 *     | jq -r .runId | xargs myndhyve-cli workflows wait
 *
 * Polls `getRun` on a configurable interval (default 3s) and exits
 * when the run reports a status in `TERMINAL_RUN_STATUSES` (from
 * `@myndhyve/types`). Exit codes:
 *   - 0 (SUCCESS) when the run completed
 *   - 1 (GENERAL_ERROR) when the run terminated in any non-completed
 *     terminal state (failed / cancelled / timed-out / interrupted)
 *   - 1 when the wait itself timed out (default 600s)
 *   - 3 (NOT_FOUND) when the runId is unknown
 *
 * On exit, prints the final status + duration + any structured
 * `RunError` with operator-actionable hint (via `formatRunError`).
 *
 * **Polling rationale.** The CLI doesn't yet have an SSE event-log
 * subscriber; `workflows tail` is a sibling G13 follow-on that adds
 * one. Until then, polling getRun() is the simplest path that
 * doesn't pull in a full streaming client. Default 3s interval
 * balances responsiveness vs read cost (Firestore-backed
 * getRun() = 1 doc read per poll). Operators can tune via
 * `--interval`.
 */
function registerWaitCommand(workflows: Command): void {
  workflows
    .command('wait <run-id>')
    .description('Block until a run reaches a terminal status (completed / failed / cancelled / timed-out / interrupted)')
    .option('--canvas-type <canvasTypeId>', "Canvas type ID (defaults to active project's canvas type)")
    .option('--timeout <sec>', 'Maximum wait time in seconds before giving up', '600')
    .option('--interval <sec>', 'Poll interval in seconds', '3')
    .option('--quiet', 'Suppress the per-poll status updates; print only the final outcome')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      const timeoutSec = parseWaitNumber(opts.timeout, 'timeout', 1, 86_400);
      if (timeoutSec === null) return;
      const intervalSec = parseWaitNumber(opts.interval, 'interval', 1, 300);
      if (intervalSec === null) return;

      const startedAt = Date.now();
      const deadline = startedAt + timeoutSec * 1000;
      const quiet = Boolean(opts.quiet);
      const jsonMode = opts.format === 'json';

      let lastStatus: string | null = null;
      let pollCount = 0;
      // Loop until either:
      //   (a) the run reaches a terminal status, or
      //   (b) we exceed the deadline.
      // The body intentionally fetches BEFORE the sleep so the first
      // poll is immediate (operators get instant feedback when the run
      // is already terminal at command invocation).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        pollCount += 1;
        let run;
        try {
          run = await getRun(auth.uid, canvasTypeId, runId);
        } catch (err) {
          printError('Failed to read run status', err);
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
        if (!run) {
          if (jsonMode) {
            console.log(JSON.stringify({ runId, found: false }, null, 2));
          } else {
            printErrorResult({
              code: 'NOT_FOUND',
              message: `Run "${runId}" not found.`,
            });
          }
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        // Per-status-change update line. Skipped in --quiet and JSON
        // modes (JSON only emits one final structured payload). We
        // print on (a) the first poll regardless of status, and (b)
        // any subsequent status change. Avoids spamming the terminal
        // when the run sits in `running` for many polls.
        if (!quiet && !jsonMode && run.status !== lastStatus) {
          const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
          const prefix = lastStatus === null ? 'Status' : 'Status →';
          console.log(`  ${prefix}: ${formatRunStatus(run.status)} (${elapsedSec}s elapsed, poll #${pollCount})`);
          lastStatus = run.status;
        }

        if (isTerminalRunStatus(run.status)) {
          // Final report.
          if (jsonMode) {
            console.log(
              JSON.stringify(
                {
                  runId: run.id,
                  status: run.status,
                  durationMs: run.durationMs,
                  startedAt: run.startedAt,
                  completedAt: run.completedAt,
                  error: run.error,
                  pollCount,
                },
                null,
                2,
              ),
            );
          } else {
            console.log('');
            console.log(`  Final status: ${formatRunStatus(run.status)}`);
            if (run.durationMs !== undefined) {
              console.log(`  Duration:     ${formatDuration(run.durationMs)}`);
            }
            if (run.error) {
              const formatted = formatRunError(run.error, { withHint: true });
              const [headLine, ...hintLines] = formatted.split('\n');
              console.log(`  Error:        ${headLine}`);
              for (const hintLine of hintLines) {
                console.log(`                ${hintLine.trimStart()}`);
              }
            }
          }
          // Exit code: 0 only on `completed`. Every other terminal
          // status (failed / cancelled / timed-out / interrupted) is
          // a non-success signal CI/scripts should branch on.
          process.exitCode =
            run.status === 'completed' ? ExitCode.SUCCESS : ExitCode.GENERAL_ERROR;
          return;
        }

        // Not yet terminal — sleep until the next poll, but don't
        // sleep past the deadline.
        const now = Date.now();
        if (now >= deadline) {
          if (jsonMode) {
            console.log(
              JSON.stringify(
                {
                  runId: run.id,
                  status: run.status,
                  timedOut: true,
                  waitedSec: Math.round((now - startedAt) / 1000),
                  pollCount,
                },
                null,
                2,
              ),
            );
          } else {
            console.log('');
            console.log(`  Wait timed out after ${timeoutSec}s.`);
            console.log(`  Last status: ${formatRunStatus(run.status)}`);
            console.log(
              `  The run is still in flight; re-invoke 'workflows wait ${run.id}' to keep polling, or use 'workflows status ${run.id}' for a one-shot check.`,
            );
          }
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
        const sleepMs = Math.min(intervalSec * 1000, deadline - now);
        await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
      }
    });
}

/**
 * Parse a numeric CLI option value with bounds. Prints a usage error
 * and sets the appropriate exit code on failure; callers check for
 * `null` and short-circuit. Shared by `wait`'s `--timeout` and
 * `--interval` flags.
 */
function parseWaitNumber(
  raw: string,
  optName: string,
  min: number,
  max: number,
): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    printErrorResult({
      code: 'INVALID_OPTION',
      message: `--${optName} must be an integer between ${min} and ${max} (got "${raw}").`,
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return n;
}

// ============================================================================
// TAIL
// ============================================================================

/**
 * G13 — `workflows tail <run-id>` opens the SSE event stream and
 * prints events live. Reuses the {@link WorkflowRuntimeClient}
 * foundation from G13 phase 1 so the same SSE consumer powers
 * `tail`, the `--watch` flag on `run`, and any future streaming
 * command.
 *
 * Stream-mode default is `updates` (per spec): node lifecycle +
 * run-level transitions. Operators can request finer detail via
 * `--stream-mode=debug` or richer event types via mixed mode
 * (`--stream-mode=updates,messages`).
 *
 * Exit codes mirror `wait`:
 *   - 0 SUCCESS         when the stream ends with a `run.completed` event
 *   - 1 GENERAL_ERROR   when the stream ends with `run.failed` /
 *                       `run.cancelled` / `run.timed-out`, OR the SSE
 *                       reconnect budget is exhausted
 *   - 1 GENERAL_ERROR   on auth/permission failures bubbling up from
 *                       the runtime
 *
 * Reconnect: the underlying `consumeSseStreamWithReconnect` loop
 * resumes from the last seen `id:` after a transient drop. Operators
 * see a `(reconnecting…)` line in text mode; JSON mode emits no
 * intermediate noise.
 */
function registerTailCommand(workflows: Command): void {
  workflows
    .command('tail <run-id>')
    .description('Stream a run\'s event log live via SSE (Ctrl-C to detach)')
    .option('--canvas-type <canvasTypeId>', "Canvas type ID (defaults to active project's canvas type)")
    .option(
      '--stream-mode <mode>',
      'Stream mode: updates | values | messages | debug | comma-separated mixed (e.g. updates,messages)',
      'updates',
    )
    .option('--buffer-ms <n>', 'Server-side aggregation window in ms (0–5000); 0 disables', '0')
    .option('--from-sequence <id>', 'Resume from a specific Last-Event-ID (sequence string)')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;
      const _canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      // canvas-type isn't strictly required for the runtime call (the
      // runtime resolves the workspace/project from the run doc), but
      // we still validate the active context is set so operators get
      // a clean error when they forget --canvas-type and have no
      // active project.
      if (!_canvasTypeId) return;

      // Validate buffer-ms early so a usage error fires before any
      // network call. The helper accepts the parsed value via `opts`.
      const bufferMsCheck = parseWaitNumber(opts.bufferMs ?? '0', 'buffer-ms', 0, 5_000);
      if (bufferMsCheck === null) return;

      // Delegate to the shared streamer (same path used by
      // `run --watch`). Single-source so format/error handling/SIGINT
      // semantics stay identical across both commands.
      await streamRunUntilTerminal(runId, opts);
    });
}

/** Best-effort JSON parse — returns the raw string if the payload isn't JSON. */
function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Shared SSE consumer used by both `tail` and `run --watch`. Streams
 * events from the workflow-runtime, prints them in the caller's
 * preferred format, and sets `process.exitCode` on terminal/failure.
 *
 * Single-source so the two commands stay in lockstep on stream-mode
 * handling, error rendering, exit codes, and SIGINT detach.
 */
async function streamRunUntilTerminal(
  runId: string,
  opts: { format?: string; streamMode?: string; bufferMs?: string; fromSequence?: string },
): Promise<void> {
  const jsonMode = opts.format === 'json';
  const bufferMs = opts.bufferMs
    ? parseWaitNumber(opts.bufferMs, 'buffer-ms', 0, 5_000) ?? 0
    : 0;
  const client = new WorkflowRuntimeClient();
  const ctrl = new AbortController();
  const sigintHandler = (): void => {
    if (!jsonMode) console.log('  (detaching from stream — run keeps running)');
    ctrl.abort();
  };
  process.on('SIGINT', sigintHandler);
  try {
    for await (const event of client.streamEvents(runId, {
      streamMode: (opts.streamMode ?? 'updates') as StreamMode,
      bufferMs,
      lastEventId: opts.fromSequence ?? null,
      signal: ctrl.signal,
    })) {
      if (jsonMode) {
        console.log(
          JSON.stringify({ id: event.id, event: event.event, data: tryParseJson(event.data) }),
        );
      } else {
        const parsed = tryParseJson(event.data);
        const detail =
          typeof parsed === 'object' && parsed !== null
            ? formatTailDetail(parsed as Record<string, unknown>)
            : event.data;
        console.log(`  [${event.id ?? '·'}] ${event.event}${detail ? ` — ${detail}` : ''}`);
      }
      if (
        event.event === 'run.failed' ||
        event.event === 'run.cancelled' ||
        event.event === 'run.timed-out'
      ) {
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
      if (event.event === 'error') {
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    }
  } catch (err) {
    if (err instanceof WorkflowRuntimeAuthError) {
      printErrorResult({ code: 'AUTH_REQUIRED', message: err.message });
      process.exitCode = ExitCode.UNAUTHORIZED;
    } else if (err instanceof WorkflowRuntimeError) {
      printErrorResult({
        code: err.code.toUpperCase(),
        message: err.message,
        ...(err.hint ? { suggestion: err.hint } : {}),
      });
      process.exitCode = ExitCode.GENERAL_ERROR;
    } else {
      printError('Stream failed', err);
      process.exitCode = ExitCode.GENERAL_ERROR;
    }
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}

/**
 * Render a one-line detail summary from an event payload. The wire
 * shape is `RunEventDoc` per `docs/wop-spec/v1/api/asyncapi.yaml` —
 * pick a small set of common fields (nodeId, status, error.code) so
 * `tail`'s output stays scannable. Verbose payloads are dropped from
 * the line; consumers wanting full payloads switch to `--format json`.
 */
function formatTailDetail(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.nodeId === 'string') parts.push(`node=${payload.nodeId}`);
  if (typeof payload.status === 'string') parts.push(`status=${payload.status}`);
  if (
    payload.error &&
    typeof payload.error === 'object' &&
    typeof (payload.error as Record<string, unknown>).code === 'string'
  ) {
    parts.push(`err=${(payload.error as Record<string, unknown>).code as string}`);
  }
  return parts.join(' ');
}

// ============================================================================
// PENDING
// ============================================================================

/**
 * G13 — `workflows pending [--canvas-type <id>]` lists runs in
 * `waiting-approval` across the user's runs. Default is workspace-
 * wide (cross-canvas-type) with a `--canvas-type` flag to scope.
 *
 * Output: a table with workflow name, run id, age, and the per-row
 * approve/reject/revise hint lines mirroring `workflows status`'s
 * waiting-approval treatment so operators can copy-paste the exact
 * command to act.
 */
function registerPendingCommand(workflows: Command): void {
  workflows
    .command('pending')
    .description('List runs currently waiting for approval (cross-canvas-type by default)')
    .option('--canvas-type <canvasTypeId>', 'Scope to a single canvas type (default: all canvas types under this user)')
    .option('--limit <n>', 'Max runs to show', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;
      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const runs = await listPendingApprovals(auth.uid, {
          canvasTypeId: opts.canvasType,
          limit,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(runs, null, 2));
          return;
        }

        if (runs.length === 0) {
          const scopeLabel = opts.canvasType
            ? `canvas type "${opts.canvasType}"`
            : 'any canvas type';
          console.log(`\n  No runs waiting for approval in ${scopeLabel}.`);
          return;
        }

        console.log(`\n  Pending approvals (${runs.length}):`);
        console.log('  ' + '─'.repeat(60));
        for (const run of runs) {
          const ageStr = run.startedAt ? formatRelativeTime(run.startedAt) : '—';
          console.log('');
          console.log(`  • ${truncate(run.workflowName ?? run.workflowId, 50)}`);
          console.log(`    Run:        ${run.id}`);
          console.log(`    Started:    ${ageStr}`);
          // canvasTypeId on the summary is reliable when the
          // cross-canvas-type query is used (so operators can see
          // which canvas-type the run lives under without re-running
          // with --canvas-type=…).
          if ((run as RunSummary & { canvasTypeId?: string }).canvasTypeId) {
            console.log(
              `    Canvas:     ${(run as RunSummary & { canvasTypeId?: string }).canvasTypeId}`,
            );
          }
          // Action hints (consistent with workflows status's
          // waiting-approval treatment). The operator copies the
          // command line they want to run.
          const ctFlag = (run as RunSummary & { canvasTypeId?: string }).canvasTypeId
            ? ` --canvas-type=${(run as RunSummary & { canvasTypeId?: string }).canvasTypeId}`
            : '';
          console.log(`    Approve:    myndhyve-cli workflows approve ${run.id}${ctFlag}`);
          console.log(`    Reject:     myndhyve-cli workflows reject ${run.id}${ctFlag}`);
          console.log(`    Revise:     myndhyve-cli workflows revise ${run.id}${ctFlag}`);
        }
        console.log('');
      } catch (err) {
        // Firestore "FAILED_PRECONDITION" surfaces when the cross-
        // canvas-type composite index is missing in the deployed
        // project. Translate into an operator-actionable hint
        // pointing at the canvas-type-scoped fallback.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('FAILED_PRECONDITION') || msg.toLowerCase().includes('index')) {
          printErrorResult({
            code: 'INDEX_MISSING',
            message:
              'The cross-canvas-type pending-approvals query needs a Firestore composite index that has not been deployed yet.',
            suggestion:
              'As a workaround, scope to a single canvas type with --canvas-type=<id>. The composite index ships in firestore.indexes.json and deploys via `firebase deploy --only firestore:indexes`.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
        printError('Failed to list pending approvals', err);
      }
    });
}

// ============================================================================
// SUBMIT
// ============================================================================

/**
 * G13 — `workflows submit <workflow-id>` is the explicit detached-
 * submission verb operators reach for in shell pipelines. It's a
 * one-line wrapper around `workflows run --format json` so the
 * command surface stays single-source: the `run` handler already
 * supports detached creation and JSON output.
 *
 * Why a separate verb if `run --format json` already exists:
 *   - operator UX: `submit` reads as fire-and-forget; `run` reads as
 *     "trigger and tell me what happened"
 *   - shell-pipeline ergonomics: `submit` always returns the
 *     structured payload regardless of TTY detection in the future
 *
 * Implementation: invoke the same Commander action by re-emitting
 * the run command with the JSON-format flag injected.
 */
function registerSubmitCommand(workflows: Command): void {
  workflows
    .command('submit <workflow-id>')
    .description('Submit a workflow for detached execution (alias for `workflows run --format=json`)')
    .option('--canvas-type <canvasTypeId>', "Canvas type ID (defaults to active project's canvas type)")
    .option('--input <json>', 'Input data as JSON string')
    .action(async (workflowId: string, opts) => {
      // Delegate to `run` by invoking the same parent command with
      // --format=json forced. The `run` handler does its own auth +
      // input-parsing; we just re-route through the program tree so
      // future changes to `run` (new flags, validation, etc.) flow
      // here automatically.
      const argv = ['workflows', 'run', workflowId, '--format', 'json'];
      if (opts.canvasType) argv.push('--canvas-type', opts.canvasType);
      if (opts.input) argv.push('--input', opts.input);
      // Walk up to the root program and re-parse with the synthetic
      // argv. Commander's parseAsync is the canonical way to invoke
      // a sibling command without manually replaying the action.
      const root = (workflows.parent ?? workflows) as Command;
      await root.parseAsync(argv, { from: 'user' });
    });
}

// ============================================================================
// LOGS
// ============================================================================

function registerLogsCommand(workflows: Command): void {
  workflows
    .command('logs <run-id>')
    .description('View workflow run execution logs')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--limit <n>', 'Max log entries to show', '100')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .option('-f, --follow', 'Follow log output in real-time (polls every 2.5s)')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const logs = await getRunLogs(auth.uid, canvasTypeId, runId);

        if (logs === null) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Run "${runId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        // ── Follow mode ──────────────────────────────────────────────
        if (opts.follow) {
          const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
          const POLL_INTERVAL_MS = 2500;
          let lastLogCount = 0;

          console.log(`\n  Following logs for run "${runId}" (Ctrl+C to stop)\n`);

          // Show any existing logs first
          if (logs.length > 0) {
            for (const entry of logs) {
              const time = formatLogTimestamp(entry.timestamp);
              const level = formatLogLevel(entry.level);
              const node = entry.nodeLabel || entry.nodeId || '';
              const nodePrefix = node ? `[${truncate(node, 20)}] ` : '';
              console.log(`  ${time}  ${level}  ${nodePrefix}${entry.message}`);
            }
            lastLogCount = logs.length;
          }

          // Check initial run status
          const initialRun = await getRun(auth.uid, canvasTypeId, runId);
          if (initialRun && TERMINAL_STATUSES.has(initialRun.status)) {
            console.log(`\n  Run reached terminal state: ${initialRun.status}\n`);
            return;
          }

          // Poll loop
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

            const freshLogs = await getRunLogs(auth.uid, canvasTypeId, runId);
            if (freshLogs && freshLogs.length > lastLogCount) {
              const newEntries = freshLogs.slice(lastLogCount);
              for (const entry of newEntries) {
                const time = formatLogTimestamp(entry.timestamp);
                const level = formatLogLevel(entry.level);
                const node = entry.nodeLabel || entry.nodeId || '';
                const nodePrefix = node ? `[${truncate(node, 20)}] ` : '';
                console.log(`  ${time}  ${level}  ${nodePrefix}${entry.message}`);
              }
              lastLogCount = freshLogs.length;
            }

            // Check run status
            const run = await getRun(auth.uid, canvasTypeId, runId);
            if (run && TERMINAL_STATUSES.has(run.status)) {
              console.log(`\n  Run reached terminal state: ${run.status}\n`);
              break;
            }
          }
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(logs, null, 2));
          return;
        }

        if (logs.length === 0) {
          console.log(`\n  No logs found for run "${runId}".\n`);
          return;
        }

        const displayLogs = logs.slice(0, limit);

        console.log(`\n  Run Logs — ${runId} (${displayLogs.length}/${logs.length} entries)\n`);

        for (const entry of displayLogs) {
          const time = formatLogTimestamp(entry.timestamp);
          const level = formatLogLevel(entry.level);
          const node = entry.nodeLabel || entry.nodeId || '';
          const nodePrefix = node ? `[${truncate(node, 20)}] ` : '';

          console.log(`  ${time}  ${level}  ${nodePrefix}${entry.message}`);
        }

        if (logs.length > limit) {
          console.log(`\n  ... ${logs.length - limit} more entries (use --limit to see more)`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to get run logs', error);
      }
    });
}

// ============================================================================
// ARTIFACTS
// ============================================================================

function registerArtifactCommands(workflows: Command): void {
  const artifacts = workflows
    .command('artifacts')
    .description('View and download workflow run artifacts');

  // ── List ──────────────────────────────────────────────────────────────

  artifacts
    .command('list')
    .description('List artifacts from a workflow run')
    .requiredOption('--run <runId>', 'Run ID (required — artifacts are scoped to runs)')
    .option('--limit <n>', 'Max artifacts to show', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const results = await listArtifacts(opts.run, {
          limit,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log('\n  No artifacts found.');
          console.log('  Artifacts are generated when workflows produce output (PRDs, plans, etc.).\n');
          return;
        }

        console.log(`\n  Artifacts (${results.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(24) +
            'Type'.padEnd(14) +
            'Run'.padEnd(20) +
            'Created'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const a of results) {
          const created = a.createdAt ? formatRelativeTime(a.createdAt) : '\u2014';

          console.log(
            '  ' +
              truncate(a.id, 22).padEnd(24) +
              truncate(a.name, 22).padEnd(24) +
              truncate(a.type, 12).padEnd(14) +
              truncate(a.runId, 18).padEnd(20) +
              created
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list artifacts', error);
      }
    });

  // ── Get ───────────────────────────────────────────────────────────────

  artifacts
    .command('get <artifact-id>')
    .description('Download an artifact\'s content')
    .requiredOption('--run <runId>', 'Run ID (required — artifacts are scoped to runs)')
    .option('--output <path>', 'Write to file instead of stdout')
    .option('--format <format>', 'Output format (json, raw)', 'json')
    .action(async (artifactId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const artifact = await getArtifact(opts.run, artifactId);

        if (!artifact) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Artifact "${artifactId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        const content = artifact.content || artifact.metadata || {};
        const output = JSON.stringify(content, null, 2);

        if (opts.output) {
          writeFileSync(opts.output, output, 'utf-8');
          console.log(`\n  Artifact "${artifact.name}" written to ${opts.output}`);
          console.log(`  Type: ${artifact.type}  Size: ${output.length} bytes\n`);
          return;
        }

        if (opts.format === 'json') {
          // Print full artifact with metadata
          console.log(JSON.stringify(artifact, null, 2));
        } else {
          // Raw content only
          console.log(output);
        }
      } catch (error) {
        printError('Failed to get artifact', error);
      }
    });
}

// ============================================================================
// APPROVAL COMMANDS
// ============================================================================

function registerApprovalCommands(workflows: Command): void {
  // ── Approve ─────────────────────────────────────────────────────────

  workflows
    .command('approve <run-id>')
    .description('Approve a workflow run that is waiting for approval')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--feedback <text>', 'Optional feedback message')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      try {
        const result = await approveRun(auth.uid, canvasTypeId, runId, opts.feedback);

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Run "${runId}" approved.`);
        console.log(`  Status: ${result.status}`);
        if (opts.feedback) {
          console.log(`  Feedback: ${opts.feedback}`);
        }
        console.log('');
      } catch (error) {
        printError('Failed to approve run', error);
      }
    });

  // ── Reject ──────────────────────────────────────────────────────────

  workflows
    .command('reject <run-id>')
    .description('Reject a workflow run that is waiting for approval')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--reason <text>', 'Rejection reason')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      try {
        const result = await rejectRun(auth.uid, canvasTypeId, runId, opts.reason);

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Run "${runId}" rejected.`);
        console.log(`  Status: ${result.status}`);
        if (opts.reason) {
          console.log(`  Reason: ${opts.reason}`);
        }
        console.log('');
      } catch (error) {
        printError('Failed to reject run', error);
      }
    });

  // ── Revise ──────────────────────────────────────────────────────────

  workflows
    .command('revise <run-id>')
    .description('Request revisions on a workflow run waiting for approval')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .requiredOption('--feedback <text>', 'Revision feedback (required)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      try {
        const result = await reviseRun(auth.uid, canvasTypeId, runId, opts.feedback);

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Revisions requested for run "${runId}".`);
        console.log(`  Status:   ${result.status}`);
        console.log(`  Feedback: ${opts.feedback}`);
        console.log('');
      } catch (error) {
        printError('Failed to request revisions', error);
      }
    });
}

// ============================================================================
// RUNS (LIST RUNS)
// ============================================================================

function registerRunsCommand(workflows: Command): void {
  workflows
    .command('runs')
    .description('List workflow runs')
    .option('--canvas-type <canvasTypeId>', 'Canvas type ID (defaults to active project\'s canvas type)')
    .option('--status <status>', 'Filter by status')
    .option('--workflow <workflowId>', 'Filter by workflow ID')
    .option('--limit <n>', 'Max runs to show', '25')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const canvasTypeId = resolveCanvasTypeId(opts.canvasType);
      if (!canvasTypeId) return;

      if (opts.status && !validateRunStatus(opts.status)) return;

      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const results = await listRuns(auth.uid, canvasTypeId, {
          status: opts.status,
          workflowId: opts.workflow,
          limit,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log('\n  No workflow runs found.');
          console.log('  Trigger a run with: myndhyve-cli workflows run <workflow-id>\n');
          return;
        }

        console.log(`\n  Workflow Runs (${results.length})\n`);
        console.log(
          '  ' +
            'Run ID'.padEnd(24) +
            'Workflow'.padEnd(20) +
            'Status'.padEnd(20) +
            'Progress'.padEnd(12) +
            'Started'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const run of results) {
          const statusText = formatRunStatus(run.status);
          const progress = run.totalNodes > 0
            ? `${run.progress}/${run.totalNodes}`
            : '\u2014';
          const started = run.startedAt ? formatRelativeTime(run.startedAt) : '\u2014';

          console.log(
            '  ' +
              truncate(run.id, 22).padEnd(24) +
              truncate(run.workflowName || run.workflowId, 18).padEnd(20) +
              statusText.padEnd(20) +
              progress.padEnd(12) +
              started
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list runs', error);
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve the canvas type ID from --canvas-type flag or active project context.
 * Prints an error and sets exitCode if no canvas type ID is available.
 */
function resolveCanvasTypeId(flagValue?: string): string | null {
  if (flagValue) return flagValue;

  const ctx = getActiveContext();
  if (ctx?.canvasTypeId) return ctx.canvasTypeId;

  printErrorResult({
    code: 'MISSING_CANVAS_TYPE_ID',
    message: 'No canvas type ID specified.',
    suggestion: 'Use --canvas-type=<canvasTypeId> or set an active project with `myndhyve-cli use <project-id>`.',
  });
  process.exitCode = ExitCode.USAGE_ERROR;
  return null;
}

/**
 * Validate a --status flag value against known run statuses.
 */
function validateRunStatus(status: string): boolean {
  if (!VALID_RUN_STATUSES.includes(status as WorkflowRunStatus)) {
    printErrorResult({
      code: 'INVALID_STATUS',
      message: `Unknown run status "${status}".`,
      suggestion: `Valid statuses: ${VALID_RUN_STATUSES.join(', ')}`,
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return false;
  }
  return true;
}

/**
 * Format a run status with a text indicator.
 */
function formatRunStatus(status: string): string {
  const icons: Record<string, string> = {
    'pending': '\u25cb pending',
    'planned': '\u25cb planned',
    'running': '\u25cf running',
    'executing': '\u25cf executing',
    'waiting-approval': '\u2691 approval',
    'waiting-external': '\u23f3 waiting-external',
    'paused': '\u25a1 paused',
    'timed-out': '\u29d6 timed-out',
    'interrupted': '\u26a0 interrupted',
    'completed': '\u2713 completed',
    'failed': '\u2717 failed',
    'cancelled': '\u2014 cancelled',
  };
  return icons[status] || status;
}

/**
 * Get a status icon for node state display.
 */
function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    'pending': '\u25cb',
    'running': '\u25cf',
    'completed': '\u2713',
    'failed': '\u2717',
    'skipped': '\u2014',
    'waiting-approval': '\u2691',
    'waiting-input': '\u270e',
    'queued': '\u25cb',
    'paused': '\u25a1',
    'timed-out': '\u29d6',
    'interrupted': '\u26a0',
  };
  return icons[status] || '\u25cb';
}

/**
 * Build an ASCII progress bar.
 */
function buildProgressBar(percent: number): string {
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

/**
 * Format a duration in milliseconds to human-readable form.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

/**
 * Format a log entry timestamp to a compact UTC form (HH:MM:SS.mmm).
 * Uses UTC to ensure consistent output regardless of the user's timezone,
 * since server-side logs are recorded in UTC.
 */
function formatLogTimestamp(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    const s = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  } catch {
    return isoDate.slice(11, 23);
  }
}

/**
 * Parse and validate a --limit flag value. Returns the parsed number or null
 * (with error output) if invalid.
 */
function parseLimit(value: string, flagName = '--limit'): number | null {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) {
    printErrorResult({
      code: 'INVALID_OPTION',
      message: `${flagName} must be a positive integer, got "${value}".`,
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return n;
}

/**
 * Format a log level with fixed-width padding.
 */
function formatLogLevel(level: string): string {
  const levels: Record<string, string> = {
    'debug': 'DBG',
    'info': 'INF',
    'warn': 'WRN',
    'error': 'ERR',
  };
  return (levels[level] || level.toUpperCase().slice(0, 3)).padEnd(3);
}

// ============================================================================
// REPLAY (Phase 1.2.5 — dry-run report)
// ============================================================================

function registerReplayCommand(workflows: Command): void {
  const replay = workflows
    .command('replay <runId>')
    .description('Replay a workflow run')
    .option('--dry-run', 'Show which calls would replay from cache vs re-execute (no state changes)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts: { dryRun?: boolean; format?: string }) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.dryRun) {
        printErrorResult({
          code: 'NOT_IMPLEMENTED',
          message: 'Real replay is not yet supported via CLI. Pass --dry-run to preview.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      const ctx = getActiveContext();
      const workspaceId = ctx?.workspaceId;
      if (!workspaceId) {
        printErrorResult({
          code: 'NO_WORKSPACE',
          message: 'No active workspace. Set one with `myndhyve-cli projects open <projectId>` first.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const report = await dryRunReplay(workspaceId, runId);

        if (opts.format === 'json') {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        printDryRunReport(report);
      } catch (err) {
        printError('Failed to compute dry-run replay report', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // Marker so tests can assert the command exists without poking commander internals.
  void replay;
}

/**
 * Pretty-print a `DryRunReport`. Output mirrors `workflows status`:
 * summary header → per-node breakdown → totals footer.
 */
function printDryRunReport(report: DryRunReport): void {
  console.log('');
  console.log(`  Run:          ${report.runId}`);
  console.log(`  Workspace:    ${report.workspaceId}`);
  console.log(`  Invocations:  ${report.totalInvocations}`);
  console.log(`  Cached:       ${report.cachedCount} (will replay from InvocationLog)`);
  console.log(`  Re-execute:   ${report.wouldReExecuteCount} (no committed receipt)`);

  if (report.totalInvocations === 0) {
    console.log('');
    console.log('  No external-call receipts found for this run.');
    console.log('  Either the run made no idempotency-wrapped calls, or the run');
    console.log('  predates Phase 1.2 idempotency wiring.');
    return;
  }

  console.log('');
  console.log('  Per-node breakdown:');
  console.log('');
  const nodeIds = Object.keys(report.byNode).sort();
  for (const nodeId of nodeIds) {
    const invocations = report.byNode[nodeId];
    console.log(`    ${nodeId}`);
    for (const inv of invocations) {
      const marker = formatStatusMarker(inv.status);
      const when = inv.completedAt ?? inv.startedAt ?? 'unknown';
      const errorSuffix = inv.errorMessage ? `  — ${truncate(inv.errorMessage, 80)}` : '';
      console.log(`      ${marker} attempt=${inv.attempt}  ${formatRelativeTime(when)}${errorSuffix}`);
    }
  }
  console.log('');
}

function formatStatusMarker(status: InvocationSummary['status']): string {
  switch (status) {
    case 'committed': return '\u2713 cached    ';   // ✓
    case 'running':   return '\u25cb running   ';   // ○
    case 'failed':    return '\u2717 re-execute';   // ✗
    default:          return '? unknown   ';
  }
}
