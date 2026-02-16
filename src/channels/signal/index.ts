/**
 * MyndHyve CLI — Signal Channel Plugin
 *
 * Implements the ChannelPlugin interface using signal-cli's
 * JSON-RPC daemon + SSE event stream.
 * Auto-registers with the channel registry on import.
 */

import type { ChannelPlugin } from '../types.js';
import type { ChatIngressEnvelope, ChatEgressEnvelope, DeliveryResult } from '../../relay/types.js';
import { registerChannel } from '../registry.js';
import { createLogger } from '../../utils/logger.js';
import { sleep } from '../../utils/backoff.js';
import { getAuthDir, ensureAuthDir } from '../../config/loader.js';
import {
  startSignalDaemon,
  isSignalCliInstalled,
  hasAccountData,
  type SignalDaemon,
} from './daemon.js';
import { connectSignalSSE } from './inbound.js';
import { deliverSignalMessage } from './outbound.js';
import { startLink, finishLink, getVersion } from './client.js';
import { SIGNAL_DAEMON_DEFAULTS } from './types.js';

const log = createLogger('Signal');

// ============================================================================
// PLUGIN STATE
// ============================================================================

let currentDaemon: SignalDaemon | null = null;
let connectionStatus: string = 'disconnected';

// ============================================================================
// CHANNEL PLUGIN
// ============================================================================

const signalPlugin: ChannelPlugin = {
  channel: 'signal',
  displayName: 'Signal',
  isSupported: true, // Signal works on all platforms (via signal-cli)
  unsupportedReason: undefined,

  async login(): Promise<void> {
    log.info('Starting Signal login...');

    const dataDir = ensureAuthDir('signal');

    // Check signal-cli is installed
    const installed = await isSignalCliInstalled();
    if (!installed) {
      throw new Error(
        'signal-cli is not installed.\n' +
        '  Install: https://github.com/AsamK/signal-cli#installation\n' +
        '  macOS:   brew install signal-cli'
      );
    }

    // Start a temporary daemon for the login process
    const daemon = await startSignalDaemon({
      dataDir,
      host: SIGNAL_DAEMON_DEFAULTS.host,
      port: SIGNAL_DAEMON_DEFAULTS.port,
    });

    try {
      const chalk = (await import('chalk')).default;

      // Get signal-cli version for user info
      const version = await getVersion(daemon.baseUrl);
      console.log(chalk.gray(`  signal-cli version: ${version}`));

      // Device linking flow (QR code)
      console.log(chalk.cyan('\n  Generating device link...'));
      console.log(chalk.gray('  Open Signal on your phone → Settings → Linked Devices → Link New Device\n'));

      const linkResult = await startLink(daemon.baseUrl, 'MyndHyve Relay');

      // Display the link URI as a QR code in terminal
      try {
        const qrcode = (await import('qrcode-terminal')).default;
        qrcode.generate(linkResult.deviceLinkUri, { small: true }, (qr: string) => {
          console.log(qr);
        });
      } catch {
        // qrcode-terminal may not be available — show URI as fallback
        console.log(chalk.yellow('  Scan this URI with Signal:'));
        console.log(chalk.white(`  ${linkResult.deviceLinkUri}\n`));
      }

      console.log(chalk.gray('  Waiting for you to scan the QR code...\n'));

      // Finish linking (blocks until QR is scanned)
      const finishResult = await finishLink(daemon.baseUrl, linkResult.deviceLinkUri);

      log.info('Signal linked successfully', {
        number: finishResult.number,
        uuid: finishResult.uuid,
      });
      console.log(chalk.green(`  Linked to Signal account: ${finishResult.number}`));

      // Give signal-cli time to persist account data
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      daemon.stop();
    }
  },

  async isAuthenticated(): Promise<boolean> {
    const dataDir = getAuthDir('signal');
    return hasAccountData(dataDir);
  },

  async start(
    onInbound: (envelope: ChatIngressEnvelope) => Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    const dataDir = getAuthDir('signal');

    log.info('Starting Signal channel...');
    connectionStatus = 'connecting';

    let daemon: Awaited<ReturnType<typeof startSignalDaemon>> | null = null;

    try {
      // Start the signal-cli daemon
      daemon = await startSignalDaemon({
        dataDir,
        host: SIGNAL_DAEMON_DEFAULTS.host,
        port: SIGNAL_DAEMON_DEFAULTS.port,
      });

      // Only expose daemon after successful start
      currentDaemon = daemon;
      connectionStatus = 'connected';
      log.info('Signal connected');

      // Connect SSE with auto-reconnect on transient stream drops.
      // The daemon stays alive — only the SSE event stream needs reconnecting.
      const MAX_SSE_RECONNECTS = 10;
      const SSE_RECONNECT_BASE_MS = 1000;

      for (let attempt = 0; attempt <= MAX_SSE_RECONNECTS; attempt++) {
        try {
          await connectSignalSSE(daemon.baseUrl, onInbound, signal);
          // Clean exit (stream ended normally or abort) — stop reconnecting
          break;
        } catch (sseError) {
          if (signal.aborted) break;

          if (attempt >= MAX_SSE_RECONNECTS) {
            log.error('SSE reconnection limit reached, giving up', { attempts: attempt });
            throw sseError;
          }

          const delayMs = SSE_RECONNECT_BASE_MS * Math.pow(2, Math.min(attempt, 5));
          log.warn('SSE stream dropped, reconnecting...', {
            attempt: attempt + 1,
            delayMs,
            error: sseError instanceof Error ? sseError.message : String(sseError),
          });

          await sleep(delayMs);
        }
      }
    } catch (error) {
      // Clean up on any failure
      daemon?.stop();
      throw error;
    } finally {
      currentDaemon = null;
      connectionStatus = 'disconnected';

      // Ensure daemon is stopped on exit
      daemon?.stop();
    }
  },

  async deliver(envelope: ChatEgressEnvelope): Promise<DeliveryResult> {
    if (!currentDaemon) {
      return {
        success: false,
        error: 'Signal not connected',
        retryable: true,
      };
    }

    return deliverSignalMessage(currentDaemon.baseUrl, envelope);
  },

  getStatus(): string {
    return connectionStatus;
  },

  async logout(): Promise<void> {
    if (currentDaemon) {
      currentDaemon.stop();
      currentDaemon = null;
    }

    connectionStatus = 'disconnected';

    // Remove signal-cli data directory
    try {
      const fs = await import('node:fs');
      const authDir = getAuthDir('signal');
      fs.rmSync(authDir, { recursive: true, force: true });
      log.info('Signal credentials cleared');
    } catch (error) {
      log.warn('Failed to clear Signal credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

// ============================================================================
// AUTO-REGISTER
// ============================================================================

registerChannel(signalPlugin);

export { signalPlugin };
