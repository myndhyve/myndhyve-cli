/**
 * MyndHyve CLI — Canvas Session Commands
 *
 * Commander subcommand group for canvas session management:
 *   myndhyve-cli canvas session create
 *   myndhyve-cli canvas session use <session-key>
 *   myndhyve-cli canvas session history [--session=<session-key>]
 *   myndhyve-cli canvas session reset [--session=<session-key>]
 *   myndhyve-cli canvas queue get [--session=<session-key>]
 *   myndhyve-cli canvas queue set <mode> [--session=<session-key>]
 *   myndhyve-cli canvas agent send <message> [--session=<session-key>]
 *   myndhyve-cli canvas agent steer <message> [--session=<session-key>]
 *   myndhyve-cli canvas agent cancel [--session=<session-key>]
 *   myndhyve-cli canvas run status <run-id>
 *   myndhyve-cli canvas run logs <run-id>
 *   myndhyve-cli canvas run trace <run-id>
 *   myndhyve-cli canvas heartbeat set [--canvas=<canvas-id>] [--every=<minutes>]
 *   myndhyve-cli canvas cron add <schedule> <prompt> [--canvas=<canvas-id>]
 */

import type { Command } from 'commander';
import { MyndHyveClient } from '../api/client.js';
import { CanvasApiClient } from '../api/canvas.js';
import { getActiveContext } from '../context.js';
import { requireAuth, printError } from './helpers.js';
import { ExitCode, printErrorResult, printSuccess, printResult } from '../utils/output.js';

// ============================================================================
// HELPERS
// ============================================================================

function getCanvasClient(): CanvasApiClient {
  const client = new MyndHyveClient({
    baseUrl: process.env.MYNDHYVE_API_BASE_URL || 'https://us-central1-myndhyve.cloudfunctions.net',
  });
  return new CanvasApiClient(client);
}

function getCurrentSessionKey(): string | null {
  const context = getActiveContext();
  if (context?.sessionKey) {
    return context.sessionKey;
  }
  if (context?.projectId && context?.canvasId) {
    return `default/${context.projectId}/${context.canvasId}/cli/main`;
  }
  return null;
}

// ============================================================================
// SESSION COMMANDS
// ============================================================================

async function createCanvasSession(opts: {
  tenant?: string;
  project?: string;
  canvas?: string;
  type?: string;
  surface?: string;
  scope?: string;
  title?: string;
  agent?: string;
  queueMode?: string;
}): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const context = getActiveContext();
  if (!context?.projectId) {
    printErrorResult({
      code: 'NO_PROJECT',
      message: 'No active project. Use: myndhyve-cli use <project-id>',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  const canvasId = opts.canvas || context.canvasId;
  if (!canvasId) {
    printErrorResult({
      code: 'MISSING_CANVAS',
      message: 'Canvas ID required. Use --canvas=<canvas-id> or set active canvas context.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    const result = await client.createSession({
      tenantId: opts.tenant || 'default',
      projectId: opts.project || context.projectId,
      canvasId,
      canvasType: opts.type || 'landing-page',
      surface: opts.surface || 'cli',
      sessionScope: opts.scope || 'main',
      title: opts.title,
      primaryAgentId: opts.agent,
      queueMode: opts.queueMode || 'followup',
    });

    printResult(result, () => {
      printSuccess('Canvas session created');
      console.log(`  Session key: ${result.sessionKey}`);
      console.log(`  Session ID:  ${result.sessionId}`);
      console.log(`  Canvas type: ${result.canvasMetadata.canvasType}`);
      console.log(`  Queue mode:  ${result.canvasMetadata.executionState.queueMode}`);
    });
  } catch (error) {
    printError('Create canvas session', error);
  }
}

async function useCanvasSession(sessionKey: string): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  try {
    const client = getCanvasClient();
    const result = await client.getSession(sessionKey);

    printResult(result, () => {
      printSuccess('Canvas session activated');
      console.log(`  Session key: ${sessionKey}`);
      console.log(`  Canvas ID:   ${result.canvasMetadata.canvasId}`);
      console.log(`  Canvas type: ${result.canvasMetadata.canvasType}`);
      console.log(`  Queue mode:  ${result.canvasMetadata.executionState.queueMode}`);
      console.log(`  Active:      ${result.runtimeState.isActive}`);
    });
  } catch (error) {
    printError('Activate canvas session', error);
  }
}

async function showSessionHistory(opts: { session?: string; limit?: string; offset?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    const result = await client.getSessionHistory(targetSessionKey, {
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      offset: opts.offset ? parseInt(opts.offset, 10) : undefined,
    });

    printResult(result, () => {
      console.log(`\n  Session History: ${targetSessionKey}`);
      console.log(`  Total messages: ${result.total}`);
      console.log(`  Showing ${result.messages.length} messages (offset ${result.offset})\n`);

      if (result.messages.length === 0) {
        console.log('  No messages found.');
        return;
      }

      result.messages.forEach((msg, index) => {
        const timestamp = new Date(msg.timestamp).toLocaleString();
        const roleIcon = msg.role === 'user' ? 'U' : msg.role === 'assistant' ? 'A' : 'S';
        const statusIcon = msg.status === 'complete' ? '+' : msg.status === 'error' ? 'x' : '~';
        console.log(`  [${statusIcon}] ${roleIcon} [${result.offset + index + 1}] ${timestamp}`);
        console.log(`      ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`);
      });
    });
  } catch (error) {
    printError('Get session history', error);
  }
}

async function resetCanvasSession(opts: { session?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    const result = await client.resetSession(targetSessionKey);

    printResult(result, () => {
      printSuccess(`Canvas session reset: ${targetSessionKey}`);
      console.log(`  New session ID: ${result.sessionId}`);
    });
  } catch (error) {
    printError('Reset canvas session', error);
  }
}

// ============================================================================
// QUEUE COMMANDS
// ============================================================================

async function getQueueStatus(opts: { session?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    const status = await client.getQueueStatus(targetSessionKey);

    printResult(status, () => {
      console.log(`\n  Queue Status: ${targetSessionKey}`);
      console.log(`  Queue Mode:   ${status.queueMode}`);
      console.log(`  Is Locked:    ${status.isLocked ? 'Yes' : 'No'}`);
      if (status.lockHolder) {
        console.log(`  Lock Holder:  ${status.lockHolder}`);
      }
      console.log(`  Queued Events: ${status.queuedEvents.length}\n`);

      if (status.queuedEvents.length > 0) {
        console.log('  Queued Events:');
        status.queuedEvents.forEach((event, index) => {
          const timestamp = new Date(event.queuedAt).toLocaleString();
          console.log(`    ${index + 1}. ${event.type} (${event.priority}) - ${event.source} - ${timestamp}`);
        });
      } else {
        console.log('  No queued events.');
      }
    });
  } catch (error) {
    printError('Get queue status', error);
  }
}

async function setQueueMode(mode: string, opts: { session?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const validModes = ['collect', 'followup', 'steer', 'interrupt'];
  if (!validModes.includes(mode)) {
    printErrorResult({
      code: 'INVALID_MODE',
      message: `Invalid queue mode. Must be one of: ${validModes.join(', ')}`,
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    const result = await client.setQueueMode(targetSessionKey, mode);

    printResult(result, () => {
      printSuccess(`Queue mode set to '${mode}' for ${targetSessionKey}`);
    });
  } catch (error) {
    printError('Set queue mode', error);
  }
}

// ============================================================================
// AGENT COMMANDS
// ============================================================================

async function sendAgentMessage(message: string, opts: { session?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    await client.sendAgentMessage(targetSessionKey, message);

    printSuccess(`Message sent to canvas agent in session ${targetSessionKey}`);
  } catch (error) {
    printError('Send agent message', error);
  }
}

async function steerAgent(message: string, opts: { session?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    await client.steerAgent(targetSessionKey, message);

    printSuccess(`Steering sent to active run in session ${targetSessionKey}`);
  } catch (error) {
    printError('Steer agent', error);
  }
}

async function cancelAgentRun(opts: { session?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const targetSessionKey = opts.session || getCurrentSessionKey();
  if (!targetSessionKey) {
    printErrorResult({
      code: 'NO_SESSION',
      message: 'No session specified. Use --session=<session-key> or activate a session first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    await client.cancelAgentRun(targetSessionKey);

    printSuccess(`Agent run cancelled in session ${targetSessionKey}`);
  } catch (error) {
    printError('Cancel agent run', error);
  }
}

// ============================================================================
// RUN COMMANDS
// ============================================================================

async function getRunStatus(runId: string): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  try {
    const client = getCanvasClient();
    const result = await client.getRunStatus(runId);
    printResult(result, () => {
      console.log(`  Run status for: ${runId}`);
      console.log(JSON.stringify(result, null, 2));
    });
  } catch (error) {
    printError('Get run status', error);
  }
}

async function getRunLogs(runId: string): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  try {
    const client = getCanvasClient();
    const result = await client.getRunLogs(runId);
    printResult(result, () => {
      console.log(`  Run logs for: ${runId}`);
      console.log(JSON.stringify(result, null, 2));
    });
  } catch (error) {
    printError('Get run logs', error);
  }
}

async function getRunTrace(runId: string): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  try {
    const client = getCanvasClient();
    const result = await client.getRunTrace(runId);
    printResult(result, () => {
      console.log(`  Run trace for: ${runId}`);
      console.log(JSON.stringify(result, null, 2));
    });
  } catch (error) {
    printError('Get run trace', error);
  }
}

// ============================================================================
// SCHEDULING COMMANDS
// ============================================================================

async function setHeartbeat(opts: { canvas?: string; every?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const context = getActiveContext();
  const canvasId = opts.canvas || context?.canvasId;

  if (!canvasId) {
    printErrorResult({
      code: 'MISSING_CANVAS',
      message: 'Canvas ID required. Use --canvas=<canvas-id> or set active canvas context.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  const interval = opts.every ? parseInt(opts.every, 10) : 30;

  try {
    const client = getCanvasClient();
    await client.setHeartbeat(canvasId, interval);
    printSuccess(`Heartbeat set for canvas ${canvasId} every ${interval} minutes`);
  } catch (error) {
    printError('Set heartbeat', error);
  }
}

async function addCronSchedule(schedule: string, prompt: string, opts: { canvas?: string }): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;

  const context = getActiveContext();
  const canvasId = opts.canvas || context?.canvasId;

  if (!canvasId) {
    printErrorResult({
      code: 'MISSING_CANVAS',
      message: 'Canvas ID required. Use --canvas=<canvas-id> or set active canvas context.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const client = getCanvasClient();
    await client.addCronSchedule(canvasId, schedule, prompt);
    printSuccess(`Cron schedule added for canvas ${canvasId}: ${schedule}`);
  } catch (error) {
    printError('Add cron schedule', error);
  }
}

// ============================================================================
// REGISTER COMMANDS
// ============================================================================

export function registerCanvasCommands(program: Command): void {
  const canvas = program
    .command('canvas')
    .description('Canvas runtime management');

  // ── Session Subcommand Group ─────────────────────────────────────────────

  const session = canvas
    .command('session')
    .description('Canvas session management');

  session
    .command('create')
    .description('Create a new canvas session')
    .option('--tenant <tenant>', 'Tenant ID', 'default')
    .option('--project <project>', 'Project ID')
    .option('--canvas <canvas>', 'Canvas ID')
    .option('--type <type>', 'Canvas type', 'landing-page')
    .option('--surface <surface>', 'Surface type', 'cli')
    .option('--scope <scope>', 'Session scope', 'main')
    .option('--title <title>', 'Session title')
    .option('--agent <agent>', 'Primary agent ID')
    .option('--queue-mode <mode>', 'Queue mode (collect, followup, steer, interrupt)', 'followup')
    .action(async (opts) => { await createCanvasSession(opts); });

  session
    .command('use <session-key>')
    .description('Activate a canvas session')
    .action(async (sessionKey) => { await useCanvasSession(sessionKey); });

  session
    .command('history')
    .description('Show session message history')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .option('--limit <limit>', 'Number of messages to show', '50')
    .option('--offset <offset>', 'Message offset', '0')
    .action(async (opts) => { await showSessionHistory(opts); });

  session
    .command('reset')
    .description('Reset a canvas session')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action(async (opts) => { await resetCanvasSession(opts); });

  // ── Queue Subcommand Group ───────────────────────────────────────────────

  const queue = canvas
    .command('queue')
    .description('Canvas queue management');

  queue
    .command('get')
    .description('Get queue status')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action(async (opts) => { await getQueueStatus(opts); });

  queue
    .command('set <mode>')
    .description('Set queue mode (collect, followup, steer, interrupt)')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action(async (mode, opts) => { await setQueueMode(mode, opts); });

  // ── Agent Subcommand Group ───────────────────────────────────────────────

  const agent = canvas
    .command('agent')
    .description('Canvas agent interaction');

  agent
    .command('send <message>')
    .description('Send message to canvas agent')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action(async (message, opts) => { await sendAgentMessage(message, opts); });

  agent
    .command('steer <message>')
    .description('Steer active canvas agent run')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action(async (message, opts) => { await steerAgent(message, opts); });

  agent
    .command('cancel')
    .description('Cancel active canvas agent run')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action(async (opts) => { await cancelAgentRun(opts); });

  // ── Run Subcommand Group ─────────────────────────────────────────────────

  const run = canvas
    .command('run')
    .description('Canvas run management');

  run
    .command('status <run-id>')
    .description('Get run status')
    .action(async (runId) => { await getRunStatus(runId); });

  run
    .command('logs <run-id>')
    .description('Get run logs')
    .action(async (runId) => { await getRunLogs(runId); });

  run
    .command('trace <run-id>')
    .description('Get run execution trace')
    .action(async (runId) => { await getRunTrace(runId); });

  // ── Scheduling Subcommand Group ───────────────────────────────────────────

  const scheduling = canvas
    .command('heartbeat')
    .description('Canvas heartbeat scheduling');

  scheduling
    .command('set')
    .description('Set heartbeat interval for canvas')
    .option('--canvas <canvas>', 'Canvas ID')
    .option('--every <minutes>', 'Heartbeat interval in minutes', '30')
    .action(async (opts) => { await setHeartbeat(opts); });

  const cron = canvas
    .command('cron')
    .description('Canvas cron scheduling');

  cron
    .command('add <schedule> <prompt>')
    .description('Add cron schedule for canvas')
    .option('--canvas <canvas>', 'Canvas ID')
    .action(async (schedule, prompt, opts) => { await addCronSchedule(schedule, prompt, opts); });
}
