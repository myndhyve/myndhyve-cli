/**
 * MyndHyve CLI — wire-format types for workflow definitions + runs.
 *
 * Scope: types the CLI sends and receives across the canvas-runtime
 * REST/MCP/A2A surface. These describe the SHAPE of payloads at the
 * network boundary — NOT engine internals.
 *
 * Why these live in the CLI repo (not @myndhyve/wop):
 *
 *   These types are MyndHyve-engine-specific extensions. The WOP spec
 *   defines a narrower vocabulary (8-status RunStatus, generic
 *   ErrorEnvelope) suitable for ANY conformant host. The MyndHyve
 *   engine emits a wider union (12 statuses, structured workflow
 *   definitions with triggers + canvasTypeId, etc.). Pulling these
 *   into @myndhyve/wop would tie the open-protocol SDK to one
 *   implementation — exactly what the spec/host split is meant to
 *   prevent.
 *
 *   A future "myndhyve-engine wire-format" package (separate from
 *   @myndhyve/wop) could host these for cross-repo sharing. Until
 *   that need arises (e.g., a second consumer beyond the CLI),
 *   inlining here is the right scope.
 *
 * Imports from @myndhyve/wop are the protocol-level helpers — see
 * `isTerminalRunStatus`, `RUN_ERROR_CODES`, etc. — and are NOT
 * duplicated here.
 *
 * @module myndhyve-cli/types/wire-format
 */

// ─── Workflow run statuses (wider than WOP spec) ────────────────────────────

/**
 * Run status union — MyndHyve engine emission set. Strictly wider than
 * `@myndhyve/wop`'s `RunStatus` (which models the 8 spec-narrow values).
 *
 * The extra members (`planned`, `executing`, `waiting-external`,
 * `timed-out`, `interrupted`) are engine-specific states that hosts MAY
 * emit per the `run-snapshot.schema.json` forward-compat clause:
 * *"future statuses MAY be added; readers SHOULD treat unknown values
 * as terminal-unknown rather than throw"*. The CLI uses this wider
 * union for typed display + validation; for terminal-checking, prefer
 * `isTerminalRunStatus` from `@myndhyve/wop` which is forward-compat
 * tolerant.
 */
export type WorkflowRunStatus =
  | 'pending'
  | 'planned'
  | 'running'
  | 'executing'
  | 'paused'
  | 'waiting-approval'
  | 'waiting-external'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'interrupted';

export const ALL_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
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
] as const;

// ─── Workflow trigger types ─────────────────────────────────────────────────

/**
 * Workflow trigger types — engine-emission identifiers. WOP doesn't yet
 * model triggers in the spec; these are MyndHyve-specific.
 */
export type WorkflowTriggerType =
  | 'manual'
  | 'schedule'
  | 'webhook'
  | 'event'
  | 'artifact'
  | 'canvas'
  | 'envelope'
  | 'command'
  | 'chat-message';

export const ALL_TRIGGER_TYPES: readonly WorkflowTriggerType[] = [
  'manual',
  'schedule',
  'webhook',
  'event',
  'artifact',
  'canvas',
  'envelope',
  'command',
  'chat-message',
] as const;

// ─── Workflow definition wire format ────────────────────────────────────────

/** Lightweight workflow summary for list display. */
export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  version: number;
  nodeCount: number;
  triggerTypes: string[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Node definition within a workflow (wire format). */
export interface WorkflowNodeSummary {
  id: string;
  type: string;
  label: string;
  description?: string;
  requiresApproval: boolean;
}

/** Edge between nodes (wire format). */
export interface WorkflowEdgeSummary {
  source: string;
  target: string;
  label?: string;
}

/** Full workflow detail with nodes, edges, triggers. */
export interface WorkflowDetail extends WorkflowSummary {
  canvasTypeId: string;
  nodes: WorkflowNodeSummary[];
  edges: WorkflowEdgeSummary[];
  triggers: Array<{ type: WorkflowTriggerType; config?: Record<string, unknown> }>;
  settings: Record<string, unknown>;
}

// ─── Workflow run wire format ───────────────────────────────────────────────

/** Lightweight run summary for list display, including progress and current node. */
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: WorkflowRunStatus;
  triggerType: string;
  currentNodeId?: string;
  currentNodeLabel?: string;
  /** 0-100 progress; computed as completed-nodes / total-nodes. */
  progress: number;
  totalNodes: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

/** Approval information for a `waiting-approval` node (wire format). */
export interface ApprovalInfo {
  requestedAt: string;
  requestedBy?: string;
  decision?: 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  feedback?: string;
}

/** Per-node execution state (wire format). */
export interface NodeRunStateSummary {
  nodeId: string;
  status: string;
  label?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  approval?: ApprovalInfo;
}

/**
 * Full run detail with per-node states, input data, and error info.
 *
 * `error` matches the structured shape `@myndhyve/wop`'s `RunError`
 * exposes — but is kept inline here as the CLI's view of the engine's
 * run-doc field. Use `RunError` from `@myndhyve/wop` when you need
 * the typed `code: RunErrorCode` discriminator for downstream handling.
 */
export interface RunDetail extends RunSummary {
  canvasTypeId: string;
  userId: string;
  inputData?: Record<string, unknown>;
  nodeStates: NodeRunStateSummary[];
  error?: { code: string; message: string; nodeId?: string };
  /**
   * Engine version that wrote this run document. Tier 0.1 lands this
   * field on persisted runs so a hosting process can refuse to resume
   * runs from a future engine version. `undefined` on legacy runs
   * persisted before the field shipped — treat as "compatible with
   * any engine version".
   */
  engineVersion?: number;
}
