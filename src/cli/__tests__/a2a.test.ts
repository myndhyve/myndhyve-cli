import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockFetch, mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

// ── Global fetch mock ────────────────────────────────────────────────────────

vi.stubGlobal('fetch', mockFetch);

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock('os', () => ({
  homedir: () => '/mock-home',
}));

// chalk — passthrough for all style methods
vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<typeof passthrough> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target: unknown, _thisArg: unknown, args: [string]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

// ora — no-op spinner
vi.mock('ora', () => ({
  default: () => {
    const spinner = {
      start: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      text: '',
      stream: process.stderr,
    };
    return spinner;
  },
}));

vi.mock('../../auth/index.js', () => ({
  getAuthStatus: () => ({ authenticated: true, uid: 'user-1', email: 'test@example.com' }),
  getToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { Command } from 'commander';
import { registerA2ACommands } from '../a2a.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // Throw instead of calling process.exit
  registerA2ACommands(program);
  return program;
}

function mockFetchResponse(body: unknown, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Map([['content-type', 'application/json']]),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('A2A Commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    mockFetch.mockReset();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockMkdir.mockResolvedValue(undefined);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('a2a discover', () => {
    it('fetches and displays an agent card', async () => {
      const agentCard = {
        name: 'Test Agent',
        description: 'A test agent',
        url: 'https://agent.example.com/a2a',
        workflows: [
          {
            name: 'analyze',
            description: 'Analyze data',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string', description: 'Input text' } },
              required: ['text'],
            },
          },
        ],
        authentication: { type: 'bearer', scheme: 'api_key' },
      };

      mockFetchResponse(agentCard);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'discover', 'https://agent.example.com']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Test Agent');
      expect(output).toContain('analyze');
      expect(output).toContain('Analyze data');
      expect(output).toContain('text');
    });

    it('outputs JSON when --format json', async () => {
      const agentCard = {
        name: 'Test Agent',
        url: 'https://agent.example.com',
        workflows: [],
      };

      mockFetchResponse(agentCard);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'discover', 'https://agent.example.com', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.name).toBe('Test Agent');
    });

    it('falls back to /agent.json when .well-known fails', async () => {
      // First call fails
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Second call succeeds
      mockFetchResponse({ name: 'Fallback Agent', workflows: [], url: '' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'discover', 'https://agent.example.com']);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Fallback Agent');
    });
  });

  describe('a2a call', () => {
    it('submits a task and shows the result', async () => {
      // Submit response
      mockFetchResponse({
        id: 'task-1',
        type: 'task_result',
        status: 'completed',
        output: { result: 'Analysis complete' },
      }, 202);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'a2a', 'call',
        'https://agent.example.com/a2a', 'analyze',
        '--input', '{"text":"hello"}',
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.type).toBe('task');
      expect(fetchBody.workflowId).toBe('analyze');
      expect(fetchBody.input).toEqual({ text: 'hello' });
    });

    it('returns error for invalid JSON input', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'a2a', 'call',
        'https://agent.example.com/a2a', 'analyze',
        '--input', 'not-json',
      ]);

      const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('Failed to parse');
    });
  });

  describe('a2a list', () => {
    it('shows saved agents', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify([
        { name: 'my-agent', url: 'https://agent.example.com', addedAt: '2026-01-01T00:00:00Z' },
      ]));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('my-agent');
      expect(output).toContain('agent.example.com');
    });

    it('shows empty message when no agents saved', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No saved agents');
    });
  });

  describe('a2a add', () => {
    it('saves a new agent', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      mockWriteFile.mockResolvedValueOnce(undefined);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'add', 'test-agent', 'https://agent.example.com']);

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].name).toBe('test-agent');
      expect(written[0].url).toBe('https://agent.example.com');
    });

    it('rejects duplicate names', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify([
        { name: 'existing', url: 'https://old.example.com', addedAt: '2026-01-01T00:00:00Z' },
      ]));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'add', 'existing', 'https://new.example.com']);

      expect(mockWriteFile).not.toHaveBeenCalled();
      const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('already exists');
    });
  });

  describe('a2a remove', () => {
    it('removes a saved agent', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify([
        { name: 'to-remove', url: 'https://agent.example.com', addedAt: '2026-01-01T00:00:00Z' },
      ]));
      mockWriteFile.mockResolvedValueOnce(undefined);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'remove', 'to-remove']);

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written).toHaveLength(0);
    });

    it('shows error for unknown agent', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'a2a', 'remove', 'nonexistent']);

      const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('not found');
    });
  });
});
