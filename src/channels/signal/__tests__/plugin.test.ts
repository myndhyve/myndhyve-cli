import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatEgressEnvelope, DeliveryResult } from '../../../relay/types.js';

// ---------------------------------------------------------------------------
// Hoisted mock variables — available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockStartSignalDaemon,
  mockIsSignalCliInstalled,
  mockHasAccountData,
  mockConnectSignalSSE,
  mockDeliverSignalMessage,
  mockStartLink,
  mockFinishLink,
  mockHealthCheck,
  mockGetVersion,
  mockRegisterChannel,
  mockGetAuthDir,
  mockEnsureAuthDir,
  mockRmSync,
  mockSleep,
  capturedRegistration,
} = vi.hoisted(() => {
  const capturedRegistration: { plugin: unknown } = { plugin: null };

  return {
    mockStartSignalDaemon: vi.fn(),
    mockIsSignalCliInstalled: vi.fn(),
    mockHasAccountData: vi.fn(),
    mockConnectSignalSSE: vi.fn(),
    mockDeliverSignalMessage: vi.fn(),
    mockStartLink: vi.fn(),
    mockFinishLink: vi.fn(),
    mockHealthCheck: vi.fn(),
    mockGetVersion: vi.fn(),
    mockRegisterChannel: vi.fn((plugin: unknown) => {
      capturedRegistration.plugin = plugin;
    }),
    mockGetAuthDir: vi.fn((_channel: string) => '/tmp/test-signal'),
    mockEnsureAuthDir: vi.fn((_channel: string) => '/tmp/test-signal'),
    mockRmSync: vi.fn(),
    mockSleep: vi.fn((_ms: number) => Promise.resolve()),
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

vi.mock('../../../config/loader.js', () => ({
  getAuthDir: (channel: string) => mockGetAuthDir(channel),
  ensureAuthDir: (channel: string) => mockEnsureAuthDir(channel),
}));

vi.mock('../../registry.js', () => ({
  registerChannel: (plugin: unknown) => mockRegisterChannel(plugin),
}));

vi.mock('../daemon.js', () => ({
  startSignalDaemon: (...args: unknown[]) => mockStartSignalDaemon(...args),
  isSignalCliInstalled: (...args: unknown[]) => mockIsSignalCliInstalled(...args),
  hasAccountData: (...args: unknown[]) => mockHasAccountData(...args),
}));

vi.mock('../inbound.js', () => ({
  connectSignalSSE: (...args: unknown[]) => mockConnectSignalSSE(...args),
}));

vi.mock('../outbound.js', () => ({
  deliverSignalMessage: (...args: unknown[]) => mockDeliverSignalMessage(...args),
}));

vi.mock('../client.js', () => ({
  startLink: (...args: unknown[]) => mockStartLink(...args),
  finishLink: (...args: unknown[]) => mockFinishLink(...args),
  healthCheck: (...args: unknown[]) => mockHealthCheck(...args),
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
}));

vi.mock('node:fs', () => ({
  rmSync: (...args: unknown[]) => mockRmSync(...args),
}));

vi.mock('../../../utils/backoff.js', () => ({
  sleep: (ms: number) => mockSleep(ms),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDaemon() {
  return {
    process: {} as unknown,
    baseUrl: 'http://127.0.0.1:18080',
    stop: vi.fn(),
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { signalPlugin } from '../index.js';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockStartSignalDaemon.mockReset();
  mockIsSignalCliInstalled.mockReset();
  mockHasAccountData.mockReset();
  mockConnectSignalSSE.mockReset();
  mockDeliverSignalMessage.mockReset();
  mockStartLink.mockReset();
  mockFinishLink.mockReset();
  mockHealthCheck.mockReset();
  mockGetVersion.mockReset();
  mockGetAuthDir.mockReset();
  mockEnsureAuthDir.mockReset();
  mockRmSync.mockReset();
  mockSleep.mockReset();
  mockSleep.mockImplementation(() => Promise.resolve());

  mockGetAuthDir.mockReturnValue('/tmp/test-signal');
  mockEnsureAuthDir.mockReturnValue('/tmp/test-signal');
  mockHasAccountData.mockReturnValue(true);
  mockDeliverSignalMessage.mockResolvedValue({ success: true, platformMessageId: 'sig-1' });
  mockIsSignalCliInstalled.mockResolvedValue(true);
});

afterEach(async () => {
  // Reset plugin connection state between tests
  await signalPlugin.logout();
  vi.useRealTimers();
});

// ============================================================================
// Auto-registration
// ============================================================================

describe('auto-registration', () => {
  it('registers the plugin with the channel registry on import', () => {
    // registerChannel is called at module scope during import, so beforeEach
    // clears the spy history. We capture the call in the mock factory instead.
    expect(capturedRegistration.plugin).toBe(signalPlugin);
  });
});

// ============================================================================
// Properties
// ============================================================================

describe('properties', () => {
  it('has channel set to "signal"', () => {
    expect(signalPlugin.channel).toBe('signal');
  });

  it('has displayName set to "Signal"', () => {
    expect(signalPlugin.displayName).toBe('Signal');
  });

  it('has isSupported set to true', () => {
    expect(signalPlugin.isSupported).toBe(true);
  });

  it('has no unsupportedReason', () => {
    expect(signalPlugin.unsupportedReason).toBeUndefined();
  });
});

// ============================================================================
// isAuthenticated()
// ============================================================================

describe('isAuthenticated()', () => {
  it('returns true when hasAccountData returns true', async () => {
    mockHasAccountData.mockReturnValue(true);

    const result = await signalPlugin.isAuthenticated();

    expect(mockGetAuthDir).toHaveBeenCalledWith('signal');
    expect(mockHasAccountData).toHaveBeenCalledWith('/tmp/test-signal');
    expect(result).toBe(true);
  });

  it('returns false when hasAccountData returns false', async () => {
    mockHasAccountData.mockReturnValue(false);

    const result = await signalPlugin.isAuthenticated();

    expect(result).toBe(false);
  });
});

// ============================================================================
// start()
// ============================================================================

describe('start()', () => {
  it('starts daemon and connects SSE', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);
    mockConnectSignalSSE.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await signalPlugin.start(onInbound, ac.signal);

    expect(mockStartSignalDaemon).toHaveBeenCalledWith(
      expect.objectContaining({
        dataDir: '/tmp/test-signal',
        host: '127.0.0.1',
        port: 18080,
      })
    );

    expect(mockConnectSignalSSE).toHaveBeenCalledWith(
      daemon.baseUrl,
      onInbound,
      ac.signal
    );
  });

  it('sets connectionStatus to "connected" after daemon start', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);

    // Make connectSignalSSE block until we can check the status
    let resolveSSE!: () => void;
    mockConnectSignalSSE.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSSE = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = signalPlugin.start(onInbound, ac.signal);
    await flush();

    // While SSE is running, status should be 'connected'
    expect(signalPlugin.getStatus()).toBe('connected');

    // Clean up
    resolveSSE();
    await startPromise;
  });

  it('cleans up daemon on failure (connectSignalSSE throws after retries)', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);
    mockConnectSignalSSE.mockRejectedValue(new Error('SSE failed'));

    const onInbound = vi.fn();
    const ac = new AbortController();

    await expect(
      signalPlugin.start(onInbound, ac.signal)
    ).rejects.toThrow('SSE failed');

    // Daemon should be stopped on error after exhausting reconnect attempts
    expect(daemon.stop).toHaveBeenCalled();
    // Should have attempted reconnection (MAX_SSE_RECONNECTS + 1 total calls)
    expect(mockConnectSignalSSE.mock.calls.length).toBeGreaterThan(1);
  });

  it('reconnects SSE on transient stream drop', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);

    // First call fails, second succeeds
    let callCount = 0;
    mockConnectSignalSSE.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('stream dropped'));
      return Promise.resolve();
    });

    const onInbound = vi.fn();
    const ac = new AbortController();

    await signalPlugin.start(onInbound, ac.signal);

    // Should have reconnected
    expect(mockConnectSignalSSE).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });

  it('cleans up daemon on abort', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);

    // connectSignalSSE blocks and then resolves when aborted
    mockConnectSignalSSE.mockImplementation(
      (_baseUrl: string, _onInbound: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = signalPlugin.start(onInbound, ac.signal);
    await flush();

    // Abort the connection
    ac.abort();
    await startPromise;

    // Daemon should be stopped in finally block
    expect(daemon.stop).toHaveBeenCalled();
  });

  it('sets connectionStatus back to "disconnected" after stop', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);
    mockConnectSignalSSE.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await signalPlugin.start(onInbound, ac.signal);

    // After start() completes (SSE stream ended), status should be disconnected
    expect(signalPlugin.getStatus()).toBe('disconnected');
  });

  it('clears currentDaemon in finally block (deliver returns error after stop)', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);
    mockConnectSignalSSE.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await signalPlugin.start(onInbound, ac.signal);

    // After start finishes, currentDaemon should be null
    const result = await signalPlugin.deliver({
      channel: 'signal',
      conversationId: '+1234567890',
      text: 'hello',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Signal not connected');
  });

  it('cleans up daemon when startSignalDaemon throws', async () => {
    mockStartSignalDaemon.mockRejectedValue(new Error('daemon start failed'));

    const onInbound = vi.fn();
    const ac = new AbortController();

    await expect(
      signalPlugin.start(onInbound, ac.signal)
    ).rejects.toThrow('daemon start failed');

    // Status should be disconnected
    expect(signalPlugin.getStatus()).toBe('disconnected');
  });
});

// ============================================================================
// deliver()
// ============================================================================

describe('deliver()', () => {
  it('returns error when not connected (currentDaemon is null)', async () => {
    const result = await signalPlugin.deliver({
      channel: 'signal',
      conversationId: '+1234567890',
      text: 'hello',
    });

    expect(result).toEqual({
      success: false,
      error: 'Signal not connected',
      retryable: true,
    });
  });

  it('calls deliverSignalMessage when connected', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);

    // Make SSE block so we can test deliver while connected
    let resolveSSE!: () => void;
    mockConnectSignalSSE.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSSE = resolve; })
    );

    const expectedResult: DeliveryResult = { success: true, platformMessageId: 'sig-42' };
    mockDeliverSignalMessage.mockResolvedValue(expectedResult);

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = signalPlugin.start(onInbound, ac.signal);
    await flush();

    const envelope: ChatEgressEnvelope = {
      channel: 'signal',
      conversationId: '+1234567890',
      text: 'outbound message',
    };

    const result = await signalPlugin.deliver(envelope);

    expect(mockDeliverSignalMessage).toHaveBeenCalledWith(daemon.baseUrl, envelope);
    expect(result).toEqual(expectedResult);

    // Clean up
    resolveSSE();
    await startPromise;
  });
});

// ============================================================================
// getStatus()
// ============================================================================

describe('getStatus()', () => {
  it('returns "disconnected" initially', () => {
    expect(signalPlugin.getStatus()).toBe('disconnected');
  });

  it('returns "connecting" during daemon startup', async () => {
    // Make startSignalDaemon block
    let resolveDaemon!: (daemon: ReturnType<typeof createMockDaemon>) => void;
    mockStartSignalDaemon.mockImplementation(
      () => new Promise((resolve) => { resolveDaemon = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = signalPlugin.start(onInbound, ac.signal);
    await flush();

    // During daemon startup, status should be 'connecting'
    expect(signalPlugin.getStatus()).toBe('connecting');

    // Resolve daemon so start() can proceed
    const daemon = createMockDaemon();
    mockConnectSignalSSE.mockResolvedValue(undefined);
    resolveDaemon(daemon);
    await startPromise;
  });

  it('returns "connected" after successful daemon start', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);

    let resolveSSE!: () => void;
    mockConnectSignalSSE.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSSE = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = signalPlugin.start(onInbound, ac.signal);
    await flush();

    expect(signalPlugin.getStatus()).toBe('connected');

    // Clean up
    resolveSSE();
    await startPromise;
  });

  it('returns "disconnected" after start() completes', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);
    mockConnectSignalSSE.mockResolvedValue(undefined);

    const onInbound = vi.fn();
    const ac = new AbortController();

    await signalPlugin.start(onInbound, ac.signal);

    expect(signalPlugin.getStatus()).toBe('disconnected');
  });
});

// ============================================================================
// logout()
// ============================================================================

describe('logout()', () => {
  it('stops current daemon if active', async () => {
    const daemon = createMockDaemon();
    mockStartSignalDaemon.mockResolvedValue(daemon);

    let resolveSSE!: () => void;
    mockConnectSignalSSE.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSSE = resolve; })
    );

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = signalPlugin.start(onInbound, ac.signal);
    await flush();

    // Logout while daemon is active
    await signalPlugin.logout();

    expect(daemon.stop).toHaveBeenCalled();

    // deliver should now fail since daemon was cleared
    const result = await signalPlugin.deliver({
      channel: 'signal',
      conversationId: '+1234567890',
      text: 'hi',
    });
    expect(result.success).toBe(false);

    // Clean up the start promise
    resolveSSE();
    await startPromise;
  });

  it('removes signal data directory via rmSync', async () => {
    await signalPlugin.logout();

    expect(mockGetAuthDir).toHaveBeenCalledWith('signal');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/test-signal', {
      recursive: true,
      force: true,
    });
  });

  it('sets connectionStatus to "disconnected"', async () => {
    await signalPlugin.logout();

    expect(signalPlugin.getStatus()).toBe('disconnected');
  });

  it('succeeds even when no daemon is active', async () => {
    // Should not throw when currentDaemon is null
    await expect(signalPlugin.logout()).resolves.toBeUndefined();
  });

  it('does not throw if rmSync fails', async () => {
    mockRmSync.mockImplementation(() => {
      throw new Error('EPERM: permission denied');
    });

    // The logout should still succeed (logs warning but doesn't throw)
    await expect(signalPlugin.logout()).resolves.toBeUndefined();
  });
});
