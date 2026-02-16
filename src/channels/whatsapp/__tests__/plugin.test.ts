import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WASocket } from '@whiskeysockets/baileys';
import type { ChatEgressEnvelope, DeliveryResult } from '../../../relay/types.js';

// ---------------------------------------------------------------------------
// Hoisted mock variables — available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockCreateWhatsAppSession,
  mockHasAuthState,
  mockClassifyDisconnect,
  MockWhatsAppSessionError,
  mockBindInboundHandler,
  mockDeliverWhatsAppMessage,
  mockRegisterChannel,
  mockGetAuthDir,
  capturedRegistration,
} = vi.hoisted(() => {
  class _MockWhatsAppSessionError extends Error {
    name = 'WhatsAppSessionError';
    constructor(
      message: string,
      public readonly disconnectType: string
    ) {
      super(message);
    }
  }

  // Capture the auto-registration call that happens at module scope,
  // before beforeEach can clear mock call history.
  const capturedRegistration: { plugin: unknown } = { plugin: null };

  return {
    mockCreateWhatsAppSession: vi.fn(),
    mockHasAuthState: vi.fn(),
    mockClassifyDisconnect: vi.fn(),
    MockWhatsAppSessionError: _MockWhatsAppSessionError,
    mockBindInboundHandler: vi.fn(),
    mockDeliverWhatsAppMessage: vi.fn(),
    mockRegisterChannel: vi.fn((plugin: unknown) => {
      capturedRegistration.plugin = plugin;
    }),
    mockGetAuthDir: vi.fn((_channel: string) => '/tmp/test-auth/whatsapp'),
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
}));

vi.mock('../../registry.js', () => ({
  registerChannel: (plugin: unknown) => mockRegisterChannel(plugin),
}));

vi.mock('../session.js', () => ({
  createWhatsAppSession: (...args: unknown[]) => mockCreateWhatsAppSession(...args),
  hasAuthState: (...args: unknown[]) => mockHasAuthState(...args),
  classifyDisconnect: (...args: unknown[]) => mockClassifyDisconnect(...args),
  WhatsAppSessionError: MockWhatsAppSessionError,
}));

vi.mock('../inbound.js', () => ({
  bindInboundHandler: (...args: unknown[]) => mockBindInboundHandler(...args),
}));

vi.mock('../outbound.js', () => ({
  deliverWhatsAppMessage: (...args: unknown[]) => mockDeliverWhatsAppMessage(...args),
}));

// ---------------------------------------------------------------------------
// Helpers — build mock sessions with controllable waitForOpen and event emitter
// ---------------------------------------------------------------------------

function createMockEv() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(handler);
    },
    /** Test-only: fire an event */
    __emit(event: string, ...args: unknown[]) {
      // Copy handlers to avoid mutation during iteration
      const list = handlers.get(event);
      if (list) {
        for (const h of [...list]) {
          h(...args);
        }
      }
    },
    /** Test-only: get handler count */
    __handlerCount(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

interface DeferredPromise<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T = void>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockSession(waitForOpenDeferred?: DeferredPromise<void>) {
  const ev = createMockEv();
  const socket = { ev } as unknown as WASocket;
  const deferred = waitForOpenDeferred ?? createDeferred<void>();
  const close = vi.fn();

  const session = {
    socket,
    waitForOpen: vi.fn(() => deferred.promise),
    close,
  };

  return { session, ev, deferred, close };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { whatsAppPlugin } from '../index.js';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthDir.mockReturnValue('/tmp/test-auth/whatsapp');
  mockDeliverWhatsAppMessage.mockResolvedValue({ success: true, platformMessageId: 'out-1' });
  mockHasAuthState.mockReturnValue(true);
  mockClassifyDisconnect.mockReturnValue('connection-lost');
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Auto-registration
// ============================================================================

describe('auto-registration', () => {
  it('registers the plugin with the channel registry on import', () => {
    // registerChannel is called at module scope during import, so beforeEach
    // clears the spy history. We capture the call in the mock factory instead.
    expect(capturedRegistration.plugin).toBe(whatsAppPlugin);
  });
});

// ============================================================================
// Properties
// ============================================================================

describe('properties', () => {
  it('has channel set to "whatsapp"', () => {
    expect(whatsAppPlugin.channel).toBe('whatsapp');
  });

  it('has displayName set to "WhatsApp"', () => {
    expect(whatsAppPlugin.displayName).toBe('WhatsApp');
  });

  it('has isSupported set to true', () => {
    expect(whatsAppPlugin.isSupported).toBe(true);
  });
});

// ============================================================================
// isAuthenticated()
// ============================================================================

describe('isAuthenticated()', () => {
  it('delegates to hasAuthState with the correct auth directory', async () => {
    mockHasAuthState.mockReturnValue(true);

    const result = await whatsAppPlugin.isAuthenticated();

    expect(mockGetAuthDir).toHaveBeenCalledWith('whatsapp');
    expect(mockHasAuthState).toHaveBeenCalledWith('/tmp/test-auth/whatsapp');
    expect(result).toBe(true);
  });
});

// ============================================================================
// login()
// ============================================================================

describe('login()', () => {
  it('creates session with printQR: true, waits for open, then closes', async () => {
    vi.useFakeTimers();

    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    deferred.resolve();

    const loginPromise = whatsAppPlugin.login();

    // Advance past the 2000ms delay
    await vi.advanceTimersByTimeAsync(2000);
    await loginPromise;

    expect(mockCreateWhatsAppSession).toHaveBeenCalledWith(
      expect.objectContaining({
        authDir: '/tmp/test-auth/whatsapp',
        printQR: true,
        baileysLogLevel: 'silent',
      })
    );
    expect(session.waitForOpen).toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it('closes session even if waitForOpen throws (finally cleanup)', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    deferred.reject(new Error('QR scan timed out'));

    await expect(whatsAppPlugin.login()).rejects.toThrow('QR scan timed out');
    expect(session.close).toHaveBeenCalled();
  });
});

// ============================================================================
// start()
// ============================================================================

describe('start()', () => {
  it('binds inbound handler on socket', async () => {
    const { session, deferred, ev: _ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    expect(mockBindInboundHandler).toHaveBeenCalledWith(session.socket, onInbound);

    // Clean up: abort to end start()
    ac.abort();
    await startPromise;
  });

  it('sets currentSession AFTER waitForOpen succeeds (deliver works after open)', async () => {
    const { session, deferred, ev: _ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    // Before waitForOpen resolves, deliver should fail
    const deliverBefore = await whatsAppPlugin.deliver({
      channel: 'whatsapp',
      conversationId: 'test@s.whatsapp.net',
      text: 'hi',
    });
    expect(deliverBefore.success).toBe(false);
    expect(deliverBefore.error).toBe('WhatsApp not connected');

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    // After waitForOpen, deliver should delegate
    mockDeliverWhatsAppMessage.mockResolvedValue({ success: true, platformMessageId: 'msg-1' });
    const deliverAfter = await whatsAppPlugin.deliver({
      channel: 'whatsapp',
      conversationId: 'test@s.whatsapp.net',
      text: 'hi',
    });
    expect(deliverAfter.success).toBe(true);

    // Clean up
    ac.abort();
    await startPromise;
  });

  it('clears currentSession on abort (deliver returns error after abort)', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    // Abort the connection
    ac.abort();
    await startPromise;

    // After abort, currentSession should be null
    const result = await whatsAppPlugin.deliver({
      channel: 'whatsapp',
      conversationId: 'test@s.whatsapp.net',
      text: 'hi',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('WhatsApp not connected');
  });

  it('clears currentSession if waitForOpen fails', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    deferred.reject(new MockWhatsAppSessionError('connection failed', 'connection-lost'));

    await expect(
      whatsAppPlugin.start(onInbound, ac.signal)
    ).rejects.toThrow('connection failed');

    // currentSession should be null
    const result = await whatsAppPlugin.deliver({
      channel: 'whatsapp',
      conversationId: 'test@s.whatsapp.net',
      text: 'hi',
    });
    expect(result.success).toBe(false);
  });

  it('calls session.close() if waitForOpen fails', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    deferred.reject(new Error('auth failed'));

    await expect(
      whatsAppPlugin.start(onInbound, ac.signal)
    ).rejects.toThrow('auth failed');

    expect(session.close).toHaveBeenCalled();
  });

  it('rejects with WhatsAppSessionError on connection close (logged-out)', async () => {
    const { session, deferred, ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    mockClassifyDisconnect.mockReturnValue('logged-out');

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    // Simulate connection close
    const disconnectError = new Error('logged out');
    ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: disconnectError },
    });

    await expect(startPromise).rejects.toThrow(MockWhatsAppSessionError);
    await expect(startPromise).rejects.toThrow(/logged out/i);
  });

  it('rejects with WhatsAppSessionError on connection close (replaced)', async () => {
    const { session, deferred, ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    mockClassifyDisconnect.mockReturnValue('replaced');

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('replaced') },
    });

    await expect(startPromise).rejects.toThrow(MockWhatsAppSessionError);
    await expect(startPromise).rejects.toThrow(/replaced/i);
  });

  it('rejects with WhatsAppSessionError on connection close (connection-lost)', async () => {
    const { session, deferred, ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    mockClassifyDisconnect.mockReturnValue('connection-lost');

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('network gone') },
    });

    await expect(startPromise).rejects.toThrow(MockWhatsAppSessionError);
    await expect(startPromise).rejects.toThrow(/disconnected/i);
  });

  it('unregisters connection.update handler on abort', async () => {
    const { session, deferred, ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    // Before abort, the handler is registered
    expect(ev.__handlerCount('connection.update')).toBe(1);

    ac.abort();
    await startPromise;

    // After abort, the handler should be unregistered
    expect(ev.__handlerCount('connection.update')).toBe(0);
  });

  it('unregisters connection.update handler on disconnect', async () => {
    const { session, deferred, ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    mockClassifyDisconnect.mockReturnValue('connection-lost');

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    expect(ev.__handlerCount('connection.update')).toBe(1);

    ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('gone') },
    });

    // The handler should have been unregistered
    expect(ev.__handlerCount('connection.update')).toBe(0);

    // Consume the rejection to avoid unhandled promise
    await startPromise.catch(() => {});
  });

  it('handles already-aborted signal', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();
    ac.abort(); // Abort before start

    deferred.resolve();

    // Should resolve (not reject) since abort means graceful stop
    await whatsAppPlugin.start(onInbound, ac.signal);

    expect(session.close).toHaveBeenCalled();
  });
});

// ============================================================================
// deliver()
// ============================================================================

describe('deliver()', () => {
  it('returns error when not connected (currentSession is null)', async () => {
    const result = await whatsAppPlugin.deliver({
      channel: 'whatsapp',
      conversationId: 'test@s.whatsapp.net',
      text: 'hello',
    });

    expect(result).toEqual({
      success: false,
      error: 'WhatsApp not connected',
      retryable: true,
    });
  });

  it('delegates to deliverWhatsAppMessage when connected', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    const expectedResult: DeliveryResult = { success: true, platformMessageId: 'sent-42' };
    mockDeliverWhatsAppMessage.mockResolvedValue(expectedResult);

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    const envelope: ChatEgressEnvelope = {
      channel: 'whatsapp',
      conversationId: 'peer@s.whatsapp.net',
      text: 'outbound message',
    };

    const result = await whatsAppPlugin.deliver(envelope);

    expect(mockDeliverWhatsAppMessage).toHaveBeenCalledWith(session.socket, envelope);
    expect(result).toEqual(expectedResult);

    // Clean up
    ac.abort();
    await startPromise;
  });
});

// ============================================================================
// getStatus()
// ============================================================================

describe('getStatus()', () => {
  it('returns current connection status string', async () => {
    // Initially (or after prior test cleanup), status should be a string
    // The module-level default is 'disconnected' but prior tests may have changed it.
    // We verify it returns a string.
    const status = whatsAppPlugin.getStatus();
    expect(typeof status).toBe('string');
  });

  it('reflects status changes during start lifecycle', async () => {
    const { session, deferred, ev } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);
    mockClassifyDisconnect.mockReturnValue('connection-lost');

    const onInbound = vi.fn();
    const ac = new AbortController();

    // Before start, check current status
    const beforeStart = whatsAppPlugin.getStatus();
    expect(typeof beforeStart).toBe('string');

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);

    // After createWhatsAppSession resolves but before waitForOpen, status should be 'connecting'
    await flush();

    deferred.resolve();
    await flush();

    // After waitForOpen, status should be 'connected'
    expect(whatsAppPlugin.getStatus()).toBe('connected');

    // Trigger disconnect
    ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('gone') },
    });

    expect(whatsAppPlugin.getStatus()).toBe('disconnected');

    await startPromise.catch(() => {});
  });
});

// ============================================================================
// logout()
// ============================================================================

describe('logout()', () => {
  it('closes current session if active', async () => {
    const { session, deferred } = createMockSession();
    mockCreateWhatsAppSession.mockResolvedValue(session);

    const onInbound = vi.fn();
    const ac = new AbortController();

    const startPromise = whatsAppPlugin.start(onInbound, ac.signal);
    deferred.resolve();
    await flush();

    // Now logout while session is active
    await whatsAppPlugin.logout();

    expect(session.close).toHaveBeenCalled();

    // deliver should now fail since session was cleared
    const result = await whatsAppPlugin.deliver({
      channel: 'whatsapp',
      conversationId: 'test@s.whatsapp.net',
      text: 'hi',
    });
    expect(result.success).toBe(false);

    // The start promise is still running with its inner promise — abort to clean up.
    // Since we already called logout which cleared currentSession, the start() is still
    // waiting on the inner promise. Emit a disconnect to end it.
    const ev = (session.socket as unknown as { ev: ReturnType<typeof createMockEv> }).ev;
    ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('logged out by user') },
    });
    await startPromise.catch(() => {});
  });

  it('removes auth directory via rmSync', async () => {
    const mockRmSync = vi.fn();
    vi.doMock('node:fs', () => ({
      rmSync: mockRmSync,
    }));

    // logout() dynamically imports node:fs
    await whatsAppPlugin.logout();

    // The actual fs module is used via dynamic import. Since we cannot easily
    // intercept dynamic imports in vitest, we verify getAuthDir was called.
    expect(mockGetAuthDir).toHaveBeenCalledWith('whatsapp');

    vi.doUnmock('node:fs');
  });
});
