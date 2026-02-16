/**
 * MyndHyve CLI — Workflow Commands
 *
 * Commander subcommand group for workflow automation:
 *   myndhyve-cli workflows list
 *   myndhyve-cli workflows info <workflow-id>
 *   myndhyve-cli workflows run <workflow-id>
 *   myndhyve-cli workflows status <run-id>
 *   myndhyve-cli workflows logs <run-id>
 *   myndhyve-cli workflows artifacts list [--run=<runId>]
 *   myndhyve-cli workflows artifacts get <artifact-id>
 *   myndhyve-cli workflows approve <run-id>
 *   myndhyve-cli workflows reject <run-id>
 *   myndhyve-cli workflows revise <run-id>
 */

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import {
  listWorkflows,
  getWorkflow,
  listRuns,
  getRun,
  createRun,
  getRunLogs,
  approveRun,
  rejectRun,
  reviseRun,
  listArtifacts,
  getArtifact,
  type WorkflowRunStatus,
} from '../api/workflows.js';
import { getActiveContext } from '../context.js';
import {
  requireAuth,
  truncate,
  formatRelativeTime,
  printError,
} from './helpers.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_RUN_STATUSES: WorkflowRunStatus[] = [
  'pending', 'running', 'paused', 'waiting-approval',
  'completed', 'failed', 'cancelled', 'timed-out',
];

// ============================================================================
// REGISTER
// ============================================================================

export function registerWorkflowCommands(program: Command): void {
  const workflows = program
    .command('workflows')
    .description('Manage and run hyve workflows');

  registerListCommand(workflows);
  registerInfoCommand(workflows);
  registerRunCommand(workflows);
  registerRunsCommand(workflows);
  registerStatusCommand(workflows);
  registerLogsCommand(workflows);
  registerArtifactCommands(workflows);
  registerApprovalCommands(workflows);
}

// ============================================================================
// LIST WORKFLOWS
// ============================================================================

function registerListCommand(workflows: Command): void {
  workflows
    .command('list')
    .description('List available workflows for a hyve')
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const results = await listWorkflows(hyveId);

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log(`\n  No workflows found for hyve "${hyveId}".`);
          console.log('  Workflows are configured in the web app.\n');
          return;
        }

        console.log(`\n  Workflows for "${hyveId}" (${results.length})\n`);
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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (workflowId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const workflow = await getWorkflow(hyveId, workflowId);

        if (!workflow) {
          console.error(`\n  Error: Workflow "${workflowId}" not found in hyve "${hyveId}".\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(workflow, null, 2));
          return;
        }

        console.log(`\n  ${workflow.name}`);
        console.log('  ' + '\u2500'.repeat(60));
        console.log(`  ID:          ${workflow.id}`);
        console.log(`  Hyve:        ${workflow.hyveId}`);
        console.log(`  Version:     ${workflow.version}`);
        console.log(`  Status:      ${workflow.enabled ? 'enabled' : 'disabled'}`);

        if (workflow.description) {
          console.log(`  Description: ${workflow.description}`);
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
        console.log(`  Run this workflow: myndhyve-cli workflows run ${workflow.id} --hyve=${workflow.hyveId}`);
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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--input <json>', 'Input data as JSON string')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (workflowId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      // Parse and validate input data if provided
      let inputData: Record<string, unknown> | undefined;
      if (opts.input) {
        try {
          const parsed = JSON.parse(opts.input);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            console.error('\n  Error: --input must be a JSON object, not a string, array, or primitive.');
            console.error('  Example: --input \'{"topic":"AI chatbots"}\'\n');
            process.exitCode = 1;
            return;
          }
          inputData = parsed;
        } catch {
          console.error('\n  Error: Invalid JSON for --input flag.');
          console.error('  Example: --input \'{"topic":"AI chatbots"}\'\n');
          process.exitCode = 1;
          return;
        }
      }

      try {
        // Verify workflow exists
        const workflow = await getWorkflow(hyveId, workflowId);
        if (!workflow) {
          console.error(`\n  Error: Workflow "${workflowId}" not found in hyve "${hyveId}".\n`);
          process.exitCode = 1;
          return;
        }

        if (!workflow.enabled) {
          console.error(`\n  Error: Workflow "${workflowId}" is disabled.\n`);
          process.exitCode = 1;
          return;
        }

        const run = await createRun(auth.uid, hyveId, workflowId, {
          inputData,
          triggerType: 'manual',
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(run, null, 2));
          return;
        }

        console.log('\n  Workflow run created.');
        console.log(`  Run ID:     ${run.id}`);
        console.log(`  Workflow:   ${workflow.name}`);
        console.log(`  Status:     ${run.status}`);
        console.log('');
        console.log(`  Check status: myndhyve-cli workflows status ${run.id} --hyve=${hyveId}`);
        console.log(`  View logs:    myndhyve-cli workflows logs ${run.id} --hyve=${hyveId}`);
        console.log('');
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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const run = await getRun(auth.uid, hyveId, runId);

        if (!run) {
          console.error(`\n  Error: Run "${runId}" not found.\n`);
          process.exitCode = 1;
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
          console.log(`  Error:      ${run.error}`);
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
          console.log(`  Approve: myndhyve-cli workflows approve ${run.id} --hyve=${hyveId}`);
          console.log(`  Reject:  myndhyve-cli workflows reject ${run.id} --hyve=${hyveId}`);
          console.log(`  Revise:  myndhyve-cli workflows revise ${run.id} --feedback="..." --hyve=${hyveId}`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to get run status', error);
      }
    });
}

// ============================================================================
// LOGS
// ============================================================================

function registerLogsCommand(workflows: Command): void {
  workflows
    .command('logs <run-id>')
    .description('View workflow run execution logs')
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--limit <n>', 'Max log entries to show', '100')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const logs = await getRunLogs(auth.uid, hyveId, runId);

        if (logs === null) {
          console.error(`\n  Error: Run "${runId}" not found.\n`);
          process.exitCode = 1;
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
    .description('List artifacts from workflow runs')
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--run <runId>', 'Filter by run ID')
    .option('--limit <n>', 'Max artifacts to show', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const results = await listArtifacts(auth.uid, hyveId, {
          runId: opts.run,
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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--output <path>', 'Write to file instead of stdout')
    .option('--format <format>', 'Output format (json, raw)', 'json')
    .action(async (artifactId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const artifact = await getArtifact(auth.uid, hyveId, artifactId);

        if (!artifact) {
          console.error(`\n  Error: Artifact "${artifactId}" not found.\n`);
          process.exitCode = 1;
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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--feedback <text>', 'Optional feedback message')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const result = await approveRun(auth.uid, hyveId, runId, opts.feedback);

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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--reason <text>', 'Rejection reason')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const result = await rejectRun(auth.uid, hyveId, runId, opts.reason);

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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .requiredOption('--feedback <text>', 'Revision feedback (required)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      try {
        const result = await reviseRun(auth.uid, hyveId, runId, opts.feedback);

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
    .option('--hyve <hyveId>', 'Hyve ID (defaults to active project\'s hyve)')
    .option('--status <status>', 'Filter by status')
    .option('--workflow <workflowId>', 'Filter by workflow ID')
    .option('--limit <n>', 'Max runs to show', '25')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const hyveId = resolveHyveId(opts.hyve);
      if (!hyveId) return;

      if (opts.status && !validateRunStatus(opts.status)) return;

      const limit = parseLimit(opts.limit);
      if (limit === null) return;

      try {
        const results = await listRuns(auth.uid, hyveId, {
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
 * Resolve the hyve ID from --hyve flag or active project context.
 * Prints an error and sets exitCode if no hyve ID is available.
 */
function resolveHyveId(flagValue?: string): string | null {
  if (flagValue) return flagValue;

  const ctx = getActiveContext();
  if (ctx?.hyveId) return ctx.hyveId;

  console.error('\n  Error: No hyve ID specified.');
  console.error('  Use --hyve=<hyveId> or set an active project with `myndhyve-cli use <project-id>`.\n');
  process.exitCode = 1;
  return null;
}

/**
 * Validate a --status flag value against known run statuses.
 */
function validateRunStatus(status: string): boolean {
  if (!VALID_RUN_STATUSES.includes(status as WorkflowRunStatus)) {
    console.error(`\n  Error: Unknown run status "${status}".`);
    console.error(`  Valid statuses: ${VALID_RUN_STATUSES.join(', ')}\n`);
    process.exitCode = 1;
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
    'running': '\u25cf running',
    'paused': '\u25a0 paused',
    'waiting-approval': '\u2691 approval',
    'completed': '\u2713 completed',
    'failed': '\u2717 failed',
    'cancelled': '\u2014 cancelled',
    'timed-out': '\u29d6 timed-out',
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
  if (isNaN(n) || n <= 0) {
    console.error(`\n  Error: ${flagName} must be a positive integer, got "${value}".\n`);
    process.exitCode = 1;
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
