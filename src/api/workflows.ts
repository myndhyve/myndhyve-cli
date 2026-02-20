/**
 * MyndHyve CLI — Workflow API
 *
 * Operations for workflow management and run execution via Firestore REST API.
 *
 * Firestore collections:
 *   hyves/{hyveId}/workflows/{workflowId}   — Workflow definitions
 *   runs/{runId}                             — Workflow runs (root-level)
 *   runs/{runId}/artifacts/{artifactId}      — Run artifacts (nested under runs)
 */

import { randomBytes } from 'node:crypto';
import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkflowAPI');

// ============================================================================
// WORKFLOW STATUS & TRIGGER TYPES
// ============================================================================

/** All valid workflow run statuses. */
export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** All valid workflow trigger types. */
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

// ============================================================================
// WORKFLOW DEFINITION TYPES
// ============================================================================

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

/** Node definition within a workflow. */
export interface WorkflowNodeSummary {
  id: string;
  type: string;
  label: string;
  description?: string;
  requiresApproval: boolean;
}

/** Full workflow detail with nodes and edges. */
export interface WorkflowDetail extends WorkflowSummary {
  hyveId: string;
  nodes: WorkflowNodeSummary[];
  edges: Array<{ source: string; target: string; label?: string }>;
  triggers: Array<{ type: WorkflowTriggerType; config?: Record<string, unknown> }>;
  settings: Record<string, unknown>;
}

// ============================================================================
// RUN TYPES
// ============================================================================

/** Lightweight run summary for list display, including progress and current node. */
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: WorkflowRunStatus;
  triggerType: string;
  currentNodeId?: string;
  currentNodeLabel?: string;
  progress: number;
  totalNodes: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

/** Execution state of a single node within a workflow run. */
export interface NodeRunState {
  nodeId: string;
  status: string;
  label?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  approval?: ApprovalInfo;
}

/** Approval information for an awaiting_approval node. */
export interface ApprovalInfo {
  requestedAt: string;
  requestedBy?: string;
  decision?: 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  feedback?: string;
}

/** Full run detail with per-node states, input data, and error info. */
export interface RunDetail extends RunSummary {
  hyveId: string;
  userId: string;
  inputData?: Record<string, unknown>;
  nodeStates: NodeRunState[];
  error?: string;
}

/** Single log entry from a workflow run (max 100 entries per run in Firestore). */
export interface RunLogEntry {
  timestamp: string;
  level: string;
  nodeId?: string;
  nodeLabel?: string;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// ARTIFACT TYPES
// ============================================================================

/** Artifact summary from a workflow run (PRDs, plans, generated content). */
export interface ArtifactSummary {
  id: string;
  runId: string;
  workflowId?: string;
  nodeId?: string;
  type: string;
  name: string;
  mimeType?: string;
  size?: number;
  createdAt?: string;
}

/** Full artifact detail including inline content and metadata. */
export interface ArtifactDetail extends ArtifactSummary {
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// WORKFLOW OPERATIONS
// ============================================================================

/**
 * List all workflows for a hyve.
 *
 * Note: Workflows are system-level definitions (not user-scoped). Access is
 * gated by Firestore security rules via the auth token in the REST request.
 *
 * @param hyveId - The system hyve ID (e.g., 'landing-page', 'app-builder')
 * @returns Array of workflow summaries
 */
export async function listWorkflows(
  hyveId: string
): Promise<WorkflowSummary[]> {
  const collectionPath = `hyves/${hyveId}/workflows`;

  log.debug('Listing workflows', { hyveId });

  const { documents } = await listDocuments(collectionPath, { pageSize: 50 });
  return documents.map(toWorkflowSummary);
}

/**
 * Get full workflow details by ID.
 *
 * Note: Workflows are system-level definitions (not user-scoped). Access is
 * gated by Firestore security rules via the auth token in the REST request.
 *
 * @param hyveId - The system hyve ID
 * @param workflowId - The workflow ID
 * @returns Workflow detail or null if not found
 */
export async function getWorkflow(
  hyveId: string,
  workflowId: string
): Promise<WorkflowDetail | null> {
  const collectionPath = `hyves/${hyveId}/workflows`;

  log.debug('Getting workflow', { hyveId, workflowId });

  const doc = await getDocument(collectionPath, workflowId);
  if (!doc) return null;

  return toWorkflowDetail(doc, hyveId);
}

// ============================================================================
// RUN OPERATIONS
// ============================================================================

/**
 * List workflow runs for a user's hyve.
 *
 * Runs are stored in the root-level `runs/` collection with `userId` and
 * `hyveId` fields for filtering.
 *
 * @param userId - The authenticated user's UID
 * @param hyveId - The hyve ID
 * @param options - Optional filters
 * @returns Array of run summaries, sorted by start time descending
 */
export async function listRuns(
  userId: string,
  hyveId: string,
  options?: { status?: WorkflowRunStatus; workflowId?: string; limit?: number }
): Promise<RunSummary[]> {
  log.debug('Listing runs', { userId, hyveId, options });

  // Runs are root-level; always filter by userId + hyveId
  const filters: QueryFilter[] = [
    { field: 'userId', op: 'EQUAL', value: userId },
    { field: 'hyveId', op: 'EQUAL', value: hyveId },
  ];

  if (options?.status) {
    filters.push({ field: 'status', op: 'EQUAL', value: options.status });
  }

  if (options?.workflowId) {
    filters.push({ field: 'workflowId', op: 'EQUAL', value: options.workflowId });
  }

  const results = await runQuery('runs', filters, {
    orderBy: 'startedAt',
    orderDirection: 'DESCENDING',
    limit: options?.limit || 50,
  });
  return results.map(toRunSummary);
}

/**
 * Get full run details by ID.
 *
 * @param userId - The authenticated user's UID (for response enrichment)
 * @param hyveId - The hyve ID (for response enrichment)
 * @param runId - The run ID
 * @returns Run detail or null if not found
 */
export async function getRun(
  userId: string,
  hyveId: string,
  runId: string
): Promise<RunDetail | null> {
  log.debug('Getting run', { userId, hyveId, runId });

  const doc = await getDocument('runs', runId);
  if (!doc) return null;

  return toRunDetail(doc);
}

/**
 * Create a new workflow run (trigger a workflow).
 *
 * @param userId - The authenticated user's UID
 * @param hyveId - The hyve ID
 * @param workflowId - The workflow to run
 * @param options - Optional input data and trigger info
 * @returns The created run summary
 */
export async function createRun(
  userId: string,
  hyveId: string,
  workflowId: string,
  options?: { inputData?: Record<string, unknown>; triggerType?: string }
): Promise<RunSummary> {
  const runId = generateRunId();
  const now = new Date().toISOString();

  log.debug('Creating run', { userId, hyveId, workflowId, runId });

  const runData: Record<string, unknown> = {
    userId,
    hyveId,
    workflowId,
    status: 'pending',
    triggerType: options?.triggerType || 'manual',
    inputData: options?.inputData || {},
    nodeStates: {},
    logs: [],
    progress: 0,
    totalNodes: 0,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const result = await createDocument('runs', runId, runData);
  return toRunSummary(result);
}

/**
 * Get run logs (extracted from the run document).
 *
 * @param userId - The authenticated user's UID (unused, kept for API compat)
 * @param hyveId - The hyve ID (unused, kept for API compat)
 * @param runId - The run ID
 * @returns Array of log entries, or null if run not found
 */
export async function getRunLogs(
  userId: string,
  hyveId: string,
  runId: string
): Promise<RunLogEntry[] | null> {
  log.debug('Getting run logs', { userId, hyveId, runId });

  const doc = await getDocument('runs', runId);
  if (!doc) return null;

  const rawLogs = (doc.logs || []) as Array<Record<string, unknown>>;
  return rawLogs.map(toRunLogEntry);
}

// ============================================================================
// APPROVAL OPERATIONS
// ============================================================================

/**
 * Approve an awaiting_approval run.
 *
 * @param userId - The authenticated user's UID
 * @param hyveId - The hyve ID
 * @param runId - The run ID
 * @param feedback - Optional feedback message
 */
export async function approveRun(
  userId: string,
  hyveId: string,
  runId: string,
  feedback?: string
): Promise<RunDetail> {
  return submitApprovalDecision(userId, hyveId, runId, 'approved', feedback);
}

/**
 * Reject an awaiting_approval run.
 *
 * @param userId - The authenticated user's UID
 * @param hyveId - The hyve ID
 * @param runId - The run ID
 * @param reason - Optional rejection reason
 */
export async function rejectRun(
  userId: string,
  hyveId: string,
  runId: string,
  reason?: string
): Promise<RunDetail> {
  return submitApprovalDecision(userId, hyveId, runId, 'rejected', reason);
}

/**
 * Request revisions on an awaiting_approval run (reject with feedback).
 *
 * @param userId - The authenticated user's UID
 * @param hyveId - The hyve ID
 * @param runId - The run ID
 * @param feedback - Revision feedback
 */
export async function reviseRun(
  userId: string,
  hyveId: string,
  runId: string,
  feedback: string
): Promise<RunDetail> {
  return submitApprovalDecision(userId, hyveId, runId, 'rejected', feedback);
}

/**
 * Submit an approval/rejection decision for an awaiting_approval run.
 *
 * Caveat: This uses a read-then-write pattern (no Firestore transaction via
 * REST API). Concurrent approvals from multiple clients could race. This is
 * acceptable for a single-user CLI tool; the web app handles this atomically
 * via the Firebase SDK's transaction support.
 */
async function submitApprovalDecision(
  userId: string,
  hyveId: string,
  runId: string,
  decision: 'approved' | 'rejected',
  feedback?: string
): Promise<RunDetail> {
  log.debug('Submitting approval decision', { userId, hyveId, runId, decision });

  // Get the run to find the waiting node
  const doc = await getDocument('runs', runId);
  if (!doc) {
    throw new Error(`Run "${runId}" not found`);
  }

  if (doc.status !== 'awaiting_approval') {
    throw new Error(`Run "${runId}" is not awaiting approval (status: ${doc.status})`);
  }

  // Find the node that's awaiting approval
  const nodeStates = (doc.nodeStates || {}) as Record<string, Record<string, unknown>>;
  const waitingNodeId = Object.keys(nodeStates).find(
    (nid) => nodeStates[nid].status === 'awaiting_approval'
  );

  if (!waitingNodeId) {
    throw new Error(`No node found awaiting approval in run "${runId}"`);
  }

  const now = new Date().toISOString();
  const nodePrefix = `nodeStates.${waitingNodeId}`;
  const newStatus = decision === 'approved' ? 'running' : 'failed';
  const nodeStatus = decision === 'approved' ? 'completed' : 'failed';

  // Build Firestore update payload (dot-notation field paths for nested updates)
  const updatePayload = buildApprovalPayload(
    nodePrefix, decision, userId, now, nodeStatus, newStatus, feedback
  );

  const fieldPaths = Object.keys(updatePayload);
  const result = await updateDocument('runs', runId, updatePayload, fieldPaths);
  return toRunDetail(result);
}

/**
 * Build the Firestore update payload for an approval decision.
 * Uses dot-notation field paths for nested Firestore updates.
 */
function buildApprovalPayload(
  nodePrefix: string,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  decidedAt: string,
  nodeStatus: string,
  runStatus: string,
  feedback?: string
): Record<string, unknown> {
  const fields: Record<string, unknown> = Object.create(null);
  fields[`${nodePrefix}.approval.decision`] = decision;
  fields[`${nodePrefix}.approval.decidedBy`] = decidedBy;
  fields[`${nodePrefix}.approval.decidedAt`] = decidedAt;
  fields[`${nodePrefix}.status`] = nodeStatus;
  fields.status = runStatus;
  fields.updatedAt = decidedAt;
  if (feedback) {
    fields[`${nodePrefix}.approval.feedback`] = feedback;
  }
  return fields;
}

// ============================================================================
// ARTIFACT OPERATIONS
// ============================================================================

/**
 * List artifacts for a run.
 *
 * Artifacts are stored as subcollections under runs: `runs/{runId}/artifacts/`.
 *
 * @param runId - The workflow run ID
 * @param options - Optional limit
 * @returns Array of artifact summaries
 */
export async function listArtifacts(
  runId: string,
  options?: { limit?: number }
): Promise<ArtifactSummary[]> {
  const collectionPath = `runs/${runId}/artifacts`;

  log.debug('Listing artifacts', { runId, options });

  const { documents } = await listDocuments(collectionPath, {
    pageSize: options?.limit || 50,
  });
  return documents.map(toArtifactSummary);
}

/**
 * Get full artifact details by ID.
 *
 * @param runId - The workflow run ID
 * @param artifactId - The artifact ID
 * @returns Artifact detail or null if not found
 */
export async function getArtifact(
  runId: string,
  artifactId: string
): Promise<ArtifactDetail | null> {
  const collectionPath = `runs/${runId}/artifacts`;

  log.debug('Getting artifact', { runId, artifactId });

  const doc = await getDocument(collectionPath, artifactId);
  if (!doc) return null;

  return toArtifactDetail(doc);
}

// ============================================================================
// HELPERS
// ============================================================================

function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `run_${timestamp}_${random}`;
}

function toWorkflowSummary(doc: Record<string, unknown>): WorkflowSummary {
  const nodes = (doc.nodes || []) as Array<Record<string, unknown>>;
  const triggers = (doc.triggers || []) as Array<Record<string, unknown>>;

  return {
    id: doc.id as string,
    name: (doc.name as string) || 'Unnamed Workflow',
    description: doc.description as string | undefined,
    version: (doc.version as number) || 1,
    nodeCount: nodes.length,
    triggerTypes: triggers.map((t) => (t.type as string) || 'manual'),
    enabled: (doc.enabled as boolean) ?? true,
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toWorkflowDetail(doc: Record<string, unknown>, hyveId: string): WorkflowDetail {
  const summary = toWorkflowSummary(doc);
  const rawNodes = (doc.nodes || []) as Array<Record<string, unknown>>;
  const rawEdges = (doc.edges || []) as Array<Record<string, unknown>>;
  const rawTriggers = (doc.triggers || []) as Array<Record<string, unknown>>;

  const nodes: WorkflowNodeSummary[] = rawNodes.map((n) => ({
    id: (n.id as string) || '',
    type: (n.type as string) || 'unknown',
    label: (n.label as string) || (n.data as Record<string, unknown>)?.label as string || 'Unnamed',
    description: n.description as string | undefined,
    requiresApproval: Boolean(
      (n.settings as Record<string, unknown>)?.requiresApproval ??
      (n.data as Record<string, unknown>)?.requiresApproval
    ),
  }));

  const edges = rawEdges.map((e) => ({
    source: (e.source as string) || '',
    target: (e.target as string) || '',
    label: e.label as string | undefined,
  }));

  const triggers = rawTriggers.map((t) => ({
    type: (t.type as WorkflowTriggerType) || 'manual',
    config: t.config as Record<string, unknown> | undefined,
  }));

  return {
    ...summary,
    hyveId,
    nodes,
    edges,
    triggers,
    settings: (doc.settings as Record<string, unknown>) || {},
  };
}

function toRunSummary(doc: Record<string, unknown>): RunSummary {
  const nodeStates = (doc.nodeStates || {}) as Record<string, Record<string, unknown>>;

  // Find current node (last running or awaiting approval node)
  let currentNodeId: string | undefined;
  let currentNodeLabel: string | undefined;

  for (const [nid, state] of Object.entries(nodeStates)) {
    if (state.status === 'running' || state.status === 'awaiting_approval') {
      currentNodeId = nid;
      currentNodeLabel = state.label as string | undefined;
      break;
    }
  }

  return {
    id: doc.id as string,
    workflowId: (doc.workflowId as string) || '',
    workflowName: doc.workflowName as string | undefined,
    status: (doc.status as WorkflowRunStatus) || 'pending',
    triggerType: (doc.triggerType as string) || 'manual',
    currentNodeId,
    currentNodeLabel,
    progress: (doc.progress as number) || 0,
    totalNodes: (doc.totalNodes as number) || 0,
    startedAt: doc.startedAt as string | undefined,
    completedAt: doc.completedAt as string | undefined,
    durationMs: doc.durationMs as number | undefined,
  };
}

function toRunDetail(
  doc: Record<string, unknown>,
): RunDetail {
  const summary = toRunSummary(doc);
  const rawNodeStates = (doc.nodeStates || {}) as Record<string, Record<string, unknown>>;

  const nodeStates: NodeRunState[] = Object.entries(rawNodeStates).map(
    ([nodeId, state]) => ({
      nodeId,
      status: (state.status as string) || 'pending',
      label: state.label as string | undefined,
      startedAt: state.startedAt as string | undefined,
      completedAt: state.completedAt as string | undefined,
      error: state.error as string | undefined,
      approval: state.approval as ApprovalInfo | undefined,
    })
  );

  return {
    ...summary,
    hyveId: (doc.hyveId as string) || '',
    userId: (doc.userId as string) || '',
    inputData: doc.inputData as Record<string, unknown> | undefined,
    nodeStates,
    error: doc.error as string | undefined,
  };
}

function toRunLogEntry(raw: Record<string, unknown>): RunLogEntry {
  return {
    timestamp: (raw.timestamp as string) || new Date().toISOString(),
    level: (raw.level as string) || 'info',
    nodeId: raw.nodeId as string | undefined,
    nodeLabel: raw.nodeLabel as string | undefined,
    message: (raw.message as string) || '',
    data: raw.data as Record<string, unknown> | undefined,
  };
}

function toArtifactSummary(doc: Record<string, unknown>): ArtifactSummary {
  return {
    id: doc.id as string,
    runId: (doc.runId as string) || '',
    workflowId: doc.workflowId as string | undefined,
    nodeId: doc.nodeId as string | undefined,
    type: (doc.type as string) || 'unknown',
    name: (doc.name as string) || 'Unnamed',
    mimeType: doc.mimeType as string | undefined,
    size: doc.size as number | undefined,
    createdAt: doc.createdAt as string | undefined,
  };
}

function toArtifactDetail(doc: Record<string, unknown>): ArtifactDetail {
  const summary = toArtifactSummary(doc);
  return {
    ...summary,
    content: doc.content as Record<string, unknown> | undefined,
    metadata: doc.metadata as Record<string, unknown> | undefined,
  };
}
