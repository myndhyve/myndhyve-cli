/**
 * MyndHyve CLI — WhatsApp Channel Plugin
 *
 * Implements the ChannelPlugin interface using Baileys (WhatsApp Web).
 * Auto-registers with the channel registry on import.
 */

import type { ConnectionState } from '@whiskeysockets/baileys';
import type { ChannelPlugin } from '../types.js';
import type { ChatIngressEnvelope, ChatEgressEnvelope, DeliveryResult } from '../../relay/types.js';
import { registerChannel } from '../registry.js';
import { createLogger } from '../../utils/logger.js';
import { getAuthDir } from '../../config/loader.js';
import {
  createWhatsAppSession,
  classifyDisconnect,
  hasAuthState,
  WhatsAppSessionError,
  type WhatsAppSession,
} from './session.js';
import { bindInboundHandler } from './inbound.js';
import { deliverWhatsAppMessage } from './outbound.js';

const log = createLogger('WhatsApp');

// ============================================================================
// PLUGIN STATE
// ============================================================================

let currentSession: WhatsAppSession | null = null;
let connectionStatus: string = 'disconnected';

// ============================================================================
// CHANNEL PLUGIN
// ============================================================================

const whatsAppPlugin: ChannelPlugin = {
  channel: 'whatsapp',
  displayName: 'WhatsApp',
  isSupported: true, // WhatsApp works on all platforms
  unsupportedReason: undefined,

  async login(): Promise<void> {
    log.info('Starting WhatsApp login (QR code)...');

    const authDir = getAuthDir('whatsapp');

    // Create a temporary session just for login (QR scan)
    const session = await createWhatsAppSession({
      authDir,
      printQR: true,
      baileysLogLevel: 'silent',
    });

    try {
      // Wait for the connection to open (user scans QR)
      await session.waitForOpen();
      log.info('WhatsApp login successful');

      // Give Baileys a moment to persist the auth state
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      // Close the login session — we'll create a new one in start()
      session.close();
    }
  },

  async isAuthenticated(): Promise<boolean> {
    const authDir = getAuthDir('whatsapp');
    return hasAuthState(authDir);
  },

  async start(
    onInbound: (envelope: ChatIngressEnvelope) => Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    const authDir = getAuthDir('whatsapp');

    log.info('Starting WhatsApp channel...');
    connectionStatus = 'connecting';

    const session = await createWhatsAppSession({
      authDir,
      printQR: false, // Don't print QR during start — should already be logged in
      baileysLogLevel: 'silent',
    });

    const socket = session.socket;

    // Bind inbound message handler
    bindInboundHandler(socket, onInbound);

    try {
      // Wait for initial connection
      await session.waitForOpen();

      // Only expose session after successful open (fixes stale-session bug)
      currentSession = session;
      connectionStatus = 'connected';
      log.info('WhatsApp connected');

      // Run until signal abort or fatal disconnect
      await new Promise<void>((resolve, reject) => {
        // Connection update handler — tracked so we can unregister on cleanup
        const connHandler = (update: Partial<ConnectionState>) => {
          if (update.connection === 'close') {
            socket.ev.off('connection.update', connHandler);
            signal.removeEventListener('abort', onAbort);
            connectionStatus = 'disconnected';

            const error = update.lastDisconnect?.error;
            const disconnectType = classifyDisconnect(error);

            if (disconnectType === 'logged-out') {
              reject(new WhatsAppSessionError(
                'WhatsApp logged out. Run `myndhyve-cli relay login` to re-authenticate.',
                'logged-out'
              ));
            } else if (disconnectType === 'replaced') {
              reject(new WhatsAppSessionError(
                'WhatsApp connection replaced by another device.',
                'replaced'
              ));
            } else {
              // Connection lost — let the caller decide whether to reconnect
              reject(new WhatsAppSessionError(
                `WhatsApp disconnected: ${error?.message || 'unknown'}`,
                'connection-lost'
              ));
            }
          }

          if (update.connection === 'open') {
            connectionStatus = 'connected';
          }

          if (update.connection === 'connecting') {
            connectionStatus = 'reconnecting';
          }
        };

        // Handle abort signal
        const onAbort = () => {
          socket.ev.off('connection.update', connHandler);
          log.info('Abort signal received, closing WhatsApp...');
          connectionStatus = 'disconnecting';
          session.close();
          resolve();
        };

        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener('abort', onAbort, { once: true });
        socket.ev.on('connection.update', connHandler);
      });
    } catch (error) {
      // Ensure socket is cleaned up on any failure (waitForOpen or disconnect)
      session.close();
      throw error;
    } finally {
      currentSession = null;
    }
  },

  async deliver(envelope: ChatEgressEnvelope): Promise<DeliveryResult> {
    if (!currentSession) {
      return {
        success: false,
        error: 'WhatsApp not connected',
        retryable: true,
      };
    }

    return deliverWhatsAppMessage(currentSession.socket, envelope);
  },

  getStatus(): string {
    return connectionStatus;
  },

  async logout(): Promise<void> {
    if (currentSession) {
      currentSession.close();
      currentSession = null;
    }

    connectionStatus = 'disconnected';

    // Remove auth state files
    try {
      const fs = await import('node:fs');
      const authDir = getAuthDir('whatsapp');
      fs.rmSync(authDir, { recursive: true, force: true });
      log.info('WhatsApp credentials cleared');
    } catch (error) {
      log.warn('Failed to clear WhatsApp credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

// ============================================================================
// AUTO-REGISTER
// ============================================================================

registerChannel(whatsAppPlugin);

export { whatsAppPlugin };
