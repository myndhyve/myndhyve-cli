/**
 * MyndHyve CLI — iMessage Channel Plugin
 *
 * Implements the ChannelPlugin interface using AppleScript (send)
 * and chat.db polling (receive). macOS only.
 * Auto-registers with the channel registry on import.
 */

import type { ChannelPlugin } from '../types.js';
import type { ChatIngressEnvelope, ChatEgressEnvelope, DeliveryResult } from '../../relay/types.js';
import { registerChannel } from '../registry.js';
import { createLogger } from '../../utils/logger.js';
import { sendIMessage, isIMessageConfigured, IMessageSendError } from './send.js';
import { pollIMessages, getChatDbPath } from './receive.js';

const log = createLogger('iMessage');

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

const IS_MACOS = process.platform === 'darwin';

// ============================================================================
// PLUGIN STATE
// ============================================================================

let connectionStatus: string = 'disconnected';
let pollAbortController: AbortController | null = null;

// ============================================================================
// CHANNEL PLUGIN
// ============================================================================

const iMessagePlugin: ChannelPlugin = {
  channel: 'imessage',
  displayName: 'iMessage',
  isSupported: IS_MACOS,
  unsupportedReason: IS_MACOS
    ? undefined
    : 'iMessage is only available on macOS. This platform is not supported.',

  async login(): Promise<void> {
    if (!IS_MACOS) {
      throw new Error(
        'iMessage is only available on macOS.\n' +
        '  Current platform: ' + process.platform
      );
    }

    log.info('Verifying iMessage setup...');

    const chalk = (await import('chalk')).default;

    // Check if Messages.app is configured with iMessage
    const configured = await isIMessageConfigured();

    if (!configured) {
      console.log(chalk.yellow('\n  iMessage is not configured on this Mac.\n'));
      console.log(chalk.gray('  To set up iMessage:'));
      console.log(chalk.gray('    1. Open Messages.app'));
      console.log(chalk.gray('    2. Sign in with your Apple ID'));
      console.log(chalk.gray('    3. Enable iMessage in Messages → Settings → iMessage'));
      console.log(chalk.gray('    4. Run this command again\n'));

      throw new Error('iMessage is not configured. Please set up Messages.app first.');
    }

    // Check chat.db exists
    const { existsSync } = await import('node:fs');
    const dbPath = getChatDbPath();

    if (!existsSync(dbPath)) {
      console.log(chalk.yellow('\n  Messages database not found.\n'));
      console.log(chalk.gray('  Open Messages.app at least once to initialize the database.'));
      console.log(chalk.gray(`  Expected location: ${dbPath}\n`));

      throw new Error('Messages database not found. Please open Messages.app first.');
    }

    // Check Full Disk Access (chat.db requires it)
    try {
      const { accessSync, constants } = await import('node:fs');
      accessSync(dbPath, constants.R_OK);
    } catch {
      console.log(chalk.yellow('\n  Cannot read Messages database.\n'));
      console.log(chalk.gray('  The relay agent needs Full Disk Access to read iMessage data.'));
      console.log(chalk.gray('  To grant access:'));
      console.log(chalk.gray('    1. Open System Settings → Privacy & Security → Full Disk Access'));
      console.log(chalk.gray('    2. Add your terminal application (Terminal.app, iTerm2, etc.)'));
      console.log(chalk.gray('    3. Restart your terminal and run this command again\n'));

      throw new Error('Full Disk Access required. See instructions above.');
    }

    console.log(chalk.green('  iMessage is configured and ready.'));
    console.log(chalk.gray(`  Database: ${dbPath}`));
    log.info('iMessage setup verified');
  },

  async isAuthenticated(): Promise<boolean> {
    if (!IS_MACOS) return false;

    // For iMessage, "authenticated" means:
    // 1. We're on macOS
    // 2. chat.db exists (Messages.app has been opened)
    // 3. We can read it (Full Disk Access granted)
    try {
      const { existsSync, accessSync, constants } = await import('node:fs');
      const dbPath = getChatDbPath();

      if (!existsSync(dbPath)) return false;
      accessSync(dbPath, constants.R_OK);

      return true;
    } catch {
      return false;
    }
  },

  async start(
    onInbound: (envelope: ChatIngressEnvelope) => Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    if (!IS_MACOS) {
      throw new Error('iMessage is only available on macOS');
    }

    log.info('Starting iMessage channel...');
    connectionStatus = 'connecting';

    // Create internal controller so logout() can stop the poll
    pollAbortController = new AbortController();
    const onExternalAbort = () => pollAbortController?.abort();
    signal.addEventListener('abort', onExternalAbort);

    try {
      // Verify iMessage is configured before starting
      const configured = await isIMessageConfigured();
      if (!configured) {
        throw new Error(
          'iMessage is not configured. Run `myndhyve-cli relay login imessage` first.'
        );
      }

      connectionStatus = 'connected';
      log.info('iMessage connected');

      // Run the poll loop until abort (external signal or logout)
      await pollIMessages(onInbound, pollAbortController.signal);
    } catch (error) {
      if (signal.aborted || pollAbortController?.signal.aborted) return;
      throw error;
    } finally {
      signal.removeEventListener('abort', onExternalAbort);
      connectionStatus = 'disconnected';
      pollAbortController = null;
    }
  },

  async deliver(envelope: ChatEgressEnvelope): Promise<DeliveryResult> {
    if (connectionStatus !== 'connected') {
      return {
        success: false,
        error: 'iMessage not connected',
        retryable: true,
      };
    }

    try {
      // Determine if group message
      // Group chat identifiers in chat.db typically start with "chat"
      const isGroup = envelope.conversationId.startsWith('chat');

      await sendIMessage({
        to: envelope.conversationId,
        text: envelope.text,
        isGroup,
      });

      return {
        success: true,
        // iMessage doesn't return a message ID from AppleScript
        platformMessageId: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof IMessageSendError);

      log.warn('Outbound delivery failed', {
        conversationId: envelope.conversationId,
        error: message,
      });

      return {
        success: false,
        error: message,
        retryable,
      };
    }
  },

  getStatus(): string {
    return connectionStatus;
  },

  async logout(): Promise<void> {
    // iMessage doesn't have separate credentials to clear —
    // it's tied to the macOS user's Apple ID in Messages.app.
    // We just reset our connection state.

    if (pollAbortController) {
      pollAbortController.abort();
      pollAbortController = null;
    }

    connectionStatus = 'disconnected';
    log.info('iMessage channel stopped');
  },
};

// ============================================================================
// AUTO-REGISTER
// ============================================================================

registerChannel(iMessagePlugin);

export { iMessagePlugin };
