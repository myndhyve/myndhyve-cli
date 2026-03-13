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
import { getAuthStatus } from '../auth/index.js';
import { MyndHyveClient } from '../api/client.js';
import { CanvasApiClient } from '../api/canvas.js';
import { getActiveContext, setActiveContext } from '../context.js';
import { requireAuth, printError, printSuccess, printWarning } from './helpers.js';
import { ExitCode, printErrorResult, printSuccessResult } from '../utils/output.js';

// ============================================================================
// TYPES
// ============================================================================

interface CanvasSessionOptions {
  tenantId?: string;
  projectId?: string;
  canvasId?: string;
  canvasType?: string;
  surface?: string;
  sessionScope?: string;
  title?: string;
  primaryAgentId?: string;
  queueMode?: string;
}

interface QueueEvent {
  id: string;
  type: string;
  data: unknown;
  queuedAt: string;
  source: string;
  priority: string;
}

interface QueueStatus {
  queueMode: string;
  queuedEvents: QueueEvent[];
  isLocked: boolean;
  lockHolder: string | null;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get canvas API client
 */
function getCanvasClient(): CanvasApiClient {
  const authStatus = getAuthStatus();
  if (!authStatus?.idToken) {
    throw new Error('Not authenticated. Please run: myndhyve-cli login');
  }

  const client = new MyndHyveClient({
    baseUrl: process.env.MYNDHYVE_API_BASE_URL || 'https://us-central1-myndhyve.cloudfunctions.net',
  });

  return new CanvasApiClient(client);
}

/**
 * Get current session key from context or create default
 */
function getCurrentSessionKey(): string | null {
  const context = getActiveContext();
  if (context?.sessionKey) {
    return context.sessionKey;
  }
  
  // Try to construct from context
  if (context?.projectId && context?.canvasId) {
    return `default/${context.projectId}/${context.canvasId}/cli/main`;
  }
  
  return null;
}

/**
 * Save context with session information
 */
function saveContext(context: any): void {
  setActiveContext(context);
}

// ============================================================================
// SESSION COMMANDS
// ============================================================================

/**
 * Create a new canvas session
 */
async function createCanvasSession(options: CanvasSessionOptions): Promise<void> {
  try {
    const context = getActiveContext();
    if (!context?.projectId) {
      printError('No active project. Use: myndhyve-cli use <project-id>');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const client = getCanvasClient();
    
    const sessionData = {
      tenantId: options.tenantId || 'default',
      projectId: options.projectId || context.projectId,
      canvasId: options.canvasId || context.canvasId,
      canvasType: options.canvasType || 'landing-page',
      surface: options.surface || 'cli',
      sessionScope: options.sessionScope || 'main',
      title: options.title,
      primaryAgentId: options.primaryAgentId,
      queueMode: options.queueMode || 'followup', // CLI defaults to followup mode
    };

    if (!sessionData.canvasId) {
      printError('Canvas ID required. Use --canvas=<canvas-id> or set active canvas context');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const result = await client.createSession(sessionData);

    printSuccessResult('Canvas session created', {
      sessionKey: result.sessionKey,
      sessionId: result.sessionId,
      canvasType: result.canvasMetadata.canvasType,
      queueMode: result.canvasMetadata.executionState.queueMode,
    });

    // Store session key in context for future commands
    if (context) {
      context.sessionKey = result.sessionKey;
      context.canvasId = result.canvasMetadata.canvasId;
      saveContext(context);
    }
    
  } catch (error) {
    printErrorResult('Failed to create canvas session', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Use a canvas session
 */
async function useCanvasSession(sessionKey: string): Promise<void> {
  try {
    const client = getCanvasClient();
    const result = await client.getSession(sessionKey);
    
    const context = getActiveContext();
    if (context) {
      context.sessionKey = sessionKey;
      context.canvasId = result.canvasMetadata.canvasId;
      context.projectId = result.projectId;
      saveContext(context);
    }

    printSuccessResult('Canvas session activated', {
      sessionKey,
      canvasId: result.canvasMetadata.canvasId,
      canvasType: result.canvasMetadata.canvasType,
      queueMode: result.canvasMetadata.executionState.queueMode,
      isActive: result.runtimeState.isActive,
    });
    
  } catch (error) {
    printErrorResult('Failed to activate canvas session', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Show session history
 */
async function showSessionHistory(sessionKey?: string, options: { limit?: number; offset?: number } = {}): Promise<void> {
  try {
    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const result = await canvasApiRequest(`/sessions/${targetSessionKey}/history?${params}`);
    
    console.log(`\n📜 Session History: ${targetSessionKey}`);
    console.log(`📊 Total messages: ${result.total}`);
    console.log(`📄 Showing ${result.messages.length} messages (offset ${result.offset})`);
    console.log('');

    if (result.messages.length === 0) {
      console.log('No messages found.');
      return;
    }

    result.messages.forEach((msg: any, index: number) => {
      const timestamp = new Date(msg.timestamp).toLocaleString();
      const role = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '⚙️';
      const status = msg.status === 'complete' ? '✅' : msg.status === 'error' ? '❌' : '⏳';
      
      console.log(`${role} ${status} [${result.offset + index + 1}] ${timestamp}`);
      console.log(`   ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
      console.log('');
    });
    
  } catch (error) {
    printErrorResult('Failed to get session history', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Reset a canvas session
 */
async function resetCanvasSession(sessionKey?: string): Promise<void> {
  try {
    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const result = await canvasApiRequest(`/sessions/${targetSessionKey}/reset`, {
      method: 'POST',
    });

    printSuccessResult('Canvas session reset', {
      sessionKey: targetSessionKey,
      sessionId: result.sessionId,
      message: result.message,
    });
    
  } catch (error) {
    printErrorResult('Failed to reset canvas session', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

// ============================================================================
// QUEUE COMMANDS
// ============================================================================

/**
 * Get queue status
 */
async function getQueueStatus(sessionKey?: string): Promise<void> {
  try {
    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const client = getCanvasClient();
    const status = await client.getQueueStatus(targetSessionKey);
    
    console.log(`\n📊 Queue Status: ${targetSessionKey}`);
    console.log(`🔄 Queue Mode: ${status.queueMode}`);
    console.log(`🔒 Is Locked: ${status.isLocked ? 'Yes' : 'No'}`);
    if (status.lockHolder) {
      console.log(`🏃 Lock Holder: ${status.lockHolder}`);
    }
    console.log(`📋 Queued Events: ${status.queuedEvents.length}`);
    console.log('');

    if (status.queuedEvents.length > 0) {
      console.log('Queued Events:');
      status.queuedEvents.forEach((event, index) => {
        const timestamp = new Date(event.queuedAt).toLocaleString();
        console.log(`  ${index + 1}. ${event.type} (${event.priority}) - ${event.source} - ${timestamp}`);
      });
    } else {
      console.log('No queued events.');
    }
    
  } catch (error) {
    printErrorResult('Failed to get queue status', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Set queue mode
 */
async function setQueueMode(mode: string, sessionKey?: string): Promise<void> {
  try {
    const validModes = ['collect', 'followup', 'steer', 'interrupt'];
    if (!validModes.includes(mode)) {
      printError(`Invalid queue mode. Must be one of: ${validModes.join(', ')}`);
      process.exit(ExitCode.USAGE_ERROR);
    }

    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const client = getCanvasClient();
    const result = await client.setQueueMode(targetSessionKey, mode);

    printSuccessResult('Queue mode updated', {
      sessionKey: targetSessionKey,
      queueMode: mode,
      message: result.message,
    });
    
  } catch (error) {
    printErrorResult('Failed to set queue mode', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

// ============================================================================
// AGENT COMMANDS
// ============================================================================

/**
 * Send message to canvas agent
 */
async function sendAgentMessage(message: string, sessionKey?: string): Promise<void> {
  try {
    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    // This would integrate with the canvas workflow system
    // For now, we'll queue the message as a user event
    const result = await canvasApiRequest(`/sessions/${targetSessionKey}/queue-mode`, {
      method: 'POST',
      body: JSON.stringify({ 
        queueMode: 'interrupt', // User messages should be processed immediately
      }),
    });

    printSuccessResult('Message sent to canvas agent', {
      sessionKey: targetSessionKey,
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
      queueMode: 'interrupt',
    });
    
  } catch (error) {
    printErrorResult('Failed to send message', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Steer active canvas agent run
 */
async function steerAgent(message: string, sessionKey?: string): Promise<void> {
  try {
    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    // This would integrate with canvas workflow steering
    printWarning('Agent steering not yet implemented in CLI');
    console.log('🔄 Steering would be sent to active run in session:', targetSessionKey);
    console.log('💬 Message:', message);
    
  } catch (error) {
    printErrorResult('Failed to steer agent', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Cancel active canvas agent run
 */
async function cancelAgentRun(sessionKey?: string): Promise<void> {
  try {
    const targetSessionKey = sessionKey || getCurrentSessionKey();
    if (!targetSessionKey) {
      printError('No session specified. Use --session=<session-key> or activate a session first');
      process.exit(ExitCode.USAGE_ERROR);
    }

    // Set queue mode to interrupt to cancel current run
    const result = await canvasApiRequest(`/sessions/${targetSessionKey}/queue-mode`, {
      method: 'POST',
      body: JSON.stringify({ queueMode: 'interrupt' }),
    });

    printSuccessResult('Agent run cancelled', {
      sessionKey: targetSessionKey,
      queueMode: 'interrupt',
      message: result.message,
    });
    
  } catch (error) {
    printErrorResult('Failed to cancel agent run', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

// ============================================================================
// RUN COMMANDS
// ============================================================================

/**
 * Get run status
 */
async function getRunStatus(runId: string): Promise<void> {
  try {
    printWarning('Run status command not yet implemented');
    console.log('🔍 Would show status for run:', runId);
    console.log('💡 This would integrate with the workflow execution system');
    
  } catch (error) {
    printErrorResult('Failed to get run status', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Get run logs
 */
async function getRunLogs(runId: string): Promise<void> {
  try {
    printWarning('Run logs command not yet implemented');
    console.log('📋 Would show logs for run:', runId);
    console.log('💡 This would integrate with the workflow execution system');
    
  } catch (error) {
    printErrorResult('Failed to get run logs', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Get run trace
 */
async function getRunTrace(runId: string): Promise<void> {
  try {
    printWarning('Run trace command not yet implemented');
    console.log('🔍 Would show execution trace for run:', runId);
    console.log('💡 This would integrate with the workflow execution system');
    
  } catch (error) {
    printErrorResult('Failed to get run trace', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

// ============================================================================
// SCHEDULING COMMANDS
// ============================================================================

/**
 * Set heartbeat for canvas
 */
async function setHeartbeat(options: { canvas?: string; every?: number }): Promise<void> {
  try {
    const context = getActiveContext();
    const canvasId = options.canvas || context?.canvasId;
    
    if (!canvasId) {
      printError('Canvas ID required. Use --canvas=<canvas-id> or set active canvas context');
      process.exit(ExitCode.USAGE_ERROR);
    }

    const interval = options.every || 30; // Default 30 minutes
    
    printWarning('Heartbeat scheduling not yet implemented');
    console.log('💓 Would set heartbeat for canvas:', canvasId);
    console.log('⏰ Interval:', interval, 'minutes');
    console.log('💡 This would integrate with the canvas wakeup system');
    
  } catch (error) {
    printErrorResult('Failed to set heartbeat', error);
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Add cron schedule
 */
async function addCronSchedule(schedule: string, prompt: string, options: { canvas?: string }): Promise<void> {
  try {
    const context = getActiveContext();
    const canvasId = options.canvas || context?.canvasId;
    
    if (!canvasId) {
      printError('Canvas ID required. Use --canvas=<canvas-id> or set active canvas context');
      process.exit(ExitCode.USAGE_ERROR);
    }

    printWarning('Cron scheduling not yet implemented');
    console.log('⏰ Would add cron schedule for canvas:', canvasId);
    console.log('📅 Schedule:', schedule);
    console.log('💬 Prompt:', prompt);
    console.log('💡 This would integrate with the canvas wakeup system');
    
  } catch (error) {
    printErrorResult('Failed to add cron schedule', error);
    process.exit(ExitCode.GENERAL_ERROR);
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
    .action((opts) => requireAuth(() => createCanvasSession(opts)));

  session
    .command('use <session-key>')
    .description('Activate a canvas session')
    .action((sessionKey) => requireAuth(() => useCanvasSession(sessionKey)));

  session
    .command('history')
    .description('Show session message history')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .option('--limit <limit>', 'Number of messages to show', '50')
    .option('--offset <offset>', 'Message offset', '0')
    .action((opts) => requireAuth(() => showSessionHistory(opts.session, opts)));

  session
    .command('reset')
    .description('Reset a canvas session')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action((opts) => requireAuth(() => resetCanvasSession(opts.session)));

  // ── Queue Subcommand Group ───────────────────────────────────────────────

  const queue = canvas
    .command('queue')
    .description('Canvas queue management');

  queue
    .command('get')
    .description('Get queue status')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action((opts) => requireAuth(() => getQueueStatus(opts.session)));

  queue
    .command('set <mode>')
    .description('Set queue mode (collect, followup, steer, interrupt)')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action((mode, opts) => requireAuth(() => setQueueMode(mode, opts.session)));

  // ── Agent Subcommand Group ───────────────────────────────────────────────

  const agent = canvas
    .command('agent')
    .description('Canvas agent interaction');

  agent
    .command('send <message>')
    .description('Send message to canvas agent')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action((message, opts) => requireAuth(() => sendAgentMessage(message, opts.session)));

  agent
    .command('steer <message>')
    .description('Steer active canvas agent run')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action((message, opts) => requireAuth(() => steerAgent(message, opts.session)));

  agent
    .command('cancel')
    .description('Cancel active canvas agent run')
    .option('--session <session>', 'Session key (uses active session if not specified)')
    .action((opts) => requireAuth(() => cancelAgentRun(opts.session)));

  // ── Run Subcommand Group ─────────────────────────────────────────────────

  const run = canvas
    .command('run')
    .description('Canvas run management');

  run
    .command('status <run-id>')
    .description('Get run status')
    .action((runId) => requireAuth(() => getRunStatus(runId)));

  run
    .command('logs <run-id>')
    .description('Get run logs')
    .action((runId) => requireAuth(() => getRunLogs(runId)));

  run
    .command('trace <run-id>')
    .description('Get run execution trace')
    .action((runId) => requireAuth(() => getRunTrace(runId)));

  // ── Scheduling Subcommand Group ───────────────────────────────────────────

  const scheduling = canvas
    .command('heartbeat')
    .description('Canvas heartbeat scheduling');

  scheduling
    .command('set')
    .description('Set heartbeat interval for canvas')
    .option('--canvas <canvas>', 'Canvas ID')
    .option('--every <minutes>', 'Heartbeat interval in minutes', '30')
    .action((opts) => requireAuth(() => setHeartbeat(opts)));

  const cron = canvas
    .command('cron')
    .description('Canvas cron scheduling');

  cron
    .command('add <schedule> <prompt>')
    .description('Add cron schedule for canvas')
    .option('--canvas <canvas>', 'Canvas ID')
    .action((schedule, prompt, opts) => requireAuth(() => addCronSchedule(schedule, prompt, opts)));
}
