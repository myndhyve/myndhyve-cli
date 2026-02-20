import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// -- Hoisted mock variables -------------------------------------------------

const {
  mockCreateSession,
  mockSendMessage,
  mockListConversations,
  mockGetLatestConversation,
  mockPersistSession,
  mockRenderMarkdown,
  mockIsAuthenticated,
  mockFormatTimeSince,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockSendMessage: vi.fn(),
  mockListConversations: vi.fn(),
  mockGetLatestConversation: vi.fn(),
  mockPersistSession: vi.fn(),
  mockRenderMarkdown: vi.fn(),
  mockIsAuthenticated: vi.fn(),
  mockFormatTimeSince: vi.fn(),
}));

// -- Mocks ------------------------------------------------------------------

vi.mock('../../chat/index.js', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  listConversations: (...args: unknown[]) => mockListConversations(...args),
  getLatestConversation: (...args: unknown[]) => mockGetLatestConversation(...args),
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
  renderMarkdown: (...args: unknown[]) => mockRenderMarkdown(...args),
}));

vi.mock('../../auth/index.js', () => ({
  isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
}));

// chalk -- passthrough for all style methods
vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<typeof passthrough> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target, _thisArg, args: [string]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

// ora -- spinner mock
vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn(() => spinner) };
});

vi.mock('../../utils/format.js', () => ({
  formatTimeSince: (...args: unknown[]) => mockFormatTimeSince(...args),
}));

import { registerChatCommand } from '../chat.js';

// -- Helpers ----------------------------------------------------------------

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerChatCommand(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// -- Mock data --------------------------------------------------------------

function makeMockSession(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'sess_abc123',
    hyveId: undefined,
    provider: 'anthropic',
    model: 'claude-sonnet',
    temperature: 0.7,
    messages: [],
    ...overrides,
  };
}

// -- Test setup -------------------------------------------------------------

describe('registerChatCommand', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(() => {
    mockCreateSession.mockReset();
    mockSendMessage.mockReset();
    mockListConversations.mockReset();
    mockGetLatestConversation.mockReset();
    mockPersistSession.mockReset();
    mockRenderMarkdown.mockReset();
    mockIsAuthenticated.mockReset();
    mockFormatTimeSince.mockReset();

    // Default passthroughs
    mockIsAuthenticated.mockReturnValue(true);
    mockFormatTimeSince.mockImplementation(() => '5 minutes');

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the chat command on the program', () => {
      const program = new Command();
      registerChatCommand(program);
      const chat = program.commands.find((c) => c.name() === 'chat');
      expect(chat).toBeDefined();
    });

    it('has expected options', () => {
      const program = new Command();
      registerChatCommand(program);
      const chat = program.commands.find((c) => c.name() === 'chat')!;
      const optionNames = chat.options.map((o) => o.long);

      expect(optionNames).toContain('--hyve');
      expect(optionNames).toContain('--agent');
      expect(optionNames).toContain('--model');
      expect(optionNames).toContain('--provider');
      expect(optionNames).toContain('--temperature');
      expect(optionNames).toContain('--resume');
      expect(optionNames).toContain('--history');
      expect(optionNames).toContain('--pipe');
      expect(optionNames).toContain('--system');
    });

    it('has an optional message argument', () => {
      const program = new Command();
      registerChatCommand(program);
      const chat = program.commands.find((c) => c.name() === 'chat')!;
      // Commander stores registered args
      const args = chat.registeredArguments;
      expect(args.length).toBeGreaterThanOrEqual(1);
      expect(args[0].name()).toBe('message');
      expect(args[0].required).toBe(false);
    });
  });

  // ==========================================================================
  // CHAT --history
  // ==========================================================================

  describe('chat --history', () => {
    it('shows empty message when no conversations exist', async () => {
      mockListConversations.mockReturnValue([]);

      await run(['chat', '--history']);

      expect(mockListConversations).toHaveBeenCalledOnce();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No conversations yet');
      expect(output).toContain('myndhyve-cli chat');
    });

    it('shows the Chat History header', async () => {
      mockListConversations.mockReturnValue([]);

      await run(['chat', '--history']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Chat History');
    });

    it('shows conversation list with details', async () => {
      mockListConversations.mockReturnValue([
        {
          sessionId: 'sess_001',
          title: 'Docker Setup Help',
          hyveId: 'app-builder',
          messageCount: 12,
          createdAt: '2025-01-15T10:00:00Z',
          updatedAt: '2025-01-15T11:00:00Z',
        },
        {
          sessionId: 'sess_002',
          title: 'Landing Page Design',
          hyveId: undefined,
          messageCount: 5,
          createdAt: '2025-01-14T08:00:00Z',
          updatedAt: '2025-01-14T09:00:00Z',
        },
      ]);

      await run(['chat', '--history']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Docker Setup Help');
      expect(output).toContain('sess_001');
      expect(output).toContain('app-builder');
      expect(output).toContain('12 msgs');
      expect(output).toContain('Landing Page Design');
      expect(output).toContain('sess_002');
      expect(output).toContain('5 msgs');
    });

    it('calls formatTimeSince for conversation dates', async () => {
      mockListConversations.mockReturnValue([
        {
          sessionId: 'sess_001',
          title: 'Test',
          messageCount: 1,
          createdAt: '2025-01-15T10:00:00Z',
          updatedAt: '2025-01-15T11:00:00Z',
        },
      ]);

      await run(['chat', '--history']);

      expect(mockFormatTimeSince).toHaveBeenCalled();
    });

    it('truncates display at 20 conversations', async () => {
      const conversations = Array.from({ length: 25 }, (_, i) => ({
        sessionId: `sess_${String(i).padStart(3, '0')}`,
        title: `Conversation ${i}`,
        messageCount: i + 1,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
      }));
      mockListConversations.mockReturnValue(conversations);

      await run(['chat', '--history']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      // Should show the truncation message
      expect(output).toContain('20 of 25');
      // First conversation should be present
      expect(output).toContain('Conversation 0');
      // 19th conversation should be present (0-indexed, last of 20)
      expect(output).toContain('Conversation 19');
      // 20th conversation should NOT be present
      expect(output).not.toContain('sess_020');
    });

    it('does not show truncation message when under 20', async () => {
      const conversations = Array.from({ length: 5 }, (_, i) => ({
        sessionId: `sess_${i}`,
        title: `Conv ${i}`,
        messageCount: 1,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
      }));
      mockListConversations.mockReturnValue(conversations);

      await run(['chat', '--history']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Showing');
    });

    it('shows resume hint at bottom', async () => {
      mockListConversations.mockReturnValue([
        {
          sessionId: 'sess_001',
          title: 'Test',
          messageCount: 1,
          createdAt: '2025-01-15T10:00:00Z',
          updatedAt: '2025-01-15T11:00:00Z',
        },
      ]);

      await run(['chat', '--history']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('--resume');
    });
  });

  // ==========================================================================
  // CHAT (one-shot mode)
  // ==========================================================================

  describe('chat "message" (one-shot)', () => {
    it('creates session and sends message', async () => {
      const session = makeMockSession();
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockResolvedValue('Here is the answer.');

      await run(['chat', 'Explain Docker']);

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          hyveId: undefined,
          agentId: undefined,
          provider: undefined,
          model: undefined,
        })
      );
      expect(mockSendMessage).toHaveBeenCalledWith(
        session,
        'Explain Docker',
        expect.objectContaining({ onDelta: expect.any(Function) })
      );
    });

    it('passes options through to createSession', async () => {
      const session = makeMockSession({ hyveId: 'app-builder' });
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockResolvedValue('Response');

      await run([
        'chat', 'Build a page',
        '--hyve', 'app-builder',
        '--model', 'gpt-4o',
        '--provider', 'openai',
        '--temperature', '0.5',
        '--system', 'Be concise',
      ]);

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          hyveId: 'app-builder',
          model: 'gpt-4o',
          provider: 'openai',
          temperature: 0.5,
          systemPrompt: 'Be concise',
        })
      );
    });

    it('sets exitCode=1 when sendMessage throws', async () => {
      const session = makeMockSession();
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockRejectedValue(new Error('API rate limit exceeded'));

      await run(['chat', 'Hello']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('API rate limit exceeded');
      expect(process.exitCode).toBe(1);
    });

    it('does not set exitCode on success', async () => {
      const session = makeMockSession();
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockResolvedValue('All good');

      await run(['chat', 'Test']);

      expect(process.exitCode).toBeUndefined();
    });

    it('calls onDelta callback during streaming', async () => {
      const session = makeMockSession();
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockImplementation(async (_sess, _msg, opts) => {
        opts.onDelta('Hello ');
        opts.onDelta('world');
        return 'Hello world';
      });

      await run(['chat', 'Hi']);

      // stdoutWriteSpy should have received the deltas
      const writes = stdoutWriteSpy.mock.calls.map((c) => c[0]);
      expect(writes).toContain('Hello ');
      expect(writes).toContain('world');
    });

    it('handles non-Error thrown values', async () => {
      const session = makeMockSession();
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockRejectedValue('string error');

      await run(['chat', 'Hello']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('string error');
      expect(process.exitCode).toBe(1);
    });

    it('passes --agent option to createSession', async () => {
      const session = makeMockSession();
      mockCreateSession.mockReturnValue(session);
      mockSendMessage.mockResolvedValue('Response');

      await run(['chat', 'Build it', '--agent', 'my-agent']);

      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'my-agent',
        })
      );
    });
  });
});
