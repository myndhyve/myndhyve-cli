/**
 * MyndHyve CLI — WhatsApp Session Management
 *
 * Creates and manages the Baileys WhatsApp socket connection.
 * Handles auth state persistence, QR code display, and credential
 * save queuing (from OpenClaw's sequential save pattern).
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../utils/logger.js';
import { ensureAuthDir } from '../../config/loader.js';

const log = createLogger('WhatsApp:Session');

// ============================================================================
// TYPES
// ============================================================================

export interface WhatsAppSessionOptions {
  /** Directory to store auth state files */
  authDir: string;
  /** Whether to show QR code in terminal */
  printQR?: boolean;
  /** Pino log level for Baileys internals */
  baileysLogLevel?: 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

export interface WhatsAppSession {
  socket: WASocket;
  /** Wait for the connection to open (or fail) */
  waitForOpen(): Promise<void>;
  /** Clean up the session */
  close(): void;
}

/** Reasons a WhatsApp session may terminate */
export type DisconnectType = 'logged-out' | 'connection-lost' | 'replaced' | 'unknown';

// ============================================================================
// SESSION FACTORY
// ============================================================================

/**
 * Create a new WhatsApp socket with multi-file auth state.
 *
 * The socket starts connecting immediately. Use `waitForOpen()` to
 * block until the connection is established or fails.
 */
export async function createWhatsAppSession(
  options: WhatsAppSessionOptions
): Promise<WhatsAppSession> {
  const { authDir, printQR = true, baileysLogLevel = 'silent' } = options;

  // Ensure auth directory exists
  ensureAuthDir('whatsapp');

  // eslint-disable-next-line react-hooks/rules-of-hooks -- Baileys API, not a React hook
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Create sequential save queue to prevent corruption (from OpenClaw pattern)
  const credsSaveQueue = createCredsSaveQueue(saveCreds);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: printQR,
    browser: Browsers.ubuntu('MyndHyve Relay'),
    logger: pino({ level: baileysLogLevel }),
    markOnlineOnConnect: false, // Don't mark as online — we're a relay, not a user
    defaultQueryTimeoutMs: undefined, // No timeout for queries
  });

  // Save credentials on update (using sequential queue)
  socket.ev.on('creds.update', () => {
    credsSaveQueue.enqueue();
  });

  const session: WhatsAppSession = {
    socket,
    waitForOpen: () => waitForConnection(socket),
    close: () => {
      try {
        socket.end(undefined);
      } catch {
        // Socket may already be closed
      }
    },
  };

  return session;
}

// ============================================================================
// CONNECTION HELPERS
// ============================================================================

/**
 * Wait for the socket to reach 'open' state.
 * Rejects if the connection closes before opening.
 */
function waitForConnection(socket: WASocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handler = (update: Partial<ConnectionState>) => {
      if (update.connection === 'open') {
        socket.ev.off('connection.update', handler);
        log.info('Connected to WhatsApp');
        resolve();
      }

      if (update.connection === 'close') {
        socket.ev.off('connection.update', handler);
        const error = update.lastDisconnect?.error;
        const statusCode = (error as Boom)?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          reject(new WhatsAppSessionError(
            'WhatsApp session logged out. Run `myndhyve-cli relay login` to re-authenticate.',
            'logged-out'
          ));
        } else {
          reject(new WhatsAppSessionError(
            `WhatsApp connection failed: ${error?.message || 'unknown error'}`,
            'connection-lost'
          ));
        }
      }
    };

    socket.ev.on('connection.update', handler);
  });
}

/**
 * Classify a disconnect error into a DisconnectType.
 */
export function classifyDisconnect(error: Error | undefined): DisconnectType {
  if (!error) return 'unknown';

  const statusCode = (error as Boom)?.output?.statusCode;

  switch (statusCode) {
    case DisconnectReason.loggedOut:
    case DisconnectReason.forbidden:
      return 'logged-out';
    case DisconnectReason.connectionReplaced:
      return 'replaced';
    case DisconnectReason.connectionLost:
    case DisconnectReason.connectionClosed:
    case DisconnectReason.timedOut:
    case DisconnectReason.restartRequired:
    case DisconnectReason.multideviceMismatch:
    case DisconnectReason.badSession:
    case DisconnectReason.unavailableService:
      return 'connection-lost';
    default:
      return 'unknown';
  }
}

/**
 * Check if auth state files exist (i.e., previously logged in).
 */
export function hasAuthState(authDir: string): boolean {
  try {
    const credsPath = join(authDir, 'creds.json');
    return existsSync(credsPath);
  } catch {
    return false;
  }
}

// ============================================================================
// CREDENTIAL SAVE QUEUE (from OpenClaw pattern)
// ============================================================================

/**
 * Sequential credential save queue.
 *
 * Baileys fires creds.update frequently. If saves overlap, the auth
 * state files can become corrupted. This queue ensures saves happen
 * one at a time (from OpenClaw src/web/session.ts pattern).
 */
function createCredsSaveQueue(saveCreds: () => Promise<void>) {
  let saving = false;
  let queued = false;

  const flush = async () => {
    if (saving) {
      queued = true;
      return;
    }

    saving = true;
    try {
      await saveCreds();
    } catch (error) {
      log.warn('Failed to save credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      saving = false;
      if (queued) {
        queued = false;
        flush();
      }
    }
  };

  return { enqueue: flush };
}

// ============================================================================
// ERROR
// ============================================================================

export class WhatsAppSessionError extends Error {
  constructor(
    message: string,
    public readonly disconnectType: DisconnectType
  ) {
    super(message);
    this.name = 'WhatsAppSessionError';
  }
}
