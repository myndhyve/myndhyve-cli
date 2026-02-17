import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatEgressEnvelope } from '../../../relay/types.js';

// ---------------------------------------------------------------------------
// Hoisted mock variables -- available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockSendIMessage,
  mockIsIMessageConfigured,
  mockPollIMessages,
  mockGetChatDbPath,
  mockIMessageSendError,
  mockRegisterChannel,
  mockExistsSync,
  mockAccessSync,
  mockConstants,
  capturedRegistration,
} = vi.hoisted(() => {
  // Ensure IS_MACOS evaluates to true when the plugin module loads on CI (Linux)
  if (process.platform !== 'darwin') {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  }

  const capturedRegistration: { plugin: unknown } = { plugin: null };

  return {
    mockSendIMessage: vi.fn(),
    mockIsIMessageConfigured: vi.fn(),
    mockPollIMessages: vi.fn(),
    mockGetChatDbPath: vi.fn(() => '/Users/test/Library/Messages/chat.db'),
    mockIMessageSendError: class extends Error {
      recipient: string;
      isGroup: boolean;
      constructor(msg: string, recipient: string, isGroup: boolean) {
        super(msg);
        this.name = 'IMessageSendError';
        this.recipient = recipient;
        this.isGroup = isGroup;
      }
    },
    mockRegisterChannel: vi.fn((plugin: unknown) => {
      capturedRegistration.plugin = plugin;
    }),
    mockExistsSync: vi.fn(),
    mockAccessSync: vi.fn(),
    mockConstants: { R_OK: 4 },
    capturedRegistration,
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../registry.js', () => ({
  registerChannel: (plugin: unknown) => mockRegisterChannel(plugin),
}));

vi.mock('../send.js', () => ({
  sendIMessage: (...args: unknown[]) => mockSendIMessage(...args),
  isIMessageConfigured: (...args: unknown[]) => mockIsIMessageConfigured(...args),
  IMessageSendError: mockIMessageSendError,
}));

vi.mock('../receive.js', () => ({
  pollIMessages: (...args: unknown[]) => mockPollIMessages(...args),
  getChatDbPath: () => mockGetChatDbPath(),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  accessSync: (...args: unknown[]) => mockAccessSync(...args),
  constants: mockConstants,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { iMessagePlugin } from '../index.js';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSendIMessage.mockReset();
  mockIsIMessageConfigured.mockReset();
  mockPollIMessages.mockReset();
  mockGetChatDbPath.mockReset();
  mockRegisterChannel.mockReset();
  mockExistsSync.mockReset();
  mockAccessSync.mockReset();

  // Defaults
  mockGetChatDbPath.mockReturnValue('/Users/test/Library/Messages/chat.db');
  mockIsIMessageConfigured.mockResolvedValue(true);
  mockPollIMessages.mockResolvedValue(undefined);
  mockExistsSync.mockReturnValue(true);
  mockAccessSync.mockReturnValue(undefined);
});

afterEach(async () => {
  // Reset plugin connection state between tests
  await iMessagePlugin.logout();
});

// ============================================================================
// Auto-registration
// ============================================================================

describe('auto-registration', () => {
  it('registers the plugin with the channel registry on import', () => {
    // registerChannel is called at module scope during import. We capture
    // the call in the mock factory via capturedRegistration.
    expect(capturedRegistration.plugin).toBe(iMessagePlugin);
  });
});

// ============================================================================
// Properties
// ============================================================================

describe('properties', () => {
  it('has channel set to "imessage"', () => {
    expect(iMessagePlugin.channel).toBe('imessage');
  });

  it('has displayName set to "iMessage"', () => {
    expect(iMessagePlugin.displayName).toBe('iMessage');
  });

  it('has isSupported set to true on macOS', () => {
    // Tests run on macOS, so IS_MACOS = true at import time
    expect(iMessagePlugin.isSupported).toBe(true);
  });

  it('has unsupportedReason as undefined on macOS', () => {
    expect(iMessagePlugin.unsupportedReason).toBeUndefined();
  });
});

// ============================================================================
// isAuthenticated()
// ============================================================================

describe('isAuthenticated()', () => {
  it('returns true when chat.db exists and is readable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAccessSync.mockReturnValue(undefined);

    const result = await iMessagePlugin.isAuthenticated();

    expect(mockGetChatDbPath).toHaveBeenCalled();
    expect(mockExistsSync).toHaveBeenCalledWith('/Users/test/Library/Messages/chat.db');
    expect(result).toBe(true);
  });

  it('returns false when chat.db does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await iMessagePlugin.isAuthenticated();

    expect(result).toBe(false);
  });

  it('returns false when chat.db exists but is not readable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockAccessSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = await iMessagePlugin.isAuthenticated();

    expect(result).toBe(false);
  });
});

// ============================================================================
// login()
// ============================================================================

describe('login()', () => {
  it('succeeds when iMessage is configured, chat.db exists, and is readable', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(true);
    mockAccessSync.mockReturnValue(undefined);

    await expect(iMessagePlugin.login()).resolves.toBeUndefined();

    expect(mockIsIMessageConfigured).toHaveBeenCalled();
    expect(mockExistsSync).toHaveBeenCalledWith('/Users/test/Library/Messages/chat.db');
  });

  it('throws when iMessage is not configured', async () => {
    mockIsIMessageConfigured.mockResolvedValue(false);

    await expect(iMessagePlugin.login()).rejects.toThrow(
      'iMessage is not configured'
    );
  });

  it('throws when chat.db does not exist', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);

    await expect(iMessagePlugin.login()).rejects.toThrow(
      'Messages database not found'
    );
  });

  it('throws when Full Disk Access is denied', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(true);
    mockAccessSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await expect(iMessagePlugin.login()).rejects.toThrow(
      'Full Disk Access required'
    );
  });
});

// ============================================================================
// start()
// ============================================================================

describe('start()', () => {
  it('verifies iMessage is configured before starting', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockPollIMessages.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await iMessagePlugin.start(onInbound, ac.signal);

    expect(mockIsIMessageConfigured).toHaveBeenCalled();
  });

  it('calls pollIMessages with onInbound and an AbortSignal', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockPollIMessages.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await iMessagePlugin.start(onInbound, ac.signal);

    expect(mockPollIMessages).toHaveBeenCalledTimes(1);
    // First arg is onInbound, second is the internal AbortSignal
    expect(mockPollIMessages.mock.calls[0][0]).toBe(onInbound);
    expect(mockPollIMessages.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it('sets connectionStatus to "connected" during poll', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);

    // Make pollIMessages block until we can check the status
    let resolvePoll!: () => void;
    mockPollIMessages.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePoll = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    // While poll is running, status should be 'connected'
    expect(iMessagePlugin.getStatus()).toBe('connected');

    // Clean up
    resolvePoll();
    await startPromise;
  });

  it('resets connectionStatus to "disconnected" after poll ends', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockPollIMessages.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await iMessagePlugin.start(onInbound, ac.signal);

    // After start() completes (poll ended), status should be disconnected
    expect(iMessagePlugin.getStatus()).toBe('disconnected');
  });

  it('throws when iMessage is not configured', async () => {
    mockIsIMessageConfigured.mockResolvedValue(false);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await expect(
      iMessagePlugin.start(onInbound, ac.signal)
    ).rejects.toThrow('iMessage is not configured');

    expect(mockPollIMessages).not.toHaveBeenCalled();
  });

  it('sets connectionStatus to "connecting" during configuration check', async () => {
    // Make isIMessageConfigured block so we can observe the 'connecting' status
    let resolveConfig!: (val: boolean) => void;
    mockIsIMessageConfigured.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveConfig = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    expect(iMessagePlugin.getStatus()).toBe('connecting');

    // Resolve and clean up
    mockPollIMessages.mockResolvedValue(undefined);
    resolveConfig(true);
    await startPromise;
  });

  it('does not throw when poll ends via abort signal', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);

    // pollIMessages resolves when signal is aborted
    mockPollIMessages.mockImplementation(
      (_onInbound: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    // Abort
    ac.abort();
    await expect(startPromise).resolves.toBeUndefined();

    expect(iMessagePlugin.getStatus()).toBe('disconnected');
  });

  it('swallows error when signal is aborted', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);

    mockPollIMessages.mockImplementation(
      (_onInbound: unknown, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    ac.abort();

    // Should not throw since signal.aborted is true
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('throws poll errors when signal is not aborted', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockPollIMessages.mockRejectedValue(new Error('database locked'));

    const onInbound = vi.fn();
    const ac = new AbortController();

    await expect(
      iMessagePlugin.start(onInbound, ac.signal)
    ).rejects.toThrow('database locked');
  });
});

// ============================================================================
// deliver()
// ============================================================================

describe('deliver()', () => {
  // Helper to put the plugin into 'connected' state
  async function connectPlugin(): Promise<{
    resolvePoll: () => void;
    startPromise: Promise<void>;
  }> {
    mockIsIMessageConfigured.mockResolvedValue(true);

    let resolvePoll!: () => void;
    mockPollIMessages.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePoll = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    return { resolvePoll, startPromise };
  }

  it('returns error when not connected (connectionStatus !== "connected")', async () => {
    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'hello',
    });

    expect(result).toEqual({
      success: false,
      error: 'iMessage not connected',
      retryable: true,
    });
  });

  it('calls sendIMessage with correct params for direct message', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockResolvedValue(undefined);

    const envelope: ChatEgressEnvelope = {
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'Hello, world!',
    };

    const result = await iMessagePlugin.deliver(envelope);

    expect(mockSendIMessage).toHaveBeenCalledWith({
      to: '+1234567890',
      text: 'Hello, world!',
      isGroup: false,
    });
    expect(result).toEqual({
      success: true,
      platformMessageId: undefined,
    });

    // Clean up
    resolvePoll();
    await startPromise;
  });

  it('calls sendIMessage with isGroup=true for group (chat...) conversationId', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockResolvedValue(undefined);

    const envelope: ChatEgressEnvelope = {
      channel: 'imessage',
      conversationId: 'chat574269100969649886',
      text: 'Group message',
    };

    const result = await iMessagePlugin.deliver(envelope);

    expect(mockSendIMessage).toHaveBeenCalledWith({
      to: 'chat574269100969649886',
      text: 'Group message',
      isGroup: true,
    });
    expect(result.success).toBe(true);

    // Clean up
    resolvePoll();
    await startPromise;
  });

  it('returns success on successful send', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockResolvedValue(undefined);

    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: 'user@icloud.com',
      text: 'hi',
    });

    expect(result.success).toBe(true);
    expect(result.platformMessageId).toBeUndefined();

    resolvePoll();
    await startPromise;
  });

  it('returns failure with error message on send failure (generic Error)', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockRejectedValue(new Error('osascript timed out'));

    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'hi',
    });

    expect(result).toEqual({
      success: false,
      error: 'osascript timed out',
      retryable: true,
    });

    resolvePoll();
    await startPromise;
  });

  it('returns retryable=false for IMessageSendError', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockRejectedValue(
      new mockIMessageSendError('Failed to send', '+1234567890', false)
    );

    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'hi',
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);

    resolvePoll();
    await startPromise;
  });

  it('returns retryable=true for generic errors (not IMessageSendError)', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockRejectedValue(new Error('network timeout'));

    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'hi',
    });

    expect(result.retryable).toBe(true);

    resolvePoll();
    await startPromise;
  });

  it('handles non-Error throw values', async () => {
    const { resolvePoll, startPromise } = await connectPlugin();
    mockSendIMessage.mockRejectedValue('string error');

    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'hi',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('string error');
    expect(result.retryable).toBe(true);

    resolvePoll();
    await startPromise;
  });
});

// ============================================================================
// getStatus()
// ============================================================================

describe('getStatus()', () => {
  it('returns "disconnected" initially', () => {
    expect(iMessagePlugin.getStatus()).toBe('disconnected');
  });

  it('returns "connected" during active poll', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);

    let resolvePoll!: () => void;
    mockPollIMessages.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePoll = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    expect(iMessagePlugin.getStatus()).toBe('connected');

    resolvePoll();
    await startPromise;
  });

  it('returns "disconnected" after start() completes', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);
    mockPollIMessages.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await iMessagePlugin.start(onInbound, ac.signal);

    expect(iMessagePlugin.getStatus()).toBe('disconnected');
  });
});

// ============================================================================
// logout()
// ============================================================================

describe('logout()', () => {
  it('sets connectionStatus to disconnected', async () => {
    await iMessagePlugin.logout();

    expect(iMessagePlugin.getStatus()).toBe('disconnected');
  });

  it('succeeds when nothing is active', async () => {
    await expect(iMessagePlugin.logout()).resolves.toBeUndefined();
  });

  it('aborts the active poll loop when called during start()', async () => {
    mockIsIMessageConfigured.mockResolvedValue(true);

    // pollIMessages blocks until its signal is aborted
    mockPollIMessages.mockImplementation(
      (_onInbound: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    // Verify connected
    expect(iMessagePlugin.getStatus()).toBe('connected');

    // Logout should abort the internal poll controller
    await iMessagePlugin.logout();

    // start() should resolve because the internal signal was aborted
    await expect(startPromise).resolves.toBeUndefined();

    expect(iMessagePlugin.getStatus()).toBe('disconnected');
  });

  it('resets state so deliver returns error after logout', async () => {
    // Connect first
    mockIsIMessageConfigured.mockResolvedValue(true);

    let resolvePoll!: () => void;
    mockPollIMessages.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePoll = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = iMessagePlugin.start(onInbound, ac.signal);
    await flush();

    // Verify we are connected
    expect(iMessagePlugin.getStatus()).toBe('connected');

    // Logout
    await iMessagePlugin.logout();

    expect(iMessagePlugin.getStatus()).toBe('disconnected');

    // Deliver should now fail
    const result = await iMessagePlugin.deliver({
      channel: 'imessage',
      conversationId: '+1234567890',
      text: 'hi',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('iMessage not connected');

    // Clean up
    resolvePoll();
    await startPromise;
  });
});
