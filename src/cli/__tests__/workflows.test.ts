import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockTruncate,
  mockFormatRelativeTime,
  mockPrintError,
  mockListWorkflows,
  mockGetWorkflow,
  mockListRuns,
  mockGetRun,
  mockCreateRun,
  mockGetRunLogs,
  mockApproveRun,
  mockRejectRun,
  mockReviseRun,
  mockListArtifacts,
  mockGetArtifact,
  mockGetActiveContext,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockPrintError: vi.fn(),
  mockListWorkflows: vi.fn(),
  mockGetWorkflow: vi.fn(),
  mockListRuns: vi.fn(),
  mockGetRun: vi.fn(),
  mockCreateRun: vi.fn(),
  mockGetRunLogs: vi.fn(),
  mockApproveRun: vi.fn(),
  mockRejectRun: vi.fn(),
  mockReviseRun: vi.fn(),
  mockListArtifacts: vi.fn(),
  mockGetArtifact: vi.fn(),
  mockGetActiveContext: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  formatRelativeTime: (...args: unknown[]) => mockFormatRelativeTime(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/workflows.js', () => ({
  listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
  getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
  listRuns: (...args: unknown[]) => mockListRuns(...args),
  getRun: (...args: unknown[]) => mockGetRun(...args),
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  getRunLogs: (...args: unknown[]) => mockGetRunLogs(...args),
  approveRun: (...args: unknown[]) => mockApproveRun(...args),
  rejectRun: (...args: unknown[]) => mockRejectRun(...args),
  reviseRun: (...args: unknown[]) => mockReviseRun(...args),
  listArtifacts: (...args: unknown[]) => mockListArtifacts(...args),
  getArtifact: (...args: unknown[]) => mockGetArtifact(...args),
}));

vi.mock('../../context.js', () => ({
  getActiveContext: (...args: unknown[]) => mockGetActiveContext(...args),
}));

vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

import { registerWorkflowCommands } from '../workflows.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user-123', email: 'dev@myndhyve.com' };

const DEFAULT_CONTEXT = {
  projectId: 'proj-123',
  projectName: 'My Project',
  hyveId: 'landing-page',
  hyveName: 'Landing Page',
  setAt: '2025-01-15T10:00:00Z',
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerWorkflowCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const mockWorkflowSummary = {
  id: 'wf-1',
  name: 'App Builder Workflow',
  description: 'Creates apps',
  version: 2,
  nodeCount: 4,
  triggerTypes: ['manual', 'chat-message'],
  enabled: true,
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-20T14:00:00Z',
};

const mockWorkflowSummaryDisabled = {
  ...mockWorkflowSummary,
  id: 'wf-disabled',
  name: 'Disabled Workflow',
  enabled: false,
};

const mockWorkflowDetail = {
  ...mockWorkflowSummary,
  hyveId: 'landing-page',
  nodes: [
    { id: 'node-1', type: 'ai-generate', label: 'Generate PRD', requiresApproval: false },
    { id: 'node-2', type: 'approval', label: 'Review PRD', requiresApproval: true },
  ],
  edges: [{ source: 'node-1', target: 'node-2' }],
  triggers: [{ type: 'manual' }],
  settings: {},
};

const mockWorkflowDetailWithEdgeLabels = {
  ...mockWorkflowDetail,
  edges: [{ source: 'node-1', target: 'node-2', label: 'on success' }],
};

const mockRunSummary = {
  id: 'run_abc123',
  workflowId: 'wf-1',
  workflowName: 'App Builder Workflow',
  status: 'running',
  triggerType: 'manual',
  progress: 1,
  totalNodes: 4,
  startedAt: '2025-01-15T10:00:00Z',
};

const mockRunDetail = {
  ...mockRunSummary,
  hyveId: 'landing-page',
  userId: 'user-123',
  nodeStates: [
    { nodeId: 'node-1', status: 'completed', label: 'Generate PRD' },
    { nodeId: 'node-2', status: 'running', label: 'Generate Plan' },
  ],
};

const mockRunDetailWithDuration = {
  ...mockRunDetail,
  status: 'completed',
  completedAt: '2025-01-15T10:05:00Z',
  durationMs: 300000,
  currentNodeLabel: 'Generate Plan',
  currentNodeId: 'node-2',
};

const mockRunDetailWithError = {
  ...mockRunDetail,
  status: 'failed',
  error: 'Node execution failed: timeout',
  nodeStates: [
    { nodeId: 'node-1', status: 'completed', label: 'Generate PRD' },
    { nodeId: 'node-2', status: 'failed', label: 'Generate Plan', error: 'Timeout after 30s' },
  ],
};

const mockWaitingRunDetail = {
  id: 'run_waiting123',
  workflowId: 'wf-1',
  workflowName: 'App Builder Workflow',
  status: 'awaiting_approval',
  triggerType: 'manual',
  progress: 1,
  totalNodes: 3,
  hyveId: 'landing-page',
  userId: 'user-123',
  startedAt: '2025-01-15T10:00:00Z',
  nodeStates: [
    { nodeId: 'node-1', status: 'completed', label: 'Generate PRD' },
    {
      nodeId: 'node-2',
      status: 'awaiting_approval',
      label: 'Review Plan',
      approval: { requestedAt: '2025-01-15T10:01:00Z' },
    },
  ],
};

const mockLogEntries = [
  {
    timestamp: '2025-01-15T10:00:00Z',
    level: 'info',
    nodeId: 'node-1',
    nodeLabel: 'Generate PRD',
    message: 'Starting PRD generation',
  },
  {
    timestamp: '2025-01-15T10:00:30Z',
    level: 'info',
    nodeId: 'node-1',
    message: 'PRD generation complete',
  },
];

const mockArtifactSummary = {
  id: 'art-1',
  runId: 'run_abc123',
  workflowId: 'wf-1',
  nodeId: 'node-1',
  type: 'prd',
  name: 'Task Manager PRD',
  createdAt: '2025-01-15T10:00:30Z',
};

const mockArtifactDetail = {
  ...mockArtifactSummary,
  content: { title: 'Task Manager', features: ['kanban'] },
  metadata: { version: 1 },
};

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerWorkflowCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockFormatRelativeTime.mockReset();
    mockPrintError.mockReset();
    mockListWorkflows.mockReset();
    mockGetWorkflow.mockReset();
    mockListRuns.mockReset();
    mockGetRun.mockReset();
    mockCreateRun.mockReset();
    mockGetRunLogs.mockReset();
    mockApproveRun.mockReset();
    mockRejectRun.mockReset();
    mockReviseRun.mockReset();
    mockListArtifacts.mockReset();
    mockGetArtifact.mockReset();
    mockGetActiveContext.mockReset();
    mockWriteFileSync.mockReset();

    // Default: auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // Default: active context with hyveId
    mockGetActiveContext.mockReturnValue(DEFAULT_CONTEXT);

    // truncate passthrough
    mockTruncate.mockImplementation((s: string) => s);

    // formatRelativeTime passthrough
    mockFormatRelativeTime.mockImplementation((s: string) => s);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the workflows command group on the program', () => {
      const program = new Command();
      registerWorkflowCommands(program);
      const workflows = program.commands.find((c) => c.name() === 'workflows');
      expect(workflows).toBeDefined();
    });

    it('registers all subcommands under workflows', () => {
      const program = new Command();
      registerWorkflowCommands(program);
      const workflows = program.commands.find((c) => c.name() === 'workflows')!;
      const subNames = workflows.commands.map((c) => c.name());

      expect(subNames).toContain('list');
      expect(subNames).toContain('info');
      expect(subNames).toContain('run');
      expect(subNames).toContain('status');
      expect(subNames).toContain('logs');
      expect(subNames).toContain('artifacts');
      expect(subNames).toContain('approve');
      expect(subNames).toContain('reject');
      expect(subNames).toContain('revise');
      expect(subNames).toContain('runs');
    });

    it('has artifacts sub-commands: list and get', () => {
      const program = new Command();
      registerWorkflowCommands(program);
      const workflows = program.commands.find((c) => c.name() === 'workflows')!;
      const artifacts = workflows.commands.find((c) => c.name() === 'artifacts')!;
      const subNames = artifacts.commands.map((c) => c.name());
      expect(subNames).toContain('list');
      expect(subNames).toContain('get');
    });
  });

  // ==========================================================================
  // AUTHENTICATION (shared behavior)
  // ==========================================================================

  describe('authentication', () => {
    it('returns early when auth fails for workflows list', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'list']);

      expect(mockListWorkflows).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows info', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'info', 'wf-1']);

      expect(mockGetWorkflow).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows run', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'run', 'wf-1']);

      expect(mockGetWorkflow).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows status', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'status', 'run_abc123']);

      expect(mockGetRun).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows logs', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'logs', 'run_abc123']);

      expect(mockGetRunLogs).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows approve', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'approve', 'run_abc123']);

      expect(mockApproveRun).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows reject', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'reject', 'run_abc123']);

      expect(mockRejectRun).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows artifacts list', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123']);

      expect(mockListArtifacts).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows artifacts get', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123']);

      expect(mockGetArtifact).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for workflows runs', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['workflows', 'runs']);

      expect(mockListRuns).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // resolveHyveId (tested through commands)
  // ==========================================================================

  describe('resolveHyveId', () => {
    it('uses --hyve flag when provided', async () => {
      mockListWorkflows.mockResolvedValue([]);

      await run(['workflows', 'list', '--hyve', 'app-builder']);

      expect(mockListWorkflows).toHaveBeenCalledWith('app-builder');
    });

    it('falls back to active context hyveId', async () => {
      mockListWorkflows.mockResolvedValue([]);

      await run(['workflows', 'list']);

      expect(mockListWorkflows).toHaveBeenCalledWith('landing-page');
    });

    it('shows error when no hyve and no context', async () => {
      mockGetActiveContext.mockReturnValue(null);

      await run(['workflows', 'list']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No hyve ID specified');
      expect(output).toContain('--hyve=<hyveId>');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockListWorkflows).not.toHaveBeenCalled();
    });

    it('shows error when context exists but has no hyveId', async () => {
      mockGetActiveContext.mockReturnValue({
        projectId: 'proj-123',
        projectName: 'My Project',
      });

      await run(['workflows', 'list']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No hyve ID specified');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockListWorkflows).not.toHaveBeenCalled();
    });

    it('prefers --hyve flag over active context', async () => {
      mockListWorkflows.mockResolvedValue([]);

      await run(['workflows', 'list', '--hyve', 'app-builder']);

      expect(mockListWorkflows).toHaveBeenCalledWith('app-builder');
      expect(mockGetActiveContext).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // WORKFLOWS LIST
  // ==========================================================================

  describe('workflows list', () => {
    it('lists workflows from active hyve context', async () => {
      mockListWorkflows.mockResolvedValue([mockWorkflowSummary]);

      await run(['workflows', 'list']);

      expect(mockListWorkflows).toHaveBeenCalledWith('landing-page');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflows for "landing-page"');
      expect(output).toContain('wf-1');
      expect(output).toContain('App Builder Workflow');
    });

    it('lists workflows from --hyve flag', async () => {
      mockListWorkflows.mockResolvedValue([mockWorkflowSummary]);

      await run(['workflows', 'list', '--hyve', 'app-builder']);

      expect(mockListWorkflows).toHaveBeenCalledWith('app-builder');
    });

    it('shows "no workflows found" message for empty results', async () => {
      mockListWorkflows.mockResolvedValue([]);

      await run(['workflows', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No workflows found for hyve "landing-page"');
      expect(output).toContain('Workflows are configured in the web app');
    });

    it('shows workflow table with correct columns', async () => {
      mockListWorkflows.mockResolvedValue([mockWorkflowSummary, mockWorkflowSummaryDisabled]);

      await run(['workflows', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('ID');
      expect(output).toContain('Name');
      expect(output).toContain('Nodes');
      expect(output).toContain('Triggers');
      expect(output).toContain('Status');
      expect(output).toContain('enabled');
      expect(output).toContain('disabled');
    });

    it('shows trigger types as comma-separated list', async () => {
      mockListWorkflows.mockResolvedValue([mockWorkflowSummary]);

      await run(['workflows', 'list']);

      // truncate is called on the trigger string
      expect(mockTruncate).toHaveBeenCalledWith('manual, chat-message', 18);
    });

    it('shows "none" for workflows with no triggers', async () => {
      mockListWorkflows.mockResolvedValue([
        { ...mockWorkflowSummary, triggerTypes: [] },
      ]);

      await run(['workflows', 'list']);

      expect(mockTruncate).toHaveBeenCalledWith('none', 18);
    });

    it('shows count in header', async () => {
      mockListWorkflows.mockResolvedValue([mockWorkflowSummary, mockWorkflowSummaryDisabled]);

      await run(['workflows', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('(2)');
    });

    it('outputs JSON format', async () => {
      const results = [mockWorkflowSummary];
      mockListWorkflows.mockResolvedValue(results);

      await run(['workflows', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(results);
    });

    it('calls printError on API failure', async () => {
      mockListWorkflows.mockRejectedValue(new Error('Network error'));

      await run(['workflows', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list workflows', expect.any(Error));
    });
  });

  // ==========================================================================
  // WORKFLOWS INFO
  // ==========================================================================

  describe('workflows info', () => {
    it('shows workflow detail with nodes, edges, triggers', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);

      await run(['workflows', 'info', 'wf-1']);

      expect(mockGetWorkflow).toHaveBeenCalledWith('landing-page', 'wf-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('App Builder Workflow');
      expect(output).toContain('ID:          wf-1');
      expect(output).toContain('Hyve:        landing-page');
      expect(output).toContain('Version:     2');
      expect(output).toContain('Status:      enabled');
      expect(output).toContain('Description: Creates apps');

      // Triggers
      expect(output).toContain('Triggers:');
      expect(output).toContain('manual');

      // Nodes
      expect(output).toContain('Nodes (2):');
      expect(output).toContain('[ai-generate] Generate PRD');
      expect(output).toContain('[approval] Review PRD');
      expect(output).toContain('[approval gate]');

      // Edges
      expect(output).toContain('Edges (1):');
      expect(output).toContain('node-1');
      expect(output).toContain('node-2');

      // Run hint
      expect(output).toContain('myndhyve-cli workflows run wf-1 --hyve=landing-page');
    });

    it('shows edge labels when present', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetailWithEdgeLabels);

      await run(['workflows', 'info', 'wf-1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('(on success)');
    });

    it('shows "not found" error for missing workflow', async () => {
      mockGetWorkflow.mockResolvedValue(null);

      await run(['workflows', 'info', 'wf-missing']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow "wf-missing" not found in hyve "landing-page"');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('shows disabled status', async () => {
      mockGetWorkflow.mockResolvedValue({ ...mockWorkflowDetail, enabled: false });

      await run(['workflows', 'info', 'wf-1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Status:      disabled');
    });

    it('omits description when not present', async () => {
      mockGetWorkflow.mockResolvedValue({
        ...mockWorkflowDetail,
        description: undefined,
      });

      await run(['workflows', 'info', 'wf-1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Description:');
    });

    it('outputs JSON format', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);

      await run(['workflows', 'info', 'wf-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(mockWorkflowDetail);
    });

    it('calls printError on API failure', async () => {
      mockGetWorkflow.mockRejectedValue(new Error('Timeout'));

      await run(['workflows', 'info', 'wf-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get workflow info', expect.any(Error));
    });

    it('uses --hyve flag for lookup', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);

      await run(['workflows', 'info', 'wf-1', '--hyve', 'app-builder']);

      expect(mockGetWorkflow).toHaveBeenCalledWith('app-builder', 'wf-1');
    });
  });

  // ==========================================================================
  // WORKFLOWS RUN
  // ==========================================================================

  describe('workflows run', () => {
    it('creates a run and shows run ID and status', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);
      mockCreateRun.mockResolvedValue(mockRunSummary);

      await run(['workflows', 'run', 'wf-1']);

      expect(mockGetWorkflow).toHaveBeenCalledWith('landing-page', 'wf-1');
      expect(mockCreateRun).toHaveBeenCalledWith('user-123', 'landing-page', 'wf-1', {
        inputData: undefined,
        triggerType: 'manual',
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow run created');
      expect(output).toContain('Run ID:     run_abc123');
      expect(output).toContain('Workflow:   App Builder Workflow');
      expect(output).toContain('Status:     running');
      expect(output).toContain('myndhyve-cli workflows status run_abc123 --hyve=landing-page');
      expect(output).toContain('myndhyve-cli workflows logs run_abc123 --hyve=landing-page');
    });

    it('passes parsed --input JSON to createRun', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);
      mockCreateRun.mockResolvedValue(mockRunSummary);

      await run(['workflows', 'run', 'wf-1', '--input', '{"topic":"AI chatbots"}']);

      expect(mockCreateRun).toHaveBeenCalledWith('user-123', 'landing-page', 'wf-1', {
        inputData: { topic: 'AI chatbots' },
        triggerType: 'manual',
      });
    });

    it('shows error for invalid JSON input', async () => {
      await run(['workflows', 'run', 'wf-1', '--input', 'not-json']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid JSON for --input flag');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockGetWorkflow).not.toHaveBeenCalled();
      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it('shows error for missing workflow', async () => {
      mockGetWorkflow.mockResolvedValue(null);

      await run(['workflows', 'run', 'wf-missing']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow "wf-missing" not found in hyve "landing-page"');
      expect(process.exitCode).toBe(3); // NOT_FOUND
      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it('shows error for disabled workflow', async () => {
      mockGetWorkflow.mockResolvedValue({ ...mockWorkflowDetail, enabled: false });

      await run(['workflows', 'run', 'wf-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow "wf-1" is disabled');
      expect(process.exitCode).toBe(1); // GENERAL_ERROR
      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);
      mockCreateRun.mockResolvedValue(mockRunSummary);

      await run(['workflows', 'run', 'wf-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(mockRunSummary);
    });

    it('calls printError on API failure during createRun', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);
      mockCreateRun.mockRejectedValue(new Error('Server error'));

      await run(['workflows', 'run', 'wf-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to trigger workflow run', expect.any(Error));
    });

    it('uses --hyve flag', async () => {
      mockGetWorkflow.mockResolvedValue(mockWorkflowDetail);
      mockCreateRun.mockResolvedValue(mockRunSummary);

      await run(['workflows', 'run', 'wf-1', '--hyve', 'app-builder']);

      expect(mockGetWorkflow).toHaveBeenCalledWith('app-builder', 'wf-1');
      expect(mockCreateRun).toHaveBeenCalledWith(
        'user-123',
        'app-builder',
        'wf-1',
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // WORKFLOWS STATUS
  // ==========================================================================

  describe('workflows status', () => {
    it('shows run status with progress bar', async () => {
      mockGetRun.mockResolvedValue(mockRunDetail);

      await run(['workflows', 'status', 'run_abc123']);

      expect(mockGetRun).toHaveBeenCalledWith('user-123', 'landing-page', 'run_abc123');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow Run: run_abc123');
      expect(output).toContain('Workflow:   App Builder Workflow');
      expect(output).toContain('Trigger:    manual');
      // Progress: 1/4 = 25%
      expect(output).toContain('25%');
      expect(output).toContain('1/4 nodes');
    });

    it('shows node states', async () => {
      mockGetRun.mockResolvedValue(mockRunDetail);

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Node Status:');
      expect(output).toContain('Generate PRD');
      expect(output).toContain('Generate Plan');
    });

    it('shows node error details', async () => {
      mockGetRun.mockResolvedValue(mockRunDetailWithError);

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Error:');
      expect(output).toContain('Node execution failed: timeout');
    });

    it('shows approval decision on node state', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        nodeStates: [
          {
            nodeId: 'node-1',
            status: 'completed',
            label: 'Review PRD',
            approval: { decision: 'approved', requestedAt: '2025-01-15T10:01:00Z' },
          },
        ],
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('approved');
    });

    it('shows approval hints when status is awaiting_approval', async () => {
      mockGetRun.mockResolvedValue(mockWaitingRunDetail);

      await run(['workflows', 'status', 'run_waiting123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('myndhyve-cli workflows approve run_waiting123 --hyve=landing-page');
      expect(output).toContain('myndhyve-cli workflows reject run_waiting123 --hyve=landing-page');
      expect(output).toContain('myndhyve-cli workflows revise run_waiting123');
    });

    it('does not show approval hints for non-waiting status', async () => {
      mockGetRun.mockResolvedValue(mockRunDetail);

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Approve:');
      expect(output).not.toContain('Reject:');
    });

    it('shows current node when available', async () => {
      mockGetRun.mockResolvedValue(mockRunDetailWithDuration);

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Current:    Generate Plan');
    });

    it('shows completed time and duration when present', async () => {
      mockGetRun.mockResolvedValue(mockRunDetailWithDuration);

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Completed:');
      expect(output).toContain('Duration:   5m 0s');
    });

    it('shows error for missing run', async () => {
      mockGetRun.mockResolvedValue(null);

      await run(['workflows', 'status', 'run_missing']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Run "run_missing" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('outputs JSON format', async () => {
      mockGetRun.mockResolvedValue(mockRunDetail);

      await run(['workflows', 'status', 'run_abc123', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(mockRunDetail);
    });

    it('calls printError on API failure', async () => {
      mockGetRun.mockRejectedValue(new Error('Forbidden'));

      await run(['workflows', 'status', 'run_abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get run status', expect.any(Error));
    });

    it('handles run with zero totalNodes', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        totalNodes: 0,
        progress: 0,
        nodeStates: [],
      });

      await run(['workflows', 'status', 'run_abc123']);

      // Should not crash, and should not show progress bar
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Progress:');
    });

    it('shows started time when present', async () => {
      mockGetRun.mockResolvedValue(mockRunDetail);

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Started:');
      expect(mockFormatRelativeTime).toHaveBeenCalledWith('2025-01-15T10:00:00Z');
    });
  });

  // ==========================================================================
  // WORKFLOWS LOGS
  // ==========================================================================

  describe('workflows logs', () => {
    it('shows logs with timestamp, level, and message', async () => {
      mockGetRunLogs.mockResolvedValue(mockLogEntries);

      await run(['workflows', 'logs', 'run_abc123']);

      expect(mockGetRunLogs).toHaveBeenCalledWith('user-123', 'landing-page', 'run_abc123');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Run Logs');
      expect(output).toContain('run_abc123');
      expect(output).toContain('Starting PRD generation');
      expect(output).toContain('PRD generation complete');
    });

    it('shows log entry count in header', async () => {
      mockGetRunLogs.mockResolvedValue(mockLogEntries);

      await run(['workflows', 'logs', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('2/2 entries');
    });

    it('shows node label prefix in log entries', async () => {
      mockGetRunLogs.mockResolvedValue(mockLogEntries);

      await run(['workflows', 'logs', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      // First entry has nodeLabel, second has nodeId only
      expect(output).toContain('[Generate PRD]');
    });

    it('falls back to nodeId when nodeLabel is absent', async () => {
      mockGetRunLogs.mockResolvedValue([
        {
          timestamp: '2025-01-15T10:00:30Z',
          level: 'info',
          nodeId: 'node-1',
          message: 'Some log',
        },
      ]);

      await run(['workflows', 'logs', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('[node-1]');
    });

    it('shows "no logs found" for empty logs', async () => {
      mockGetRunLogs.mockResolvedValue([]);

      await run(['workflows', 'logs', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No logs found for run "run_abc123"');
    });

    it('shows error for missing run', async () => {
      mockGetRunLogs.mockResolvedValue(null);

      await run(['workflows', 'logs', 'run_missing']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Run "run_missing" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('respects --limit flag', async () => {
      const manyLogs = Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2025-01-15T10:00:${String(i).padStart(2, '0')}Z`,
        level: 'info',
        nodeId: `node-${i}`,
        message: `Log entry ${i}`,
      }));
      mockGetRunLogs.mockResolvedValue(manyLogs);

      await run(['workflows', 'logs', 'run_abc123', '--limit', '3']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('3/10 entries');
      expect(output).toContain('Log entry 0');
      expect(output).toContain('Log entry 2');
      expect(output).not.toContain('Log entry 3');
      expect(output).toContain('7 more entries (use --limit to see more)');
    });

    it('does not show "more entries" message when all are shown', async () => {
      mockGetRunLogs.mockResolvedValue(mockLogEntries);

      await run(['workflows', 'logs', 'run_abc123', '--limit', '100']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('more entries');
    });

    it('outputs JSON format', async () => {
      mockGetRunLogs.mockResolvedValue(mockLogEntries);

      await run(['workflows', 'logs', 'run_abc123', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(mockLogEntries);
    });

    it('calls printError on API failure', async () => {
      mockGetRunLogs.mockRejectedValue(new Error('Internal error'));

      await run(['workflows', 'logs', 'run_abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get run logs', expect.any(Error));
    });

    it('does not show node prefix for entries without nodeId', async () => {
      mockGetRunLogs.mockResolvedValue([
        {
          timestamp: '2025-01-15T10:00:00Z',
          level: 'info',
          message: 'Workflow started',
        },
      ]);

      await run(['workflows', 'logs', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow started');
      expect(output).not.toContain('[');
    });
  });

  // ==========================================================================
  // WORKFLOWS ARTIFACTS LIST
  // ==========================================================================

  describe('workflows artifacts list', () => {
    it('lists artifacts with table', async () => {
      mockListArtifacts.mockResolvedValue([mockArtifactSummary]);

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123']);

      expect(mockListArtifacts).toHaveBeenCalledWith('run_abc123', {
        limit: 50,
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Artifacts (1)');
      expect(output).toContain('ID');
      expect(output).toContain('Name');
      expect(output).toContain('Type');
      expect(output).toContain('Run');
      expect(output).toContain('Created');
    });

    it('respects --limit flag', async () => {
      mockListArtifacts.mockResolvedValue([]);

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123', '--limit', '10']);

      expect(mockListArtifacts).toHaveBeenCalledWith('run_abc123', {
        limit: 10,
      });
    });

    it('shows "no artifacts found" for empty results', async () => {
      mockListArtifacts.mockResolvedValue([]);

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No artifacts found');
      expect(output).toContain('Artifacts are generated when workflows produce output');
    });

    it('shows dash for missing createdAt', async () => {
      mockListArtifacts.mockResolvedValue([
        { ...mockArtifactSummary, createdAt: undefined },
      ]);

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123']);

      // Should not call formatRelativeTime for undefined createdAt
      // (it uses the em-dash fallback)
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Artifacts (1)');
    });

    it('outputs JSON format', async () => {
      const results = [mockArtifactSummary];
      mockListArtifacts.mockResolvedValue(results);

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(results);
    });

    it('calls printError on API failure', async () => {
      mockListArtifacts.mockRejectedValue(new Error('Forbidden'));

      await run(['workflows', 'artifacts', 'list', '--run', 'run_abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list artifacts', expect.any(Error));
    });
  });

  // ==========================================================================
  // WORKFLOWS ARTIFACTS GET
  // ==========================================================================

  describe('workflows artifacts get', () => {
    it('prints artifact as JSON to stdout', async () => {
      mockGetArtifact.mockResolvedValue(mockArtifactDetail);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123']);

      expect(mockGetArtifact).toHaveBeenCalledWith('run_abc123', 'art-1');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(mockArtifactDetail);
    });

    it('writes to file with --output flag', async () => {
      mockGetArtifact.mockResolvedValue(mockArtifactDetail);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123', '--output', '/tmp/out.json']);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/tmp/out.json',
        expect.any(String),
        'utf-8'
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Artifact "Task Manager PRD" written to /tmp/out.json');
      expect(output).toContain('Type: prd');
      expect(output).toContain('bytes');
    });

    it('writes content (not full artifact) to file', async () => {
      mockGetArtifact.mockResolvedValue(mockArtifactDetail);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123', '--output', '/tmp/out.json']);

      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      // When writing to file, it serializes content (or metadata)
      expect(parsed).toEqual(mockArtifactDetail.content);
    });

    it('shows error for missing artifact', async () => {
      mockGetArtifact.mockResolvedValue(null);

      await run(['workflows', 'artifacts', 'get', 'art-missing', '--run', 'run_abc123']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Artifact "art-missing" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('prints raw content when --format raw', async () => {
      mockGetArtifact.mockResolvedValue(mockArtifactDetail);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123', '--format', 'raw']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      // raw format prints content only, not the full artifact
      expect(parsed).toEqual(mockArtifactDetail.content);
    });

    it('falls back to metadata when content is missing', async () => {
      const artifactNoContent = {
        ...mockArtifactSummary,
        content: undefined,
        metadata: { version: 1 },
      };
      mockGetArtifact.mockResolvedValue(artifactNoContent);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123', '--format', 'raw']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ version: 1 });
    });

    it('falls back to empty object when both content and metadata are missing', async () => {
      const artifactEmpty = {
        ...mockArtifactSummary,
        content: undefined,
        metadata: undefined,
      };
      mockGetArtifact.mockResolvedValue(artifactEmpty);

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123', '--format', 'raw']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({});
    });

    it('calls printError on API failure', async () => {
      mockGetArtifact.mockRejectedValue(new Error('Not found'));

      await run(['workflows', 'artifacts', 'get', 'art-1', '--run', 'run_abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get artifact', expect.any(Error));
    });
  });

  // ==========================================================================
  // WORKFLOWS APPROVE
  // ==========================================================================

  describe('workflows approve', () => {
    it('shows success message', async () => {
      mockApproveRun.mockResolvedValue({ ...mockRunDetail, status: 'running' });

      await run(['workflows', 'approve', 'run_waiting123']);

      expect(mockApproveRun).toHaveBeenCalledWith(
        'user-123',
        'landing-page',
        'run_waiting123',
        undefined
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Run "run_waiting123" approved');
      expect(output).toContain('Status: running');
    });

    it('passes --feedback to API', async () => {
      mockApproveRun.mockResolvedValue({ ...mockRunDetail, status: 'running' });

      await run(['workflows', 'approve', 'run_waiting123', '--feedback', 'Looks good']);

      expect(mockApproveRun).toHaveBeenCalledWith(
        'user-123',
        'landing-page',
        'run_waiting123',
        'Looks good'
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Feedback: Looks good');
    });

    it('does not show feedback line when no feedback', async () => {
      mockApproveRun.mockResolvedValue({ ...mockRunDetail, status: 'running' });

      await run(['workflows', 'approve', 'run_waiting123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Feedback:');
    });

    it('outputs JSON format', async () => {
      const result = { ...mockRunDetail, status: 'running' };
      mockApproveRun.mockResolvedValue(result);

      await run(['workflows', 'approve', 'run_waiting123', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('calls printError on API failure', async () => {
      mockApproveRun.mockRejectedValue(new Error('Run is not waiting for approval'));

      await run(['workflows', 'approve', 'run_abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to approve run', expect.any(Error));
    });

    it('uses --hyve flag', async () => {
      mockApproveRun.mockResolvedValue({ ...mockRunDetail, status: 'running' });

      await run(['workflows', 'approve', 'run_waiting123', '--hyve', 'app-builder']);

      expect(mockApproveRun).toHaveBeenCalledWith(
        'user-123',
        'app-builder',
        'run_waiting123',
        undefined
      );
    });
  });

  // ==========================================================================
  // WORKFLOWS REJECT
  // ==========================================================================

  describe('workflows reject', () => {
    it('shows success message', async () => {
      mockRejectRun.mockResolvedValue({ ...mockRunDetail, status: 'failed' });

      await run(['workflows', 'reject', 'run_waiting123']);

      expect(mockRejectRun).toHaveBeenCalledWith(
        'user-123',
        'landing-page',
        'run_waiting123',
        undefined
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Run "run_waiting123" rejected');
      expect(output).toContain('Status: failed');
    });

    it('passes --reason to API', async () => {
      mockRejectRun.mockResolvedValue({ ...mockRunDetail, status: 'failed' });

      await run(['workflows', 'reject', 'run_waiting123', '--reason', 'Needs more detail']);

      expect(mockRejectRun).toHaveBeenCalledWith(
        'user-123',
        'landing-page',
        'run_waiting123',
        'Needs more detail'
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Reason: Needs more detail');
    });

    it('does not show reason line when no reason', async () => {
      mockRejectRun.mockResolvedValue({ ...mockRunDetail, status: 'failed' });

      await run(['workflows', 'reject', 'run_waiting123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Reason:');
    });

    it('outputs JSON format', async () => {
      const result = { ...mockRunDetail, status: 'failed' };
      mockRejectRun.mockResolvedValue(result);

      await run(['workflows', 'reject', 'run_waiting123', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('calls printError on API failure', async () => {
      mockRejectRun.mockRejectedValue(new Error('Not authorized'));

      await run(['workflows', 'reject', 'run_abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to reject run', expect.any(Error));
    });
  });

  // ==========================================================================
  // WORKFLOWS REVISE
  // ==========================================================================

  describe('workflows revise', () => {
    it('shows success message with feedback', async () => {
      mockReviseRun.mockResolvedValue({ ...mockRunDetail, status: 'running' });

      await run(['workflows', 'revise', 'run_waiting123', '--feedback', 'Add more sections']);

      expect(mockReviseRun).toHaveBeenCalledWith(
        'user-123',
        'landing-page',
        'run_waiting123',
        'Add more sections'
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Revisions requested for run "run_waiting123"');
      expect(output).toContain('Status:   running');
      expect(output).toContain('Feedback: Add more sections');
    });

    it('requires --feedback flag', async () => {
      // Commander should reject missing required option
      try {
        await run(['workflows', 'revise', 'run_waiting123']);
        // If commander throws, we won't get here
      } catch {
        // Commander's exitOverride throws on missing required option
      }

      expect(mockReviseRun).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      const result = { ...mockRunDetail, status: 'running' };
      mockReviseRun.mockResolvedValue(result);

      await run([
        'workflows', 'revise', 'run_waiting123',
        '--feedback', 'Revise the intro',
        '--format', 'json',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('calls printError on API failure', async () => {
      mockReviseRun.mockRejectedValue(new Error('Run not found'));

      await run(['workflows', 'revise', 'run_abc123', '--feedback', 'Fix it']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to request revisions', expect.any(Error));
    });
  });

  // ==========================================================================
  // WORKFLOWS RUNS (list runs)
  // ==========================================================================

  describe('workflows runs', () => {
    it('lists runs with table', async () => {
      mockListRuns.mockResolvedValue([mockRunSummary]);

      await run(['workflows', 'runs']);

      expect(mockListRuns).toHaveBeenCalledWith('user-123', 'landing-page', {
        status: undefined,
        workflowId: undefined,
        limit: 25,
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow Runs (1)');
      expect(output).toContain('Run ID');
      expect(output).toContain('Workflow');
      expect(output).toContain('Status');
      expect(output).toContain('Progress');
      expect(output).toContain('Started');
    });

    it('shows run data in table rows', async () => {
      mockListRuns.mockResolvedValue([mockRunSummary]);

      await run(['workflows', 'runs']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('run_abc123');
      expect(output).toContain('1/4');
    });

    it('shows dash for progress when totalNodes is 0', async () => {
      mockListRuns.mockResolvedValue([
        { ...mockRunSummary, totalNodes: 0, progress: 0 },
      ]);

      await run(['workflows', 'runs']);

      // The code uses em-dash (\u2014) when totalNodes === 0
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('\u2014');
    });

    it('shows dash for missing startedAt', async () => {
      mockListRuns.mockResolvedValue([
        { ...mockRunSummary, startedAt: undefined },
      ]);

      await run(['workflows', 'runs']);

      // formatRelativeTime should not be called
      // em-dash is used as fallback
      expect(mockFormatRelativeTime).not.toHaveBeenCalled();
    });

    it('uses workflowId as fallback when workflowName is missing', async () => {
      mockListRuns.mockResolvedValue([
        { ...mockRunSummary, workflowName: undefined },
      ]);

      await run(['workflows', 'runs']);

      expect(mockTruncate).toHaveBeenCalledWith('wf-1', 18);
    });

    it('shows empty message when no runs found', async () => {
      mockListRuns.mockResolvedValue([]);

      await run(['workflows', 'runs']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No workflow runs found');
      expect(output).toContain('myndhyve-cli workflows run <workflow-id>');
    });

    it('filters by --status', async () => {
      mockListRuns.mockResolvedValue([]);

      await run(['workflows', 'runs', '--status', 'completed']);

      expect(mockListRuns).toHaveBeenCalledWith('user-123', 'landing-page', {
        status: 'completed',
        workflowId: undefined,
        limit: 25,
      });
    });

    it('validates status against known values', async () => {
      await run(['workflows', 'runs', '--status', 'invalid-status']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown run status "invalid-status"');
      expect(output).toContain('Valid statuses:');
      expect(output).toContain('pending');
      expect(output).toContain('running');
      expect(output).toContain('completed');
      expect(output).toContain('failed');
      expect(output).toContain('awaiting_approval');
      expect(process.exitCode).toBe(2);
      expect(mockListRuns).not.toHaveBeenCalled();
    });

    it('accepts all valid status values', async () => {
      const validStatuses = [
        'pending', 'running', 'awaiting_approval',
        'completed', 'failed', 'cancelled',
      ];

      for (const status of validStatuses) {
        mockListRuns.mockReset();
        mockListRuns.mockResolvedValue([]);
        process.exitCode = undefined;

        await run(['workflows', 'runs', '--status', status]);

        expect(mockListRuns).toHaveBeenCalledWith('user-123', 'landing-page', {
          status,
          workflowId: undefined,
          limit: 25,
        });
      }
    });

    it('filters by --workflow', async () => {
      mockListRuns.mockResolvedValue([]);

      await run(['workflows', 'runs', '--workflow', 'wf-1']);

      expect(mockListRuns).toHaveBeenCalledWith('user-123', 'landing-page', {
        status: undefined,
        workflowId: 'wf-1',
        limit: 25,
      });
    });

    it('passes --limit to API', async () => {
      mockListRuns.mockResolvedValue([]);

      await run(['workflows', 'runs', '--limit', '10']);

      expect(mockListRuns).toHaveBeenCalledWith('user-123', 'landing-page', {
        status: undefined,
        workflowId: undefined,
        limit: 10,
      });
    });

    it('combines multiple filters', async () => {
      mockListRuns.mockResolvedValue([]);

      await run([
        'workflows', 'runs',
        '--status', 'running',
        '--workflow', 'wf-1',
        '--limit', '5',
      ]);

      expect(mockListRuns).toHaveBeenCalledWith('user-123', 'landing-page', {
        status: 'running',
        workflowId: 'wf-1',
        limit: 5,
      });
    });

    it('outputs JSON format', async () => {
      const results = [mockRunSummary];
      mockListRuns.mockResolvedValue(results);

      await run(['workflows', 'runs', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(results);
    });

    it('calls printError on API failure', async () => {
      mockListRuns.mockRejectedValue(new Error('Timeout'));

      await run(['workflows', 'runs']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list runs', expect.any(Error));
    });
  });

  // ==========================================================================
  // FORMAT HELPERS (tested indirectly through commands)
  // ==========================================================================

  describe('format helpers (indirectly tested)', () => {
    it('formatRunStatus shows correct icons for different statuses', async () => {
      // Test several statuses by rendering them through the status command
      const statuses = ['pending', 'running', 'completed', 'failed', 'awaiting_approval'];

      for (const status of statuses) {
        consoleSpy.mockClear();
        mockGetRun.mockReset();
        mockGetRun.mockResolvedValue({
          ...mockRunDetail,
          status,
          nodeStates: [],
          totalNodes: 0,
        });

        await run(['workflows', 'status', 'run_abc123']);

        const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
        expect(output).toContain('Status:');
      }
    });

    it('formatDuration handles milliseconds', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        durationMs: 500,
        nodeStates: [],
        totalNodes: 0,
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Duration:   500ms');
    });

    it('formatDuration handles seconds', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        durationMs: 45000,
        nodeStates: [],
        totalNodes: 0,
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Duration:   45s');
    });

    it('formatDuration handles minutes and seconds', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        durationMs: 125000,
        nodeStates: [],
        totalNodes: 0,
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Duration:   2m 5s');
    });

    it('formatDuration handles hours and minutes', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        durationMs: 3_720_000, // 1h 2m
        nodeStates: [],
        totalNodes: 0,
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Duration:   1h 2m');
    });

    it('buildProgressBar shows correct fill at 0%', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        progress: 0,
        totalNodes: 4,
        nodeStates: [],
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('0%');
      expect(output).toContain('0/4 nodes');
    });

    it('buildProgressBar shows correct fill at 100%', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        status: 'completed',
        progress: 4,
        totalNodes: 4,
        nodeStates: [],
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('100%');
      expect(output).toContain('4/4 nodes');
    });

    it('getStatusIcon returns correct icons for node states', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        nodeStates: [
          { nodeId: 'n1', status: 'completed', label: 'Step 1' },
          { nodeId: 'n2', status: 'running', label: 'Step 2' },
          { nodeId: 'n3', status: 'failed', label: 'Step 3' },
          { nodeId: 'n4', status: 'pending', label: 'Step 4' },
          { nodeId: 'n5', status: 'skipped', label: 'Step 5' },
          { nodeId: 'n6', status: 'awaiting_approval', label: 'Step 6' },
        ],
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      // Check that all 6 node labels appear
      expect(output).toContain('Step 1');
      expect(output).toContain('Step 2');
      expect(output).toContain('Step 3');
      expect(output).toContain('Step 4');
      expect(output).toContain('Step 5');
      expect(output).toContain('Step 6');
      // Check some icons
      expect(output).toContain('\u2713'); // completed checkmark
      expect(output).toContain('\u25cf'); // running filled circle
      expect(output).toContain('\u2717'); // failed X
    });

    it('node state falls back to nodeId when label is missing', async () => {
      mockGetRun.mockResolvedValue({
        ...mockRunDetail,
        nodeStates: [
          { nodeId: 'n1', status: 'completed' },
        ],
      });

      await run(['workflows', 'status', 'run_abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('n1');
    });
  });
});
