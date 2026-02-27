import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// ── Global fetch mock ────────────────────────────────────────────────────────

vi.stubGlobal('fetch', mockFetch);

// ── Module mocks ─────────────────────────────────────────────────────────────

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

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { Command } from 'commander';
import { registerMCPClientCommands } from '../mcp-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerMCPClientCommands(program);
  return program;
}

function mockJsonRpcResponse(result: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result }),
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    headers: new Map([['content-type', 'application/json']]),
  });
}

function mockJsonRpcError(code: number, message: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, error: { code, message } }),
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }),
    headers: new Map([['content-type', 'application/json']]),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MCP Client Commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('mcp info', () => {
    it('displays server info after initialize', async () => {
      mockJsonRpcResponse({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'Test MCP Server', version: '2.0.0' },
        capabilities: { tools: {}, resources: {} },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'info', 'https://mcp.example.com']);

      // Verify JSON-RPC request
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.jsonrpc).toBe('2.0');
      expect(fetchBody.method).toBe('initialize');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Test MCP Server');
      expect(output).toContain('v2.0.0');
      expect(output).toContain('2024-11-05');
    });

    it('outputs JSON when --format json', async () => {
      mockJsonRpcResponse({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'Test Server', version: '1.0.0' },
        capabilities: {},
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'info', 'https://mcp.example.com', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.serverInfo.name).toBe('Test Server');
    });
  });

  describe('mcp list-tools', () => {
    it('lists available tools with input schemas', async () => {
      mockJsonRpcResponse({
        tools: [
          {
            name: 'run_workflow_generate',
            description: 'Generate marketing copy',
            inputSchema: {
              type: 'object',
              properties: {
                topic: { type: 'string', description: 'Copy topic' },
                tone: { type: 'string', description: 'Writing tone' },
              },
              required: ['topic'],
            },
          },
          {
            name: 'run_workflow_analyze',
            description: 'Analyze data',
          },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'list-tools', 'https://mcp.example.com']);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.method).toBe('tools/list');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MCP Tools (2)');
      expect(output).toContain('run_workflow_generate');
      expect(output).toContain('Generate marketing copy');
      expect(output).toContain('topic');
    });

    it('shows empty message when no tools', async () => {
      mockJsonRpcResponse({ tools: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'list-tools', 'https://mcp.example.com']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No tools available');
    });
  });

  describe('mcp call', () => {
    it('calls a tool and displays the result', async () => {
      mockJsonRpcResponse({
        content: [{ type: 'text', text: 'Generated: Hello world' }],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'mcp', 'call',
        'https://mcp.example.com', 'run_workflow_generate',
        '--args', '{"topic":"greetings"}',
      ]);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.method).toBe('tools/call');
      expect(fetchBody.params.name).toBe('run_workflow_generate');
      expect(fetchBody.params.arguments).toEqual({ topic: 'greetings' });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Generated: Hello world');
    });

    it('shows error when tool returns isError', async () => {
      mockJsonRpcResponse({
        content: [{ type: 'text', text: 'Unknown tool: bad_tool' }],
        isError: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'mcp', 'call',
        'https://mcp.example.com', 'bad_tool',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown tool: bad_tool');
    });

    it('rejects invalid JSON args', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'mcp', 'call',
        'https://mcp.example.com', 'my-tool',
        '--args', 'not-json',
      ]);

      const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('Failed to parse');
    });

    it('passes API key in Authorization header', async () => {
      mockJsonRpcResponse({
        content: [{ type: 'text', text: 'OK' }],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'mcp', 'call',
        'https://mcp.example.com', 'my-tool',
        '--api-key', 'hk_test_12345',
      ]);

      const fetchHeaders = mockFetch.mock.calls[0][1].headers;
      expect(fetchHeaders.Authorization).toBe('Bearer hk_test_12345');
    });
  });

  describe('mcp list-resources', () => {
    it('lists available resources', async () => {
      mockJsonRpcResponse({
        resources: [
          { uri: 'resource://data/users', name: 'Users', mimeType: 'application/json' },
          { uri: 'resource://data/config', name: 'Config', mimeType: 'text/yaml' },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'list-resources', 'https://mcp.example.com']);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.method).toBe('resources/list');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MCP Resources (2)');
      expect(output).toContain('resource://data/users');
      expect(output).toContain('Users');
    });

    it('shows empty message when no resources', async () => {
      mockJsonRpcResponse({ resources: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'list-resources', 'https://mcp.example.com']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No resources available');
    });
  });

  describe('mcp read', () => {
    it('reads a resource and displays content', async () => {
      mockJsonRpcResponse({
        contents: [{ uri: 'resource://data/users', mimeType: 'application/json', text: '{"users": []}' }],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', 'mcp', 'read',
        'https://mcp.example.com', 'resource://data/users',
      ]);

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.method).toBe('resources/read');
      expect(fetchBody.params.uri).toBe('resource://data/users');

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('{"users": []}');
    });
  });

  describe('error handling', () => {
    it('handles MCP JSON-RPC errors', async () => {
      mockJsonRpcError(-32601, 'Method not found: bad/method');

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'info', 'https://mcp.example.com']);

      const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('MCP error');
      expect(output).toContain('Method not found');
    });

    it('handles HTTP errors from server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'mcp', 'info', 'https://mcp.example.com']);

      const output = stderrSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('503');
    });
  });
});
