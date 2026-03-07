/**
 * MyndHyve CLI — Cron Action Executor
 *
 * Takes a JobAction and executes it, returning a result summary string
 * or throwing on failure. All API imports are dynamic to avoid loading
 * heavy modules at startup.
 */

import { execSync } from 'node:child_process';
import { createLogger } from '../utils/logger.js';
import type {
  JobAction,
  SchedulerConfig,
  WorkflowAction,
  AgentAction,
  CrmSyncAction,
  ShellAction,
  HttpAction,
} from './types.js';

const log = createLogger('CronExecutor');

// ============================================================================
// AUTH HELPER
// ============================================================================

/**
 * Load the authenticated user's UID from stored credentials.
 * Throws if not authenticated.
 */
async function getAuthUserId(): Promise<string> {
  const { loadCredentials } = await import('../auth/credentials.js');
  const credentials = loadCredentials();

  if (!credentials) {
    throw new Error('Not authenticated. Run: myndhyve-cli auth login');
  }

  return credentials.uid;
}

// ============================================================================
// ACTION DISPATCH
// ============================================================================

/**
 * Execute a job action and return a result summary string.
 * Throws on failure.
 */
export async function executeAction(
  action: JobAction,
  config: SchedulerConfig,
): Promise<string> {
  switch (action.type) {
    case 'workflow':
      return executeWorkflow(action);
    case 'agent':
      return executeAgent(action);
    case 'crm-sync':
      return executeCrmSync(action);
    case 'shell':
      return executeShell(action, config);
    case 'http':
      return executeHttp(action);
    default: {
      // Exhaustiveness check — should never reach here if types are correct
      const _exhaustive: never = action;
      throw new Error(`Unknown action type: ${(_exhaustive as JobAction).type}`);
    }
  }
}

// ============================================================================
// EXECUTORS (internal)
// ============================================================================

/**
 * Trigger a workflow run via the API.
 */
async function executeWorkflow(action: WorkflowAction): Promise<string> {
  log.debug('Executing workflow action', {
    workflowId: action.workflowId,
    hyveId: action.hyveId,
  });

  const userId = await getAuthUserId();
  const { createRun } = await import('../api/workflows.js');

  const run = await createRun(userId, action.hyveId, action.workflowId, {
    triggerType: 'schedule',
    inputData: action.input,
  });

  const result = `Workflow run ${run.id} created (status: ${run.status})`;
  log.info('Workflow action completed', { runId: run.id, status: run.status });
  return result;
}

/**
 * Verify an agent exists and log the intent.
 * Full agent execution would require the AI proxy; for now just verify
 * the agent exists and report the requested message.
 */
async function executeAgent(action: AgentAction): Promise<string> {
  log.debug('Executing agent action', { agentId: action.agentId });

  const userId = await getAuthUserId();
  const { getAgent } = await import('../api/agents.js');

  const agent = await getAgent(userId, action.agentId);
  if (!agent) {
    throw new Error(`Agent "${action.agentId}" not found`);
  }

  const result = `Agent turn requested for ${action.agentId}: "${action.message.slice(0, 80)}"`;
  log.info('Agent action completed', { agentId: action.agentId, agentName: agent.name });
  return result;
}

/**
 * Check CRM collection accessibility as a sync/connectivity check.
 * For each specified collection (or all 10 if not specified), issues a
 * lightweight list call with limit 1.
 */
async function executeCrmSync(action: CrmSyncAction): Promise<string> {
  log.debug('Executing CRM sync action', {
    collections: action.collections ?? 'all',
  });

  const userId = await getAuthUserId();
  const { listCrmEntities, CRM_COLLECTIONS } = await import('../api/crm.js');

  const collections = action.collections ?? [...CRM_COLLECTIONS];

  const results = await Promise.allSettled(
    collections.map((col) =>
      listCrmEntities(userId, col as Parameters<typeof listCrmEntities>[1], { limit: 1 }),
    ),
  );

  const accessible = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  if (failed > 0 && accessible === 0) {
    throw new Error(`CRM sync check failed: all ${failed} collections unreachable`);
  }

  const result = `CRM sync check: ${accessible} collections accessible` +
    (failed > 0 ? ` (${failed} failed)` : '');
  log.info('CRM sync action completed', { accessible, failed });
  return result;
}

/**
 * Execute a shell command locally.
 * Requires `config.allowShell` to be true (set via --allow-shell flag).
 */
function executeShell(action: ShellAction, config: SchedulerConfig): string {
  if (!config.allowShell) {
    throw new Error('Shell actions are disabled. Start the scheduler with --allow-shell.');
  }

  log.debug('Executing shell action', {
    command: action.command,
    cwd: action.cwd,
  });

  try {
    const output = execSync(action.command, {
      cwd: action.cwd,
      timeout: action.timeoutMs ?? 30_000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    const trimmed = output.trim();
    const result = trimmed.length > 500 ? trimmed.slice(0, 500) + '...' : trimmed;
    log.info('Shell action completed', { command: action.command });
    return result;
  } catch (error: unknown) {
    const execError = error as { stderr?: string; message?: string };
    const detail = execError.stderr?.trim() || execError.message || 'Unknown shell error';
    throw new Error(`Shell command failed: ${detail}`);
  }
}

/**
 * Make an HTTP request and return the status summary.
 */
async function executeHttp(action: HttpAction): Promise<string> {
  log.debug('Executing HTTP action', {
    method: action.method,
    url: action.url,
  });

  const fetchOptions: RequestInit = {
    method: action.method,
    signal: AbortSignal.timeout(action.timeoutMs ?? 30_000),
  };

  if (action.headers) {
    fetchOptions.headers = action.headers;
  }

  if (action.body && action.method !== 'GET') {
    fetchOptions.body = action.body;
  }

  const response = await fetch(action.url, fetchOptions);

  if (!response.ok) {
    const body = await response.text();
    const truncated = body.length > 200 ? body.slice(0, 200) + '...' : body;
    throw new Error(
      `HTTP ${action.method} ${action.url} failed: ${response.status} ${response.statusText} — ${truncated}`,
    );
  }

  const result = `HTTP ${action.method} ${action.url} → ${response.status} ${response.statusText}`;
  log.info('HTTP action completed', { status: response.status, url: action.url });
  return result;
}
