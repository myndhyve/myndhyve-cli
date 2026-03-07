import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockTruncate,
  mockPrintError,
  mockListAgents,
  mockGetAgent,
  mockCreateAgent,
  mockUpdateAgent,
  mockToggleAgent,
  mockDeleteAgent,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockPrintError: vi.fn(),
  mockListAgents: vi.fn(),
  mockGetAgent: vi.fn(),
  mockCreateAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockToggleAgent: vi.fn(),
  mockDeleteAgent: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/agents.js', () => ({
  listAgents: (...args: unknown[]) => mockListAgents(...args),
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  toggleAgent: (...args: unknown[]) => mockToggleAgent(...args),
  deleteAgent: (...args: unknown[]) => mockDeleteAgent(...args),
  DEFAULT_MODEL_CONFIG: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 0.9,
  },
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: (...args: unknown[]) => {
    const err = args[0] as { code: string; message: string; suggestion?: string };
    process.stderr.write(`\n  Error: ${err.message}\n`);
    if (err.suggestion) process.stderr.write(`  ${err.suggestion}\n`);
    process.stderr.write('\n');
  },
}));

import { registerAgentCommands } from '../agents.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

const SAMPLE_AGENT_SUMMARY = {
  id: 'agent-abc123',
  hyveId: 'app-builder',
  name: 'Build Agent',
  description: 'Builds things',
  enabled: true,
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  workflowCount: 2,
  tags: ['dev', 'build'],
};

const SAMPLE_AGENT_SUMMARY_2 = {
  id: 'agent-xyz789',
  hyveId: 'landing-page',
  name: 'LP Agent',
  description: 'Landing page helper',
  enabled: false,
  provider: 'openai',
  modelId: 'gpt-4o',
  workflowCount: 0,
  tags: [],
};

const SAMPLE_AGENT_DETAIL = {
  id: 'agent-abc123',
  hyveId: 'app-builder',
  name: 'Build Agent',
  description: 'Builds things',
  enabled: true,
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  workflowCount: 2,
  tags: ['dev', 'build'],
  ownerId: 'user_abc',
  systemPromptId: 'prompt-sys-1',
  model: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
  workflowIds: ['wf-1', 'wf-2'],
  envelopeTypes: ['text', 'json'],
  schedule: { cron: '0 9 * * *', timezone: 'America/New_York' },
  kanbanAccess: { boardIds: ['board-1', 'board-2'], canAutoRun: true, maxConcurrent: 3 },
};

const SAMPLE_AGENT_DETAIL_MINIMAL = {
  id: 'agent-min',
  hyveId: 'app-builder',
  name: 'Minimal Agent',
  description: '',
  enabled: false,
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  workflowCount: 0,
  tags: [],
  ownerId: 'user_abc',
  systemPromptId: '',
  model: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
  workflowIds: [],
  envelopeTypes: [],
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerAgentCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerAgentCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockPrintError.mockReset();
    mockListAgents.mockReset();
    mockGetAgent.mockReset();
    mockCreateAgent.mockReset();
    mockUpdateAgent.mockReset();
    mockToggleAgent.mockReset();
    mockDeleteAgent.mockReset();

    // Default: auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // truncate passthrough
    mockTruncate.mockImplementation((s: string) => s);

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
    it('registers the agents command group on the program', () => {
      const program = new Command();
      registerAgentCommands(program);
      const agents = program.commands.find((c) => c.name() === 'agents');
      expect(agents).toBeDefined();
    });

    it('registers all subcommands under agents', () => {
      const program = new Command();
      registerAgentCommands(program);
      const agents = program.commands.find((c) => c.name() === 'agents')!;
      const subNames = agents.commands.map((c) => c.name());

      expect(subNames).toContain('list');
      expect(subNames).toContain('info');
      expect(subNames).toContain('create');
      expect(subNames).toContain('update');
      expect(subNames).toContain('enable');
      expect(subNames).toContain('disable');
      expect(subNames).toContain('delete');
    });
  });

  // ==========================================================================
  // AGENTS LIST
  // ==========================================================================

  describe('agents list', () => {
    it('shows agents in table format', async () => {
      mockListAgents.mockResolvedValue([SAMPLE_AGENT_SUMMARY, SAMPLE_AGENT_SUMMARY_2]);

      await run(['agents', 'list']);

      expect(mockListAgents).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        enabled: undefined,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agents (2)');
      expect(output).toContain('agent-abc123');
      expect(output).toContain('Build Agent');
      expect(output).toContain('agent-xyz789');
    });

    it('outputs JSON format', async () => {
      const agents = [SAMPLE_AGENT_SUMMARY];
      mockListAgents.mockResolvedValue(agents);

      await run(['agents', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(agents);
    });

    it('shows helpful hint when empty', async () => {
      mockListAgents.mockResolvedValue([]);

      await run(['agents', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No agents found');
      expect(output).toContain('myndhyve-cli agents create');
    });

    it('passes --hyve filter to API', async () => {
      mockListAgents.mockResolvedValue([]);

      await run(['agents', 'list', '--hyve', 'app-builder']);

      expect(mockListAgents).toHaveBeenCalledWith('user_abc', {
        hyveId: 'app-builder',
        enabled: undefined,
      });
    });

    it('passes --enabled filter to API', async () => {
      mockListAgents.mockResolvedValue([]);

      await run(['agents', 'list', '--enabled']);

      expect(mockListAgents).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        enabled: true,
      });
    });

    it('passes --disabled filter to API', async () => {
      mockListAgents.mockResolvedValue([]);

      await run(['agents', 'list', '--disabled']);

      expect(mockListAgents).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        enabled: false,
      });
    });

    it('shows enabled/disabled status indicator', async () => {
      mockListAgents.mockResolvedValue([SAMPLE_AGENT_SUMMARY, SAMPLE_AGENT_SUMMARY_2]);

      await run(['agents', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('enabled');
      expect(output).toContain('disabled');
    });

    it('calls truncate on agent fields', async () => {
      mockListAgents.mockResolvedValue([SAMPLE_AGENT_SUMMARY]);

      await run(['agents', 'list']);

      expect(mockTruncate).toHaveBeenCalledWith('agent-abc123', 22);
      expect(mockTruncate).toHaveBeenCalledWith('Build Agent', 20);
      expect(mockTruncate).toHaveBeenCalledWith('app-builder', 14);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'list']);

      expect(mockListAgents).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockListAgents.mockRejectedValue(new Error('Network error'));

      await run(['agents', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list agents', expect.any(Error));
    });
  });

  // ==========================================================================
  // AGENTS INFO
  // ==========================================================================

  describe('agents info', () => {
    it('shows detailed agent information with all fields', async () => {
      mockGetAgent.mockResolvedValue(SAMPLE_AGENT_DETAIL);

      await run(['agents', 'info', 'agent-abc123']);

      expect(mockGetAgent).toHaveBeenCalledWith('user_abc', 'agent-abc123');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Build Agent');
      expect(output).toContain('ID:            agent-abc123');
      expect(output).toContain('Hyve:          app-builder');
      expect(output).toContain('Status:        Enabled');
      expect(output).toContain('Provider:      anthropic');
      expect(output).toContain('Model:         claude-sonnet-4-20250514');
      expect(output).toContain('Temperature:   0.7');
      expect(output).toContain('Max Tokens:    4096');
      expect(output).toContain('Prompt ID:     prompt-sys-1');
      expect(output).toContain('Workflows:     wf-1, wf-2');
      expect(output).toContain('Envelopes:     text, json');
      expect(output).toContain('Tags:          dev, build');
    });

    it('shows schedule info when present', async () => {
      mockGetAgent.mockResolvedValue(SAMPLE_AGENT_DETAIL);

      await run(['agents', 'info', 'agent-abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Schedule:      0 9 * * * (America/New_York)');
    });

    it('shows kanban access info when present', async () => {
      mockGetAgent.mockResolvedValue(SAMPLE_AGENT_DETAIL);

      await run(['agents', 'info', 'agent-abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Kanban Boards: board-1, board-2');
      expect(output).toContain('Auto-Run:      Yes');
      expect(output).toContain('Max Concurrent: 3');
    });

    it('shows dashes for empty optional fields', async () => {
      mockGetAgent.mockResolvedValue(SAMPLE_AGENT_DETAIL_MINIMAL);

      await run(['agents', 'info', 'agent-min']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Description:   -');
      expect(output).toContain('Prompt ID:     -');
      expect(output).toContain('Workflows:     -');
      expect(output).toContain('Envelopes:     -');
      expect(output).toContain('Tags:          -');
      expect(output).toContain('Status:        Disabled');
    });

    it('shows fallback models when present', async () => {
      const agentWithFallbacks = {
        ...SAMPLE_AGENT_DETAIL,
        model: {
          ...SAMPLE_AGENT_DETAIL.model,
          fallbackModels: [
            { provider: 'openai', modelId: 'gpt-4o', condition: 'rate_limit' },
          ],
        },
      };
      mockGetAgent.mockResolvedValue(agentWithFallbacks);

      await run(['agents', 'info', 'agent-abc123']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Fallbacks:');
      expect(output).toContain('openai/gpt-4o (on rate_limit)');
    });

    it('sets NOT_FOUND exitCode when agent not found', async () => {
      mockGetAgent.mockResolvedValue(null);

      await run(['agents', 'info', 'nonexistent']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agent "nonexistent" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('outputs JSON format', async () => {
      mockGetAgent.mockResolvedValue(SAMPLE_AGENT_DETAIL);

      await run(['agents', 'info', 'agent-abc123', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_AGENT_DETAIL);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'info', 'agent-abc123']);

      expect(mockGetAgent).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetAgent.mockRejectedValue(new Error('Timeout'));

      await run(['agents', 'info', 'agent-abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get agent details', expect.any(Error));
    });
  });

  // ==========================================================================
  // AGENTS CREATE
  // ==========================================================================

  describe('agents create', () => {
    it('creates agent with required options', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'New Agent',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run(['agents', 'create', '--hyve', 'app-builder', '--name', 'New Agent']);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.stringMatching(/^agent-/),
        expect.objectContaining({
          hyveId: 'app-builder',
          name: 'New Agent',
          model: expect.objectContaining({
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            temperature: 0.7,
            maxTokens: 4096,
          }),
          workflowIds: [],
          tags: [],
        })
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agent created');
      expect(output).toContain('New Agent');
    });

    it('passes custom provider and model options', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'GPT Agent',
        hyveId: 'landing-page',
        model: { provider: 'openai', modelId: 'gpt-4o' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'landing-page',
        '--name', 'GPT Agent',
        '--provider', 'openai',
        '--model', 'gpt-4o',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'openai',
            modelId: 'gpt-4o',
          }),
        })
      );
    });

    it('parses --temperature as a number', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'Hot Agent',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'Hot Agent',
        '--temperature', '0.9',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          model: expect.objectContaining({ temperature: 0.9 }),
        })
      );
    });

    it('falls back to default temperature on NaN', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'Bad Temp',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'Bad Temp',
        '--temperature', 'notanumber',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          model: expect.objectContaining({ temperature: 0.7 }),
        })
      );
    });

    it('parses --max-tokens as a number', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'Big Agent',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'Big Agent',
        '--max-tokens', '8192',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          model: expect.objectContaining({ maxTokens: 8192 }),
        })
      );
    });

    it('falls back to default maxTokens on NaN', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'Bad Tokens',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'Bad Tokens',
        '--max-tokens', 'abc',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          model: expect.objectContaining({ maxTokens: 4096 }),
        })
      );
    });

    it('parses --workflows as comma-separated list', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'WF Agent',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'WF Agent',
        '--workflows', 'wf-1, wf-2,wf-3',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          workflowIds: ['wf-1', 'wf-2', 'wf-3'],
        })
      );
    });

    it('parses --tags as comma-separated list', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'Tagged',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'Tagged',
        '--tags', 'alpha, beta ,gamma',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          tags: ['alpha', 'beta', 'gamma'],
        })
      );
    });

    it('passes --prompt-id to createAgent', async () => {
      mockCreateAgent.mockResolvedValue({
        id: 'agent-new',
        name: 'Prompted',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      });

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'Prompted',
        '--prompt-id', 'my-prompt',
      ]);

      expect(mockCreateAgent).toHaveBeenCalledWith(
        'user_abc',
        expect.any(String),
        expect.objectContaining({
          systemPromptId: 'my-prompt',
        })
      );
    });

    it('outputs JSON format on create', async () => {
      const created = {
        id: 'agent-new',
        name: 'JSON Agent',
        hyveId: 'app-builder',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
      };
      mockCreateAgent.mockResolvedValue(created);

      await run([
        'agents', 'create',
        '--hyve', 'app-builder',
        '--name', 'JSON Agent',
        '--format', 'json',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(created);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'create', '--hyve', 'app-builder', '--name', 'No Auth']);

      expect(mockCreateAgent).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockCreateAgent.mockRejectedValue(new Error('Quota exceeded'));

      await run(['agents', 'create', '--hyve', 'app-builder', '--name', 'Fail Agent']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to create agent', expect.any(Error));
    });
  });

  // ==========================================================================
  // AGENTS UPDATE
  // ==========================================================================

  describe('agents update', () => {
    it('updates agent with valid JSON data', async () => {
      mockUpdateAgent.mockResolvedValue({ id: 'agent-abc123', name: 'Updated' });

      await run(['agents', 'update', 'agent-abc123', '--data', '{"name":"Updated"}']);

      expect(mockUpdateAgent).toHaveBeenCalledWith('user_abc', 'agent-abc123', { name: 'Updated' });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agent "agent-abc123" updated');
    });

    it('sets USAGE_ERROR exitCode on invalid JSON', async () => {
      await run(['agents', 'update', 'agent-abc123', '--data', '{not-valid-json}']);

      expect(mockUpdateAgent).not.toHaveBeenCalled();
      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid JSON');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
    });

    it('outputs JSON format on update', async () => {
      const updated = { id: 'agent-abc123', name: 'Updated' };
      mockUpdateAgent.mockResolvedValue(updated);

      await run(['agents', 'update', 'agent-abc123', '--data', '{"name":"Updated"}', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(updated);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'update', 'agent-abc123', '--data', '{"name":"x"}']);

      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockUpdateAgent.mockRejectedValue(new Error('Server error'));

      await run(['agents', 'update', 'agent-abc123', '--data', '{"name":"x"}']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to update agent', expect.any(Error));
    });
  });

  // ==========================================================================
  // AGENTS ENABLE
  // ==========================================================================

  describe('agents enable', () => {
    it('calls toggleAgent with true', async () => {
      mockToggleAgent.mockResolvedValue({ id: 'agent-abc123', enabled: true });

      await run(['agents', 'enable', 'agent-abc123']);

      expect(mockToggleAgent).toHaveBeenCalledWith('user_abc', 'agent-abc123', true);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agent "agent-abc123" enabled');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'enable', 'agent-abc123']);

      expect(mockToggleAgent).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockToggleAgent.mockRejectedValue(new Error('Not found'));

      await run(['agents', 'enable', 'agent-abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to enable agent', expect.any(Error));
    });
  });

  // ==========================================================================
  // AGENTS DISABLE
  // ==========================================================================

  describe('agents disable', () => {
    it('calls toggleAgent with false', async () => {
      mockToggleAgent.mockResolvedValue({ id: 'agent-abc123', enabled: false });

      await run(['agents', 'disable', 'agent-abc123']);

      expect(mockToggleAgent).toHaveBeenCalledWith('user_abc', 'agent-abc123', false);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agent "agent-abc123" disabled');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'disable', 'agent-abc123']);

      expect(mockToggleAgent).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockToggleAgent.mockRejectedValue(new Error('Forbidden'));

      await run(['agents', 'disable', 'agent-abc123']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to disable agent', expect.any(Error));
    });
  });

  // ==========================================================================
  // AGENTS DELETE
  // ==========================================================================

  describe('agents delete', () => {
    it('requires --force flag for deletion', async () => {
      await run(['agents', 'delete', 'agent-abc123']);

      expect(mockDeleteAgent).not.toHaveBeenCalled();
      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('--force');
      expect(output).toContain('agent-abc123');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
    });

    it('deletes agent with --force flag', async () => {
      mockDeleteAgent.mockResolvedValue(undefined);

      await run(['agents', 'delete', 'agent-abc123', '--force']);

      expect(mockDeleteAgent).toHaveBeenCalledWith('user_abc', 'agent-abc123');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Agent "agent-abc123" deleted');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['agents', 'delete', 'agent-abc123', '--force']);

      expect(mockDeleteAgent).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockDeleteAgent.mockRejectedValue(new Error('Permission denied'));

      await run(['agents', 'delete', 'agent-abc123', '--force']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to delete agent', expect.any(Error));
    });
  });
});
