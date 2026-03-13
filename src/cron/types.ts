/**
 * MyndHyve CLI — Cron Scheduler Types
 *
 * Type definitions for the local cron scheduler:
 * job definitions, schedule types, action types, delivery config,
 * and run history records.
 */

// ============================================================================
// SCHEDULE TYPES
// ============================================================================

/** One-shot, interval, or cron-expression schedule. */
export interface JobSchedule {
  kind: 'at' | 'every' | 'cron';

  /** ISO 8601 timestamp for one-shot ('at') jobs. */
  at?: string;

  /** Milliseconds between runs for interval ('every') jobs. */
  everyMs?: number;

  /** 5 or 6-field cron expression for recurring ('cron') jobs. */
  expr?: string;

  /** IANA timezone (e.g., 'America/New_York'). Defaults to system timezone. */
  tz?: string;

  /** Jitter window in ms for load spreading on top-of-hour cron expressions. */
  staggerMs?: number;
}

// ============================================================================
// ACTION TYPES
// ============================================================================

/** Trigger a workflow run via the API. */
export interface WorkflowAction {
  type: 'workflow';
  workflowId: string;
  canvasTypeId: string;
  input?: Record<string, unknown>;
}

/** Run an agent turn via the AI chat API. */
export interface AgentAction {
  type: 'agent';
  agentId: string;
  message: string;
  model?: string;
}

/** Sync CRM data from Firestore. */
export interface CrmSyncAction {
  type: 'crm-sync';
  collections?: string[];
}

/** Execute a shell command locally (opt-in only). */
export interface ShellAction {
  type: 'shell';
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

/** Make an HTTP request. */
export interface HttpAction {
  type: 'http';
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/** All supported job action types. */
export type JobAction =
  | WorkflowAction
  | AgentAction
  | CrmSyncAction
  | ShellAction
  | HttpAction;

// ============================================================================
// DELIVERY TYPES
// ============================================================================

/** How to route job output after execution. */
export interface JobDelivery {
  /** Delivery mode: relay to messaging channel, POST to webhook, or silent. */
  mode: 'relay' | 'webhook' | 'none';

  /** Messaging channel for 'relay' mode. */
  channel?: 'whatsapp' | 'signal' | 'imessage';

  /** Recipient for 'relay' mode (phone number, group ID, etc.). */
  to?: string;

  /** Webhook URL for 'webhook' mode. */
  webhookUrl?: string;
}

// ============================================================================
// JOB DEFINITION
// ============================================================================

/** A scheduled cron job stored in jobs.json. */
export interface CronJob {
  jobId: string;
  name: string;
  description?: string;
  enabled: boolean;

  schedule: JobSchedule;
  action: JobAction;
  delivery?: JobDelivery;

  /** Auto-remove one-shot jobs after successful execution. */
  deleteAfterRun?: boolean;

  // Lifecycle tracking
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failed' | 'skipped';
  nextRunAt?: string;
  consecutiveFailures: number;
}

// ============================================================================
// RUN HISTORY
// ============================================================================

/** A single execution record stored in runs/<jobId>.jsonl. */
export interface RunRecord {
  runId: string;
  jobId: string;
  jobName: string;
  status: 'started' | 'success' | 'failed' | 'skipped';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;

  /** Action type that was executed. */
  actionType: JobAction['type'];

  /** Truncated output or result summary. */
  result?: string;

  /** Error details if status is 'failed'. */
  error?: {
    code: string;
    message: string;
  };

  /** Delivery result if delivery was attempted. */
  deliveryResult?: {
    mode: string;
    success: boolean;
    error?: string;
  };
}

// ============================================================================
// SCHEDULER CONFIG
// ============================================================================

/** Gateway-level scheduler configuration. */
export interface SchedulerConfig {
  /** Enable/disable the scheduler. */
  enabled: boolean;

  /** Maximum concurrent job executions. */
  maxConcurrentRuns: number;

  /** Allow shell actions (requires --allow-shell on cron start). */
  allowShell: boolean;

  /** Retry policy for failed jobs. */
  retry: {
    maxAttempts: number;
    backoffMs: number[];
    retryOn: string[];
  };

  /** Run log maintenance. */
  runLog: {
    maxBytes: number;
    keepLines: number;
  };
}

/** Default scheduler configuration. */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  maxConcurrentRuns: 1,
  allowShell: false,
  retry: {
    maxAttempts: 3,
    backoffMs: [30_000, 60_000, 300_000],
    retryOn: ['rate_limit', 'network', 'server_error'],
  },
  runLog: {
    maxBytes: 2_000_000,
    keepLines: 2000,
  },
};
