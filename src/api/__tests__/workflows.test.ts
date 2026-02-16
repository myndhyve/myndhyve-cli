import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock firestore module ───────────────────────────────────────────────────

vi.mock('../firestore.js', () => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  runQuery: vi.fn(),
}));

// ── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Mock node:crypto ────────────────────────────────────────────────────────

vi.mock('node:crypto', () => ({
  randomBytes: () => ({ toString: () => 'abcd1234' }),
}));

// ── Import module under test (after mocks) ──────────────────────────────────

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
} from '../workflows.js';

import type {
  WorkflowSummary,
  WorkflowDetail as _WorkflowDetail,
  RunSummary,
  RunDetail as _RunDetail,
  RunLogEntry,
  ArtifactSummary,
  ArtifactDetail,
} from '../workflows.js';

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  runQuery,
} from '../firestore.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockListDocuments = listDocuments as ReturnType<typeof vi.fn>;
const mockCreateDocument = createDocument as ReturnType<typeof vi.fn>;
const mockUpdateDocument = updateDocument as ReturnType<typeof vi.fn>;
const mockRunQuery = runQuery as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockListDocuments.mockReset();
  mockCreateDocument.mockReset();
  mockUpdateDocument.mockReset();
  mockRunQuery.mockReset();
});

// ── Test data fixtures ──────────────────────────────────────────────────────

const USER_ID = 'user-abc123';
const HYVE_ID = 'app-builder';

const mockWorkflowDoc: Record<string, unknown> = {
  id: 'wf-1',
  name: 'App Builder Workflow',
  description: 'Creates apps step by step',
  version: 2,
  enabled: true,
  nodes: [
    { id: 'node-1', type: 'ai-generate', label: 'Generate PRD', settings: { requiresApproval: false } },
    { id: 'node-2', type: 'ai-generate', label: 'Generate Plan', settings: { requiresApproval: true } },
  ],
  edges: [
    { source: 'node-1', target: 'node-2' },
  ],
  triggers: [
    { type: 'manual' },
    { type: 'chat-message', config: { pattern: 'build' } },
  ],
  settings: { timeout: 30000 },
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-20T14:00:00Z',
};

const mockRunDoc: Record<string, unknown> = {
  id: 'run_abc123',
  workflowId: 'wf-1',
  workflowName: 'App Builder Workflow',
  status: 'running',
  triggerType: 'manual',
  progress: 1,
  totalNodes: 3,
  nodeStates: {
    'node-1': { status: 'completed', label: 'Generate PRD', startedAt: '2025-01-15T10:00:00Z', completedAt: '2025-01-15T10:00:30Z' },
    'node-2': { status: 'running', label: 'Generate Plan' },
  },
  logs: [
    { timestamp: '2025-01-15T10:00:00Z', level: 'info', nodeId: 'node-1', message: 'Starting PRD generation' },
  ],
  inputData: { topic: 'Task Manager' },
  startedAt: '2025-01-15T10:00:00Z',
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:01:00Z',
};

const mockWaitingRunDoc: Record<string, unknown> = {
  id: 'run_waiting123',
  workflowId: 'wf-1',
  status: 'waiting-approval',
  triggerType: 'manual',
  progress: 1,
  totalNodes: 3,
  nodeStates: {
    'node-1': { status: 'completed', label: 'Generate PRD' },
    'node-2': { status: 'waiting-approval', label: 'Review Plan', approval: { requestedAt: '2025-01-15T10:01:00Z' } },
  },
  startedAt: '2025-01-15T10:00:00Z',
};

const mockArtifactDoc: Record<string, unknown> = {
  id: 'art-1',
  runId: 'run_abc123',
  workflowId: 'wf-1',
  nodeId: 'node-1',
  type: 'prd',
  name: 'Task Manager PRD',
  mimeType: 'application/json',
  size: 4096,
  content: { title: 'Task Manager', features: ['kanban', 'tasks'] },
  metadata: { version: 1 },
  createdAt: '2025-01-15T10:00:30Z',
};

// ============================================================================
// WORKFLOW OPERATIONS
// ============================================================================

describe('listWorkflows()', () => {
  it('queries the correct collection path', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listWorkflows(HYVE_ID);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `hyves/${HYVE_ID}/workflows`,
      { pageSize: 50 }
    );
  });

  it('maps results to WorkflowSummary[]', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [mockWorkflowDoc],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual<WorkflowSummary>({
      id: 'wf-1',
      name: 'App Builder Workflow',
      description: 'Creates apps step by step',
      version: 2,
      nodeCount: 2,
      triggerTypes: ['manual', 'chat-message'],
      enabled: true,
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-20T14:00:00Z',
    });
  });

  it('returns empty array when no workflows exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listWorkflows(HYVE_ID);

    expect(results).toEqual([]);
  });

  it('maps multiple workflows correctly', async () => {
    const secondDoc: Record<string, unknown> = {
      id: 'wf-2',
      name: 'Second Workflow',
      version: 1,
      enabled: false,
      nodes: [{ id: 'n-1', type: 'task', label: 'Do thing' }],
      edges: [],
      triggers: [{ type: 'schedule' }],
    };

    mockListDocuments.mockResolvedValue({
      documents: [mockWorkflowDoc, secondDoc],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('wf-1');
    expect(results[1].id).toBe('wf-2');
    expect(results[1].name).toBe('Second Workflow');
    expect(results[1].nodeCount).toBe(1);
    expect(results[1].triggerTypes).toEqual(['schedule']);
    expect(results[1].enabled).toBe(false);
  });

  it('uses different hyve IDs in the collection path', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listWorkflows('landing-page');

    expect(mockListDocuments).toHaveBeenCalledWith(
      'hyves/landing-page/workflows',
      { pageSize: 50 }
    );
  });
});

describe('getWorkflow()', () => {
  it('queries the correct collection path and document ID', async () => {
    mockGetDocument.mockResolvedValue(mockWorkflowDoc);

    await getWorkflow(HYVE_ID, 'wf-1');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `hyves/${HYVE_ID}/workflows`,
      'wf-1'
    );
  });

  it('returns WorkflowDetail with nodes, edges, and triggers', async () => {
    mockGetDocument.mockResolvedValue(mockWorkflowDoc);

    const result = await getWorkflow(HYVE_ID, 'wf-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('wf-1');
    expect(result!.hyveId).toBe(HYVE_ID);
    expect(result!.name).toBe('App Builder Workflow');
    expect(result!.description).toBe('Creates apps step by step');
    expect(result!.version).toBe(2);
    expect(result!.enabled).toBe(true);
    expect(result!.nodeCount).toBe(2);

    // Nodes
    expect(result!.nodes).toHaveLength(2);
    expect(result!.nodes[0]).toEqual({
      id: 'node-1',
      type: 'ai-generate',
      label: 'Generate PRD',
      description: undefined,
      requiresApproval: false,
    });
    expect(result!.nodes[1]).toEqual({
      id: 'node-2',
      type: 'ai-generate',
      label: 'Generate Plan',
      description: undefined,
      requiresApproval: true,
    });

    // Edges
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0]).toEqual({
      source: 'node-1',
      target: 'node-2',
      label: undefined,
    });

    // Triggers
    expect(result!.triggers).toHaveLength(2);
    expect(result!.triggers[0]).toEqual({ type: 'manual', config: undefined });
    expect(result!.triggers[1]).toEqual({ type: 'chat-message', config: { pattern: 'build' } });

    // Settings
    expect(result!.settings).toEqual({ timeout: 30000 });
  });

  it('returns null when workflow not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getWorkflow(HYVE_ID, 'nonexistent');

    expect(result).toBeNull();
  });

  it('includes summary fields in detail (triggerTypes, nodeCount)', async () => {
    mockGetDocument.mockResolvedValue(mockWorkflowDoc);

    const result = await getWorkflow(HYVE_ID, 'wf-1');

    expect(result!.triggerTypes).toEqual(['manual', 'chat-message']);
    expect(result!.nodeCount).toBe(2);
    expect(result!.createdAt).toBe('2025-01-15T10:00:00Z');
    expect(result!.updatedAt).toBe('2025-01-20T14:00:00Z');
  });
});

// ============================================================================
// RUN OPERATIONS
// ============================================================================

describe('listRuns()', () => {
  it('uses listDocuments with correct collection path when no filters', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listRuns(USER_ID, HYVE_ID);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/runs`,
      { pageSize: 50 }
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('uses runQuery with status filter', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listRuns(USER_ID, HYVE_ID, { status: 'running' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collectionPath, filters, options] = mockRunQuery.mock.calls[0];
    expect(collectionPath).toBe(`users/${USER_ID}/hyves/${HYVE_ID}/runs`);
    expect(filters).toEqual([
      { field: 'status', op: 'EQUAL', value: 'running' },
    ]);
    expect(options).toEqual({
      orderBy: 'startedAt',
      orderDirection: 'DESCENDING',
      limit: 50,
    });
    expect(mockListDocuments).not.toHaveBeenCalled();
  });

  it('uses runQuery with workflowId filter', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listRuns(USER_ID, HYVE_ID, { workflowId: 'wf-1' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'workflowId', op: 'EQUAL', value: 'wf-1' },
    ]);
  });

  it('combines status and workflowId filters', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listRuns(USER_ID, HYVE_ID, { status: 'completed', workflowId: 'wf-1' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toHaveLength(2);
    expect(filters).toEqual([
      { field: 'status', op: 'EQUAL', value: 'completed' },
      { field: 'workflowId', op: 'EQUAL', value: 'wf-1' },
    ]);
  });

  it('passes custom limit to runQuery', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listRuns(USER_ID, HYVE_ID, { status: 'running', limit: 10 });

    const [, , options] = mockRunQuery.mock.calls[0];
    expect(options.limit).toBe(10);
  });

  it('passes custom limit to listDocuments when no filters', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listRuns(USER_ID, HYVE_ID, { limit: 25 });

    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/runs`,
      { pageSize: 25 }
    );
  });

  it('maps results to RunSummary[]', async () => {
    mockListDocuments.mockResolvedValue({ documents: [mockRunDoc] });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual<RunSummary>({
      id: 'run_abc123',
      workflowId: 'wf-1',
      workflowName: 'App Builder Workflow',
      status: 'running',
      triggerType: 'manual',
      currentNodeId: 'node-2',
      currentNodeLabel: 'Generate Plan',
      progress: 1,
      totalNodes: 3,
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: undefined,
      durationMs: undefined,
    });
  });

  it('returns empty array when no runs exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results).toEqual([]);
  });

  it('uses empty options without triggering query', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listRuns(USER_ID, HYVE_ID, {});

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('getRun()', () => {
  it('queries the correct collection path and document ID', async () => {
    mockGetDocument.mockResolvedValue(mockRunDoc);

    await getRun(USER_ID, HYVE_ID, 'run_abc123');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/runs`,
      'run_abc123'
    );
  });

  it('returns RunDetail with nodeStates', async () => {
    mockGetDocument.mockResolvedValue(mockRunDoc);

    const result = await getRun(USER_ID, HYVE_ID, 'run_abc123');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('run_abc123');
    expect(result!.hyveId).toBe(HYVE_ID);
    expect(result!.userId).toBe(USER_ID);
    expect(result!.workflowId).toBe('wf-1');
    expect(result!.workflowName).toBe('App Builder Workflow');
    expect(result!.status).toBe('running');
    expect(result!.triggerType).toBe('manual');
    expect(result!.inputData).toEqual({ topic: 'Task Manager' });

    // NodeStates are converted from object to array
    expect(result!.nodeStates).toHaveLength(2);
    expect(result!.nodeStates[0]).toEqual({
      nodeId: 'node-1',
      status: 'completed',
      label: 'Generate PRD',
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T10:00:30Z',
      error: undefined,
      approval: undefined,
    });
    expect(result!.nodeStates[1]).toEqual({
      nodeId: 'node-2',
      status: 'running',
      label: 'Generate Plan',
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      approval: undefined,
    });
  });

  it('returns null when run not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getRun(USER_ID, HYVE_ID, 'nonexistent');

    expect(result).toBeNull();
  });

  it('includes summary fields currentNodeId/currentNodeLabel in detail', async () => {
    mockGetDocument.mockResolvedValue(mockRunDoc);

    const result = await getRun(USER_ID, HYVE_ID, 'run_abc123');

    expect(result!.currentNodeId).toBe('node-2');
    expect(result!.currentNodeLabel).toBe('Generate Plan');
  });
});

describe('createRun()', () => {
  beforeEach(() => {
    mockCreateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        ...data,
        id: docId,
      })
    );
  });

  it('creates run at the correct collection path', async () => {
    await createRun(USER_ID, HYVE_ID, 'wf-1');

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [collectionPath] = mockCreateDocument.mock.calls[0];
    expect(collectionPath).toBe(`users/${USER_ID}/hyves/${HYVE_ID}/runs`);
  });

  it('generates a run ID with run_ prefix', async () => {
    await createRun(USER_ID, HYVE_ID, 'wf-1');

    const [, runId] = mockCreateDocument.mock.calls[0];
    expect(runId).toMatch(/^run_/);
    // Contains the mocked randomBytes hex
    expect(runId).toContain('abcd1234');
  });

  it('creates with status "pending" and triggerType "manual" by default', async () => {
    await createRun(USER_ID, HYVE_ID, 'wf-1');

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.workflowId).toBe('wf-1');
    expect(data.status).toBe('pending');
    expect(data.triggerType).toBe('manual');
    expect(data.inputData).toEqual({});
    expect(data.nodeStates).toEqual({});
    expect(data.logs).toEqual([]);
    expect(data.progress).toBe(0);
    expect(data.totalNodes).toBe(0);
  });

  it('includes timestamps (startedAt, createdAt, updatedAt)', async () => {
    await createRun(USER_ID, HYVE_ID, 'wf-1');

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(typeof data.startedAt).toBe('string');
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');

    // All three timestamps should be the same ISO string
    expect(data.startedAt).toBe(data.createdAt);
    expect(data.createdAt).toBe(data.updatedAt);

    // Should parse as a valid date
    const parsed = new Date(data.startedAt as string);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('passes through inputData when provided', async () => {
    await createRun(USER_ID, HYVE_ID, 'wf-1', {
      inputData: { topic: 'Task Manager', complexity: 'medium' },
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.inputData).toEqual({ topic: 'Task Manager', complexity: 'medium' });
  });

  it('uses custom triggerType when provided', async () => {
    await createRun(USER_ID, HYVE_ID, 'wf-1', {
      triggerType: 'chat-message',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.triggerType).toBe('chat-message');
  });

  it('returns a RunSummary from the created document', async () => {
    const result = await createRun(USER_ID, HYVE_ID, 'wf-1');

    expect(result.id).toMatch(/^run_/);
    expect(result.workflowId).toBe('wf-1');
    expect(result.status).toBe('pending');
    expect(result.triggerType).toBe('manual');
    expect(result.progress).toBe(0);
    expect(result.totalNodes).toBe(0);
  });
});

describe('getRunLogs()', () => {
  it('queries the correct collection path', async () => {
    mockGetDocument.mockResolvedValue(mockRunDoc);

    await getRunLogs(USER_ID, HYVE_ID, 'run_abc123');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/runs`,
      'run_abc123'
    );
  });

  it('extracts logs from run document and maps to RunLogEntry[]', async () => {
    mockGetDocument.mockResolvedValue(mockRunDoc);

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run_abc123');

    expect(logs).not.toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs![0]).toEqual<RunLogEntry>({
      timestamp: '2025-01-15T10:00:00Z',
      level: 'info',
      nodeId: 'node-1',
      nodeLabel: undefined,
      message: 'Starting PRD generation',
      data: undefined,
    });
  });

  it('returns null if run not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'nonexistent');

    expect(logs).toBeNull();
  });

  it('returns empty array when run has no logs', async () => {
    mockGetDocument.mockResolvedValue({ id: 'run-no-logs', logs: [] });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-no-logs');

    expect(logs).toEqual([]);
  });

  it('returns empty array when run document has no logs field', async () => {
    mockGetDocument.mockResolvedValue({ id: 'run-missing-logs' });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-missing-logs');

    expect(logs).toEqual([]);
  });

  it('maps multiple log entries with all fields', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-full-logs',
      logs: [
        {
          timestamp: '2025-01-15T10:00:00Z',
          level: 'info',
          nodeId: 'node-1',
          nodeLabel: 'PRD Gen',
          message: 'Starting generation',
          data: { model: 'gpt-4' },
        },
        {
          timestamp: '2025-01-15T10:00:30Z',
          level: 'warn',
          nodeId: 'node-2',
          message: 'Rate limited, retrying',
        },
        {
          timestamp: '2025-01-15T10:01:00Z',
          level: 'error',
          message: 'Workflow failed',
          data: { code: 'TIMEOUT' },
        },
      ],
    });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-full-logs');

    expect(logs).toHaveLength(3);
    expect(logs![0].nodeLabel).toBe('PRD Gen');
    expect(logs![0].data).toEqual({ model: 'gpt-4' });
    expect(logs![1].level).toBe('warn');
    expect(logs![1].nodeLabel).toBeUndefined();
    expect(logs![2].nodeId).toBeUndefined();
    expect(logs![2].data).toEqual({ code: 'TIMEOUT' });
  });
});

// ============================================================================
// APPROVAL OPERATIONS
// ============================================================================

describe('approveRun()', () => {
  it('verifies run is waiting-approval, finds waiting node, and updates with approved decision', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockResolvedValue({
      ...mockWaitingRunDoc,
      status: 'running',
      nodeStates: {
        'node-1': { status: 'completed', label: 'Generate PRD' },
        'node-2': {
          status: 'completed',
          label: 'Review Plan',
          approval: {
            requestedAt: '2025-01-15T10:01:00Z',
            decision: 'approved',
            decidedBy: USER_ID,
            decidedAt: expect.any(String),
          },
        },
      },
    });

    const result = await approveRun(USER_ID, HYVE_ID, 'run_waiting123');

    // Verify getDocument call
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/runs`,
      'run_waiting123'
    );

    // Verify updateDocument call
    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [collectionPath, runId, payload, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(collectionPath).toBe(`users/${USER_ID}/hyves/${HYVE_ID}/runs`);
    expect(runId).toBe('run_waiting123');

    // Verify payload fields
    expect(payload['nodeStates.node-2.approval.decision']).toBe('approved');
    expect(payload['nodeStates.node-2.approval.decidedBy']).toBe(USER_ID);
    expect(payload['nodeStates.node-2.approval.decidedAt']).toBeDefined();
    expect(payload['nodeStates.node-2.status']).toBe('completed');
    expect(payload['status']).toBe('running');
    expect(payload['updatedAt']).toBeDefined();

    // Verify field paths
    expect(fieldPaths).toContain('nodeStates.node-2.approval.decision');
    expect(fieldPaths).toContain('nodeStates.node-2.approval.decidedBy');
    expect(fieldPaths).toContain('nodeStates.node-2.approval.decidedAt');
    expect(fieldPaths).toContain('nodeStates.node-2.status');
    expect(fieldPaths).toContain('status');
    expect(fieldPaths).toContain('updatedAt');

    // No feedback field when feedback is not provided
    expect(payload['nodeStates.node-2.approval.feedback']).toBeUndefined();

    // Returns a RunDetail
    expect(result.hyveId).toBe(HYVE_ID);
    expect(result.userId).toBe(USER_ID);
  });

  it('includes feedback in payload when provided', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockResolvedValue({ ...mockWaitingRunDoc, status: 'running' });

    await approveRun(USER_ID, HYVE_ID, 'run_waiting123', 'Looks great, approved!');

    const [, , payload, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(payload['nodeStates.node-2.approval.feedback']).toBe('Looks great, approved!');
    expect(fieldPaths).toContain('nodeStates.node-2.approval.feedback');
  });

  it('throws if run not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    await expect(approveRun(USER_ID, HYVE_ID, 'nonexistent')).rejects.toThrow(
      'Run "nonexistent" not found'
    );

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('throws if run is not waiting-approval', async () => {
    mockGetDocument.mockResolvedValue({ ...mockRunDoc, status: 'running' });

    await expect(approveRun(USER_ID, HYVE_ID, 'run_abc123')).rejects.toThrow(
      'Run "run_abc123" is not waiting for approval (status: running)'
    );

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('throws if no node is waiting for approval', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run_no_waiting',
      status: 'waiting-approval',
      nodeStates: {
        'node-1': { status: 'completed' },
        'node-2': { status: 'completed' },
      },
    });

    await expect(approveRun(USER_ID, HYVE_ID, 'run_no_waiting')).rejects.toThrow(
      'No node found waiting for approval in run "run_no_waiting"'
    );

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('throws if nodeStates is empty', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run_empty_nodes',
      status: 'waiting-approval',
      nodeStates: {},
    });

    await expect(approveRun(USER_ID, HYVE_ID, 'run_empty_nodes')).rejects.toThrow(
      'No node found waiting for approval'
    );
  });
});

describe('rejectRun()', () => {
  it('updates decision to "rejected" with node status "failed" and run status "failed"', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockResolvedValue({ ...mockWaitingRunDoc, status: 'failed' });

    await rejectRun(USER_ID, HYVE_ID, 'run_waiting123', 'Needs more detail');

    const [, , payload] = mockUpdateDocument.mock.calls[0];
    expect(payload['nodeStates.node-2.approval.decision']).toBe('rejected');
    expect(payload['nodeStates.node-2.status']).toBe('failed');
    expect(payload['status']).toBe('failed');
    expect(payload['nodeStates.node-2.approval.feedback']).toBe('Needs more detail');
  });

  it('works without a reason', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockResolvedValue({ ...mockWaitingRunDoc, status: 'failed' });

    await rejectRun(USER_ID, HYVE_ID, 'run_waiting123');

    const [, , payload] = mockUpdateDocument.mock.calls[0];
    expect(payload['nodeStates.node-2.approval.decision']).toBe('rejected');
    expect(payload['nodeStates.node-2.approval.feedback']).toBeUndefined();
  });

  it('throws if run not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    await expect(rejectRun(USER_ID, HYVE_ID, 'nonexistent')).rejects.toThrow(
      'Run "nonexistent" not found'
    );
  });
});

describe('reviseRun()', () => {
  it('rejects with feedback (same as rejectRun)', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockResolvedValue({ ...mockWaitingRunDoc, status: 'failed' });

    await reviseRun(USER_ID, HYVE_ID, 'run_waiting123', 'Please add more features to the plan');

    const [, , payload] = mockUpdateDocument.mock.calls[0];
    expect(payload['nodeStates.node-2.approval.decision']).toBe('rejected');
    expect(payload['nodeStates.node-2.approval.feedback']).toBe('Please add more features to the plan');
    expect(payload['nodeStates.node-2.status']).toBe('failed');
    expect(payload['status']).toBe('failed');
  });

  it('returns RunDetail', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockResolvedValue({
      ...mockWaitingRunDoc,
      status: 'failed',
    });

    const result = await reviseRun(USER_ID, HYVE_ID, 'run_waiting123', 'Revise this');

    expect(result.hyveId).toBe(HYVE_ID);
    expect(result.userId).toBe(USER_ID);
    expect(result.id).toBe('run_waiting123');
  });
});

// ============================================================================
// ARTIFACT OPERATIONS
// ============================================================================

describe('listArtifacts()', () => {
  it('uses listDocuments with correct collection path when no filters', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listArtifacts(USER_ID, HYVE_ID);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/artifacts`,
      { pageSize: 50 }
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('uses runQuery with runId filter', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listArtifacts(USER_ID, HYVE_ID, { runId: 'run_abc123' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collectionPath, filters, options] = mockRunQuery.mock.calls[0];
    expect(collectionPath).toBe(`users/${USER_ID}/hyves/${HYVE_ID}/artifacts`);
    expect(filters).toEqual([
      { field: 'runId', op: 'EQUAL', value: 'run_abc123' },
    ]);
    expect(options).toEqual({ limit: 50 });
    expect(mockListDocuments).not.toHaveBeenCalled();
  });

  it('passes custom limit to runQuery', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listArtifacts(USER_ID, HYVE_ID, { runId: 'run_abc123', limit: 10 });

    const [, , options] = mockRunQuery.mock.calls[0];
    expect(options.limit).toBe(10);
  });

  it('passes custom limit to listDocuments when no filters', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listArtifacts(USER_ID, HYVE_ID, { limit: 20 });

    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/artifacts`,
      { pageSize: 20 }
    );
  });

  it('maps results to ArtifactSummary[]', async () => {
    mockListDocuments.mockResolvedValue({ documents: [mockArtifactDoc] });

    const results = await listArtifacts(USER_ID, HYVE_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual<ArtifactSummary>({
      id: 'art-1',
      runId: 'run_abc123',
      workflowId: 'wf-1',
      nodeId: 'node-1',
      type: 'prd',
      name: 'Task Manager PRD',
      mimeType: 'application/json',
      size: 4096,
      createdAt: '2025-01-15T10:00:30Z',
    });
  });

  it('summary does not include content or metadata', async () => {
    mockListDocuments.mockResolvedValue({ documents: [mockArtifactDoc] });

    const results = await listArtifacts(USER_ID, HYVE_ID);

    expect(results[0]).not.toHaveProperty('content');
    expect(results[0]).not.toHaveProperty('metadata');
  });

  it('returns empty array when no artifacts exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listArtifacts(USER_ID, HYVE_ID);

    expect(results).toEqual([]);
  });

  it('uses empty options without triggering query', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listArtifacts(USER_ID, HYVE_ID, {});

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

describe('getArtifact()', () => {
  it('queries the correct collection path and document ID', async () => {
    mockGetDocument.mockResolvedValue(mockArtifactDoc);

    await getArtifact(USER_ID, HYVE_ID, 'art-1');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/hyves/${HYVE_ID}/artifacts`,
      'art-1'
    );
  });

  it('returns ArtifactDetail with content and metadata', async () => {
    mockGetDocument.mockResolvedValue(mockArtifactDoc);

    const result = await getArtifact(USER_ID, HYVE_ID, 'art-1');

    expect(result).not.toBeNull();
    expect(result!).toEqual<ArtifactDetail>({
      id: 'art-1',
      runId: 'run_abc123',
      workflowId: 'wf-1',
      nodeId: 'node-1',
      type: 'prd',
      name: 'Task Manager PRD',
      mimeType: 'application/json',
      size: 4096,
      createdAt: '2025-01-15T10:00:30Z',
      content: { title: 'Task Manager', features: ['kanban', 'tasks'] },
      metadata: { version: 1 },
    });
  });

  it('returns null when artifact not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getArtifact(USER_ID, HYVE_ID, 'nonexistent');

    expect(result).toBeNull();
  });

  it('includes summary fields in detail', async () => {
    mockGetDocument.mockResolvedValue(mockArtifactDoc);

    const result = await getArtifact(USER_ID, HYVE_ID, 'art-1');

    // Summary fields present
    expect(result!.id).toBe('art-1');
    expect(result!.runId).toBe('run_abc123');
    expect(result!.type).toBe('prd');
    expect(result!.name).toBe('Task Manager PRD');
    expect(result!.mimeType).toBe('application/json');
    expect(result!.size).toBe(4096);
    expect(result!.createdAt).toBe('2025-01-15T10:00:30Z');
  });
});

// ============================================================================
// TYPE CONVERTER DEFAULTS (tested through API functions)
// ============================================================================

describe('toWorkflowSummary (tested via listWorkflows)', () => {
  it('handles missing fields with defaults', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'wf-sparse' }],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results[0].id).toBe('wf-sparse');
    expect(results[0].name).toBe('Unnamed Workflow');
    expect(results[0].description).toBeUndefined();
    expect(results[0].version).toBe(1);
    expect(results[0].nodeCount).toBe(0);
    expect(results[0].triggerTypes).toEqual([]);
    expect(results[0].enabled).toBe(true);
    expect(results[0].createdAt).toBeUndefined();
    expect(results[0].updatedAt).toBeUndefined();
  });

  it('defaults enabled to true when field is missing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'wf-no-enabled', name: 'Test' }],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results[0].enabled).toBe(true);
  });

  it('respects enabled=false explicitly set', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'wf-disabled', name: 'Disabled', enabled: false }],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results[0].enabled).toBe(false);
  });

  it('counts nodes correctly from array', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{
        id: 'wf-many-nodes',
        nodes: [
          { id: 'n1', type: 'a' },
          { id: 'n2', type: 'b' },
          { id: 'n3', type: 'c' },
        ],
      }],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results[0].nodeCount).toBe(3);
  });

  it('extracts trigger types, defaulting to "manual" for missing type', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{
        id: 'wf-triggers',
        triggers: [
          { type: 'webhook' },
          { type: 'schedule' },
          { /* missing type */ },
        ],
      }],
    });

    const results = await listWorkflows(HYVE_ID);

    expect(results[0].triggerTypes).toEqual(['webhook', 'schedule', 'manual']);
  });
});

describe('toWorkflowDetail (tested via getWorkflow)', () => {
  it('handles workflow with no nodes, edges, triggers, or settings', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-empty',
      name: 'Empty Workflow',
    });

    const result = await getWorkflow(HYVE_ID, 'wf-empty');

    expect(result!.nodes).toEqual([]);
    expect(result!.edges).toEqual([]);
    expect(result!.triggers).toEqual([]);
    expect(result!.settings).toEqual({});
  });

  it('extracts requiresApproval from node settings', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-approval',
      nodes: [
        { id: 'n1', type: 'task', label: 'Auto', settings: { requiresApproval: false } },
        { id: 'n2', type: 'review', label: 'Review', settings: { requiresApproval: true } },
      ],
    });

    const result = await getWorkflow(HYVE_ID, 'wf-approval');

    expect(result!.nodes[0].requiresApproval).toBe(false);
    expect(result!.nodes[1].requiresApproval).toBe(true);
  });

  it('extracts requiresApproval from node data fallback', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-data-approval',
      nodes: [
        { id: 'n1', type: 'task', label: 'Review', data: { requiresApproval: true } },
      ],
    });

    const result = await getWorkflow(HYVE_ID, 'wf-data-approval');

    expect(result!.nodes[0].requiresApproval).toBe(true);
  });

  it('defaults requiresApproval to false when not set anywhere', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-no-approval',
      nodes: [
        { id: 'n1', type: 'task', label: 'Normal' },
      ],
    });

    const result = await getWorkflow(HYVE_ID, 'wf-no-approval');

    expect(result!.nodes[0].requiresApproval).toBe(false);
  });

  it('extracts label from data.label as fallback', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-data-label',
      nodes: [
        { id: 'n1', type: 'task', data: { label: 'From Data' } },
      ],
    });

    const result = await getWorkflow(HYVE_ID, 'wf-data-label');

    expect(result!.nodes[0].label).toBe('From Data');
  });

  it('defaults node label to "Unnamed" when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-no-label',
      nodes: [
        { id: 'n1', type: 'task' },
      ],
    });

    const result = await getWorkflow(HYVE_ID, 'wf-no-label');

    expect(result!.nodes[0].label).toBe('Unnamed');
  });

  it('handles edge with label', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'wf-edge-labels',
      edges: [
        { source: 'n1', target: 'n2', label: 'on success' },
        { source: 'n2', target: 'n3' },
      ],
    });

    const result = await getWorkflow(HYVE_ID, 'wf-edge-labels');

    expect(result!.edges[0].label).toBe('on success');
    expect(result!.edges[1].label).toBeUndefined();
  });
});

describe('toRunSummary (tested via listRuns)', () => {
  it('finds currentNodeId from running node', async () => {
    mockListDocuments.mockResolvedValue({ documents: [mockRunDoc] });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results[0].currentNodeId).toBe('node-2');
    expect(results[0].currentNodeLabel).toBe('Generate Plan');
  });

  it('finds currentNodeId from waiting-approval node', async () => {
    mockListDocuments.mockResolvedValue({ documents: [mockWaitingRunDoc] });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results[0].currentNodeId).toBe('node-2');
    expect(results[0].currentNodeLabel).toBe('Review Plan');
  });

  it('has no currentNodeId when all nodes are completed', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{
        id: 'run-done',
        status: 'completed',
        nodeStates: {
          'node-1': { status: 'completed' },
          'node-2': { status: 'completed' },
        },
      }],
    });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results[0].currentNodeId).toBeUndefined();
    expect(results[0].currentNodeLabel).toBeUndefined();
  });

  it('handles missing fields with defaults', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'run-sparse' }],
    });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results[0].id).toBe('run-sparse');
    expect(results[0].workflowId).toBe('');
    expect(results[0].workflowName).toBeUndefined();
    expect(results[0].status).toBe('pending');
    expect(results[0].triggerType).toBe('manual');
    expect(results[0].currentNodeId).toBeUndefined();
    expect(results[0].currentNodeLabel).toBeUndefined();
    expect(results[0].progress).toBe(0);
    expect(results[0].totalNodes).toBe(0);
    expect(results[0].startedAt).toBeUndefined();
    expect(results[0].completedAt).toBeUndefined();
    expect(results[0].durationMs).toBeUndefined();
  });

  it('preserves durationMs and completedAt when present', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{
        id: 'run-finished',
        status: 'completed',
        completedAt: '2025-01-15T10:05:00Z',
        durationMs: 300000,
        nodeStates: {},
      }],
    });

    const results = await listRuns(USER_ID, HYVE_ID);

    expect(results[0].completedAt).toBe('2025-01-15T10:05:00Z');
    expect(results[0].durationMs).toBe(300000);
  });
});

describe('toRunDetail (tested via getRun)', () => {
  it('converts nodeStates from object to NodeRunState array', async () => {
    mockGetDocument.mockResolvedValue(mockRunDoc);

    const result = await getRun(USER_ID, HYVE_ID, 'run_abc123');

    expect(Array.isArray(result!.nodeStates)).toBe(true);
    expect(result!.nodeStates).toHaveLength(2);

    const nodeIds = result!.nodeStates.map((ns) => ns.nodeId);
    expect(nodeIds).toContain('node-1');
    expect(nodeIds).toContain('node-2');
  });

  it('includes approval info in node state', async () => {
    mockGetDocument.mockResolvedValue(mockWaitingRunDoc);

    const result = await getRun(USER_ID, HYVE_ID, 'run_waiting123');

    const waitingNode = result!.nodeStates.find((ns) => ns.nodeId === 'node-2');
    expect(waitingNode).toBeDefined();
    expect(waitingNode!.approval).toEqual({
      requestedAt: '2025-01-15T10:01:00Z',
    });
  });

  it('handles empty nodeStates', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-empty',
      status: 'pending',
      nodeStates: {},
    });

    const result = await getRun(USER_ID, HYVE_ID, 'run-empty');

    expect(result!.nodeStates).toEqual([]);
  });

  it('handles missing nodeStates field', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-no-states',
      status: 'pending',
    });

    const result = await getRun(USER_ID, HYVE_ID, 'run-no-states');

    expect(result!.nodeStates).toEqual([]);
  });

  it('includes error field when present', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-failed',
      status: 'failed',
      error: 'Timeout after 30000ms',
      nodeStates: {},
    });

    const result = await getRun(USER_ID, HYVE_ID, 'run-failed');

    expect(result!.error).toBe('Timeout after 30000ms');
  });

  it('includes inputData when present', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-with-input',
      inputData: { topic: 'E-commerce', features: ['cart', 'checkout'] },
      nodeStates: {},
    });

    const result = await getRun(USER_ID, HYVE_ID, 'run-with-input');

    expect(result!.inputData).toEqual({
      topic: 'E-commerce',
      features: ['cart', 'checkout'],
    });
  });

  it('maps node error field', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-node-error',
      status: 'failed',
      nodeStates: {
        'node-1': { status: 'failed', error: 'API rate limit exceeded', label: 'Generate' },
      },
    });

    const result = await getRun(USER_ID, HYVE_ID, 'run-node-error');

    expect(result!.nodeStates[0].error).toBe('API rate limit exceeded');
    expect(result!.nodeStates[0].status).toBe('failed');
  });
});

describe('toRunLogEntry (tested via getRunLogs)', () => {
  it('handles all fields present', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-full-log',
      logs: [{
        timestamp: '2025-01-15T10:00:00Z',
        level: 'debug',
        nodeId: 'node-1',
        nodeLabel: 'Generator',
        message: 'Processing input',
        data: { tokens: 500 },
      }],
    });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-full-log');

    expect(logs![0]).toEqual<RunLogEntry>({
      timestamp: '2025-01-15T10:00:00Z',
      level: 'debug',
      nodeId: 'node-1',
      nodeLabel: 'Generator',
      message: 'Processing input',
      data: { tokens: 500 },
    });
  });

  it('defaults level to "info" when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-no-level',
      logs: [{ message: 'Something happened' }],
    });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-no-level');

    expect(logs![0].level).toBe('info');
  });

  it('defaults message to empty string when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-no-message',
      logs: [{ level: 'error' }],
    });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-no-message');

    expect(logs![0].message).toBe('');
  });

  it('provides a timestamp fallback when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'run-no-ts',
      logs: [{ message: 'Logged' }],
    });

    const logs = await getRunLogs(USER_ID, HYVE_ID, 'run-no-ts');

    // Should be a valid ISO timestamp (fallback to new Date().toISOString())
    expect(typeof logs![0].timestamp).toBe('string');
    const parsed = new Date(logs![0].timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

describe('toArtifactSummary (tested via listArtifacts)', () => {
  it('handles missing optional fields with defaults', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'art-sparse', runId: 'run-1' }],
    });

    const results = await listArtifacts(USER_ID, HYVE_ID);

    expect(results[0].id).toBe('art-sparse');
    expect(results[0].runId).toBe('run-1');
    expect(results[0].workflowId).toBeUndefined();
    expect(results[0].nodeId).toBeUndefined();
    expect(results[0].type).toBe('unknown');
    expect(results[0].name).toBe('Unnamed');
    expect(results[0].mimeType).toBeUndefined();
    expect(results[0].size).toBeUndefined();
    expect(results[0].createdAt).toBeUndefined();
  });

  it('defaults runId to empty string when missing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'art-no-run' }],
    });

    const results = await listArtifacts(USER_ID, HYVE_ID);

    expect(results[0].runId).toBe('');
  });

  it('defaults type to "unknown" and name to "Unnamed"', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'art-minimal' }],
    });

    const results = await listArtifacts(USER_ID, HYVE_ID);

    expect(results[0].type).toBe('unknown');
    expect(results[0].name).toBe('Unnamed');
  });
});

describe('toArtifactDetail (tested via getArtifact)', () => {
  it('includes content and metadata in detail', async () => {
    mockGetDocument.mockResolvedValue(mockArtifactDoc);

    const result = await getArtifact(USER_ID, HYVE_ID, 'art-1');

    expect(result!.content).toEqual({ title: 'Task Manager', features: ['kanban', 'tasks'] });
    expect(result!.metadata).toEqual({ version: 1 });
  });

  it('handles missing content and metadata', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'art-no-content',
      runId: 'run-1',
      type: 'text',
      name: 'Simple',
    });

    const result = await getArtifact(USER_ID, HYVE_ID, 'art-no-content');

    expect(result!.content).toBeUndefined();
    expect(result!.metadata).toBeUndefined();
  });
});

// ============================================================================
// ERROR PROPAGATION
// ============================================================================

describe('error propagation', () => {
  it('listWorkflows propagates errors from listDocuments', async () => {
    mockListDocuments.mockRejectedValue(new Error('Network error'));

    await expect(listWorkflows(HYVE_ID)).rejects.toThrow('Network error');
  });

  it('getWorkflow propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(getWorkflow(HYVE_ID, 'wf-1')).rejects.toThrow('Permission denied');
  });

  it('createRun propagates errors from createDocument', async () => {
    mockCreateDocument.mockRejectedValue(new Error('Quota exceeded'));

    await expect(createRun(USER_ID, HYVE_ID, 'wf-1')).rejects.toThrow('Quota exceeded');
  });

  it('approveRun propagates errors from updateDocument', async () => {
    mockGetDocument.mockResolvedValue({ ...mockWaitingRunDoc });
    mockUpdateDocument.mockRejectedValue(new Error('Write conflict'));

    await expect(approveRun(USER_ID, HYVE_ID, 'run_waiting123')).rejects.toThrow('Write conflict');
  });

  it('getArtifact propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Not found'));

    await expect(getArtifact(USER_ID, HYVE_ID, 'art-1')).rejects.toThrow('Not found');
  });
});
