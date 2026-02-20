import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted variables — available inside vi.mock() factories
// ---------------------------------------------------------------------------

/**
 * EventEmitter-like mock for the Baileys socket `.ev` object.
 * Stores handlers per event and allows tests to fire events.
 */
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
      handlers.get(event)?.forEach((h) => { h(...args); });
    },
    /** Test-only: get handler count */
    __handlerCount(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

function createMockSocket() {
  const ev = createMockEv();
  return {
    ev,
    end: vi.fn(),
  };
}

const {
  mockSaveCreds,
  mockMakeWASocket,
  mockSocketHolder,
} = vi.hoisted(() => {
  // We cannot call createMockSocket() here (it's not hoisted), so we use
  // an indirection: the mock factory calls mockMakeWASocket which returns
  // whatever mockSocketHolder.current is at call time.
  const mockSaveCreds = vi.fn().mockResolvedValue(undefined);
  const mockSocketHolder = { current: null as ReturnType<typeof createMockSocket> | null };
  const mockMakeWASocket = vi.fn((_config?: unknown) => mockSocketHolder.current);

  return { mockSaveCreds, mockMakeWASocket, mockSocketHolder };
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
  ensureAuthDir: vi.fn(),
  getAuthDir: vi.fn(() => '/tmp/test-auth/whatsapp'),
}));

vi.mock('@whiskeysockets/baileys', () => ({
  default: (config: unknown) => mockMakeWASocket(config),
  useMultiFileAuthState: vi.fn().mockResolvedValue({
    state: { creds: {}, keys: {} },
    saveCreds: mockSaveCreds,
  }),
  DisconnectReason: {
    loggedOut: 401,
    connectionClosed: 428,
    connectionLost: 408,
    forbidden: 403,
    connectionReplaced: 440,
    timedOut: 408,
    restartRequired: 515,
    multideviceMismatch: 411,
    badSession: 500,
    unavailableService: 503,
  },
  Browsers: {
    ubuntu: vi.fn(() => ['Ubuntu', 'Chrome', '22.0']),
  },
}));

vi.mock('@hapi/boom', () => {
  class Boom extends Error {
    output: { statusCode: number };
    constructor(message: string, opts?: { statusCode?: number }) {
      super(message);
      this.output = { statusCode: opts?.statusCode ?? 500 };
    }
  }
  return { Boom };
});

vi.mock('pino', () => ({
  default: vi.fn(() => ({ level: 'silent' })),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  createWhatsAppSession,
  classifyDisconnect,
  hasAuthState,
  WhatsAppSessionError,
} from '../session.js';
import { useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

let mockSocket: ReturnType<typeof createMockSocket>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSocket = createMockSocket();
  mockSocketHolder.current = mockSocket;
  mockMakeWASocket.mockReturnValue(mockSocket);
});

// ============================================================================
// createWhatsAppSession
// ============================================================================

describe('createWhatsAppSession', () => {
  it('creates a session with socket and waitForOpen method', async () => {
    const session = await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    expect(session).toBeDefined();
    expect(session.socket).toBe(mockSocket);
    expect(typeof session.waitForOpen).toBe('function');
    expect(typeof session.close).toBe('function');
  });

  it('calls useMultiFileAuthState with the auth directory', async () => {
    await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    expect(useMultiFileAuthState).toHaveBeenCalledWith('/tmp/test-auth/whatsapp');
  });

  it('passes correct options to makeWASocket', async () => {
    await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
      printQR: true,
      baileysLogLevel: 'error',
    });

    expect(Browsers.ubuntu).toHaveBeenCalledWith('MyndHyve Relay');
    expect(mockMakeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { creds: {}, keys: {} },
        printQRInTerminal: true,
        browser: ['Ubuntu', 'Chrome', '22.0'],
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: undefined,
      })
    );
  });

  it('defaults printQR to true and baileysLogLevel to silent', async () => {
    await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    expect(mockMakeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({
        printQRInTerminal: true,
      })
    );
  });

  it('registers creds.update handler that enqueues saves', async () => {
    await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    // The session should have registered a creds.update handler
    expect(mockSocket.ev.__handlerCount('creds.update')).toBe(1);

    // Fire the event and verify saveCreds is called
    mockSocket.ev.__emit('creds.update');
    // flush microtasks
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mockSaveCreds).toHaveBeenCalled();
  });

  it('waitForOpen resolves when connection opens', async () => {
    const session = await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    // Start waiting (don't await yet)
    const waitPromise = session.waitForOpen();

    // Simulate connection open
    mockSocket.ev.__emit('connection.update', { connection: 'open' });

    await expect(waitPromise).resolves.toBeUndefined();
  });

  it('waitForOpen rejects when connection closes with loggedOut', async () => {
    const session = await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    const waitPromise = session.waitForOpen();

    // Simulate close with loggedOut status code
    const boomError = new Boom('logged out', { statusCode: 401 });
    mockSocket.ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: boomError },
    });

    await expect(waitPromise).rejects.toThrow(WhatsAppSessionError);
    await expect(waitPromise).rejects.toThrow(/re-authenticate/);
  });

  it('waitForOpen rejects with connection-lost for other close reasons', async () => {
    const session = await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    const waitPromise = session.waitForOpen();

    // Simulate close with a generic error
    const err = new Error('server went away');
    mockSocket.ev.__emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: err },
    });

    await expect(waitPromise).rejects.toThrow(WhatsAppSessionError);
    await expect(waitPromise).rejects.toThrow(/connection failed/i);
  });

  it('close() calls socket.end()', async () => {
    const session = await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    session.close();

    expect(mockSocket.end).toHaveBeenCalledWith(undefined);
  });

  it('close() does not throw if socket.end() throws', async () => {
    mockSocket.end.mockImplementation(() => {
      throw new Error('already closed');
    });

    const session = await createWhatsAppSession({
      authDir: '/tmp/test-auth/whatsapp',
    });

    // Should not throw
    expect(() => session.close()).not.toThrow();
  });
});

// ============================================================================
// classifyDisconnect
// ============================================================================

describe('classifyDisconnect', () => {
  it('returns "logged-out" for DisconnectReason.loggedOut (401)', () => {
    const err = new Boom('logged out', { statusCode: 401 });
    expect(classifyDisconnect(err)).toBe('logged-out');
  });

  it('returns "logged-out" for DisconnectReason.forbidden (403)', () => {
    const err = new Boom('forbidden', { statusCode: 403 });
    expect(classifyDisconnect(err)).toBe('logged-out');
  });

  it('returns "replaced" for DisconnectReason.connectionReplaced (440)', () => {
    const err = new Boom('replaced', { statusCode: 440 });
    expect(classifyDisconnect(err)).toBe('replaced');
  });

  it('returns "connection-lost" for connectionClosed (428)', () => {
    const err = new Boom('closed', { statusCode: 428 });
    expect(classifyDisconnect(err)).toBe('connection-lost');
  });

  it('returns "connection-lost" for connectionLost (408)', () => {
    const err = new Boom('lost', { statusCode: 408 });
    expect(classifyDisconnect(err)).toBe('connection-lost');
  });

  it('returns "connection-lost" for restartRequired (515)', () => {
    const err = new Boom('restart', { statusCode: 515 });
    expect(classifyDisconnect(err)).toBe('connection-lost');
  });

  it('returns "connection-lost" for multideviceMismatch (411)', () => {
    const err = new Boom('mismatch', { statusCode: 411 });
    expect(classifyDisconnect(err)).toBe('connection-lost');
  });

  it('returns "connection-lost" for badSession (500)', () => {
    const err = new Boom('bad session', { statusCode: 500 });
    expect(classifyDisconnect(err)).toBe('connection-lost');
  });

  it('returns "connection-lost" for unavailableService (503)', () => {
    const err = new Boom('unavailable', { statusCode: 503 });
    expect(classifyDisconnect(err)).toBe('connection-lost');
  });

  it('returns "unknown" for null/undefined error', () => {
    expect(classifyDisconnect(undefined)).toBe('unknown');
  });

  it('returns "unknown" for unrecognized error (no Boom output)', () => {
    const err = new Error('some random error');
    expect(classifyDisconnect(err)).toBe('unknown');
  });

  it('returns "unknown" for unrecognized Boom status code', () => {
    const err = new Boom('weird', { statusCode: 999 });
    expect(classifyDisconnect(err)).toBe('unknown');
  });
});

// ============================================================================
// hasAuthState
// ============================================================================

describe('hasAuthState', () => {
  it('returns true when creds.json exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    expect(hasAuthState('/tmp/test-auth/whatsapp')).toBe(true);
    expect(existsSync).toHaveBeenCalledWith('/tmp/test-auth/whatsapp/creds.json');
  });

  it('returns false when creds.json does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(hasAuthState('/tmp/test-auth/whatsapp')).toBe(false);
  });

  it('returns false on error', () => {
    vi.mocked(existsSync).mockImplementation(() => {
      throw new Error('permission denied');
    });

    expect(hasAuthState('/tmp/test-auth/whatsapp')).toBe(false);
  });
});

// ============================================================================
// WhatsAppSessionError
// ============================================================================

describe('WhatsAppSessionError', () => {
  it('has correct name property', () => {
    const err = new WhatsAppSessionError('test', 'logged-out');
    expect(err.name).toBe('WhatsAppSessionError');
  });

  it('has disconnectType property', () => {
    const err = new WhatsAppSessionError('test message', 'connection-lost');
    expect(err.disconnectType).toBe('connection-lost');
  });

  it('extends Error with message', () => {
    const err = new WhatsAppSessionError('session expired', 'replaced');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('session expired');
  });

  it('supports all disconnect types', () => {
    const types = ['logged-out', 'connection-lost', 'replaced', 'unknown'] as const;
    for (const t of types) {
      const err = new WhatsAppSessionError(`type: ${t}`, t);
      expect(err.disconnectType).toBe(t);
    }
  });
});
