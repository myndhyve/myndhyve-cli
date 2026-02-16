/**
 * MyndHyve CLI — iMessage Send (AppleScript)
 *
 * Sends messages via macOS Messages.app using the `osascript` command.
 * Supports both direct (1:1) and group messages.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../utils/logger.js';
import type { IMessageSendParams } from './types.js';

const log = createLogger('iMessage:Send');

const execFileAsync = promisify(execFile);

// ============================================================================
// SEND
// ============================================================================

/**
 * Send an iMessage via AppleScript.
 *
 * @param params.to — Phone number, email, or group chat ID
 * @param params.text — Message body
 * @param params.isGroup — True if `to` is a group chat ID
 *
 * @throws if osascript fails (Messages.app not running, invalid recipient, etc.)
 */
export async function sendIMessage(params: IMessageSendParams): Promise<void> {
  const { to, text, isGroup } = params;

  const script = isGroup
    ? buildGroupScript(to, text)
    : buildDirectScript(to, text);

  log.debug('Sending iMessage', { to, isGroup, textLength: text.length });

  try {
    await execFileAsync('osascript', ['-e', script], {
      timeout: 15_000,
    });
    log.debug('iMessage sent', { to });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IMessageSendError(
      `Failed to send iMessage to ${to}: ${message}`,
      to,
      isGroup
    );
  }
}

// ============================================================================
// APPLESCRIPT BUILDERS
// ============================================================================

/**
 * Build AppleScript to send a direct (1:1) message.
 *
 * Uses Messages.app's "send to buddy" scripting interface.
 */
function buildDirectScript(to: string, text: string): string {
  const textExpr = buildTextExpression(text);
  const escapedTo = escapeAppleScript(to);

  return [
    'tell application "Messages"',
    `  set targetService to 1st account whose service type = iMessage`,
    `  set targetBuddy to participant "${escapedTo}" of targetService`,
    `  send ${textExpr} to targetBuddy`,
    'end tell',
  ].join('\n');
}

/**
 * Build AppleScript to send a group chat message.
 *
 * Group chats are addressed by their chat ID.
 */
function buildGroupScript(chatId: string, text: string): string {
  const textExpr = buildTextExpression(text);
  const escapedChatId = escapeAppleScript(chatId);

  return [
    'tell application "Messages"',
    `  set targetChat to chat id "${escapedChatId}"`,
    `  send ${textExpr} to targetChat`,
    'end tell',
  ].join('\n');
}

/**
 * Build an AppleScript expression for a text string.
 *
 * AppleScript double-quoted strings only recognize `\"` and `\\` as escapes —
 * `\n`, `\r`, `\t` are NOT interpreted. To send actual newlines, we split the
 * text on line breaks and concatenate with AppleScript's `linefeed` constant.
 */
function buildTextExpression(text: string): string {
  // Normalize line endings to \n, then split
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length === 1) {
    return `"${escapeAppleScript(text)}"`;
  }

  return lines
    .map((line) => `"${escapeAppleScript(line)}"`)
    .join(' & linefeed & ');
}

// ============================================================================
// ESCAPE
// ============================================================================

/**
 * Escape a string for safe inclusion in an AppleScript double-quoted string.
 *
 * AppleScript double-quoted strings only recognize two escape sequences:
 * - `\"` — literal quote
 * - `\\` — literal backslash
 *
 * Newlines and carriage returns are handled separately by `buildTextExpression`
 * using AppleScript's `linefeed` constant concatenation, since AppleScript does
 * NOT interpret `\n` or `\r` as control characters in string literals.
 */
export function escapeAppleScript(input: string): string {
  return input
    .replace(/\\/g, '\\\\')      // Backslash first (before other escapes)
    .replace(/"/g, '\\"');        // Double quotes
}

// ============================================================================
// DETECTION
// ============================================================================

/**
 * Check if Messages.app is available and iMessage is configured.
 *
 * Runs a quick AppleScript that counts iMessage accounts.
 * Returns true if at least one iMessage account exists.
 */
export async function isIMessageConfigured(): Promise<boolean> {
  try {
    const script = [
      'tell application "Messages"',
      '  count of (accounts whose service type = iMessage)',
      'end tell',
    ].join('\n');

    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 10_000,
    });

    const count = parseInt(stdout.trim(), 10);
    return count > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// ERROR
// ============================================================================

export class IMessageSendError extends Error {
  constructor(
    message: string,
    public readonly recipient: string,
    public readonly isGroup: boolean
  ) {
    super(message);
    this.name = 'IMessageSendError';
  }
}
