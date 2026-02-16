/**
 * MyndHyve CLI — iMessage Receive (chat.db polling)
 *
 * Polls the macOS Messages database (~/Library/Messages/chat.db)
 * for new incoming messages using the system `sqlite3` CLI.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '../../utils/logger.js';
import { sleep } from '../../utils/backoff.js';
import type { ChatIngressEnvelope } from '../../relay/types.js';
import type { ChatDbMessageRow, ChatDbAttachmentRow } from './types.js';
import {
  CORE_DATA_EPOCH_OFFSET,
  NANOSECOND_DIVISOR,
  IMESSAGE_POLL_INTERVAL_MS,
  CHAT_DB_RELATIVE_PATH,
} from './types.js';

const log = createLogger('iMessage:Receive');

const execFileAsync = promisify(execFile);

// ============================================================================
// POLL LOOP
// ============================================================================

/**
 * Poll chat.db for new inbound messages and forward them via callback.
 *
 * Resolves when the abort signal fires. Throws on unrecoverable errors
 * (e.g., database not found, sqlite3 not available).
 */
export async function pollIMessages(
  onInbound: (envelope: ChatIngressEnvelope) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  const dbPath = getChatDbPath();

  if (!existsSync(dbPath)) {
    throw new Error(
      `Messages database not found at ${dbPath}. ` +
      'Ensure Messages.app has been opened at least once.'
    );
  }

  // Start polling from "now" — we only want new messages, not history
  let lastSeenRowId = await getMaxRowId(dbPath);

  log.info('iMessage poll loop starting', { dbPath, lastSeenRowId });

  let consecutiveFailures = 0;

  while (!signal.aborted) {
    try {
      const messages = await queryNewMessages(dbPath, lastSeenRowId);

      // Reset failure counter on successful query
      consecutiveFailures = 0;

      if (messages.length > 0) {
        // Fetch attachments for messages that have them
        const messageIds = messages
          .filter((m) => m.cache_has_attachments === 1)
          .map((m) => m.rowid);

        const attachments = messageIds.length > 0
          ? await queryAttachments(dbPath, messageIds)
          : [];

        // Group attachments by message_id for quick lookup
        const attachmentMap = new Map<number, ChatDbAttachmentRow[]>();
        for (const att of attachments) {
          const list = attachmentMap.get(att.message_id) ?? [];
          list.push(att);
          attachmentMap.set(att.message_id, list);
        }

        for (const msg of messages) {
          const envelope = normalizeIMessage(msg, attachmentMap.get(msg.rowid));
          if (!envelope) continue;

          log.debug('Forwarding inbound iMessage', {
            from: envelope.peerId,
            conversationId: envelope.conversationId,
          });

          try {
            await onInbound(envelope);
          } catch (error) {
            log.warn('Failed to forward inbound iMessage', {
              rowid: msg.rowid,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Advance the watermark
        lastSeenRowId = messages[messages.length - 1].rowid;
      }
    } catch (error) {
      if (signal.aborted) break;

      consecutiveFailures++;
      log.warn('iMessage poll cycle failed', {
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailures,
      });

      // Exponential backoff for repeated failures, capped at 60s
      if (!signal.aborted) {
        const backoffMs = Math.min(
          IMESSAGE_POLL_INTERVAL_MS * Math.pow(2, consecutiveFailures - 1),
          60_000
        );
        await sleep(backoffMs);
        continue;
      }
    }

    if (!signal.aborted) {
      await sleep(IMESSAGE_POLL_INTERVAL_MS);
    }
  }

  log.info('iMessage poll loop stopped');
}

// ============================================================================
// SQLITE QUERIES
// ============================================================================

/**
 * Get the current maximum ROWID from the message table.
 * Used to set the initial "high watermark" so we don't replay history.
 */
export async function getMaxRowId(dbPath: string): Promise<number> {
  const result = await queryChatDb<{ max_rowid: number | null }>(
    dbPath,
    'SELECT MAX(ROWID) as max_rowid FROM message;'
  );

  if (result.length === 0) return 0;
  return result[0].max_rowid ?? 0;
}

/**
 * Query for new messages received after the given ROWID.
 *
 * Only returns messages NOT from the current user (is_from_me = 0).
 * Results are ordered by ROWID ascending.
 */
export async function queryNewMessages(
  dbPath: string,
  sinceRowId: number
): Promise<ChatDbMessageRow[]> {
  const query = `
    SELECT
      m.ROWID as rowid,
      m.text,
      m.date,
      h.id as sender,
      c.chat_identifier,
      c.display_name,
      c.group_id,
      m.associated_message_guid,
      m.cache_has_attachments,
      m.guid
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE m.ROWID > ${sinceRowId}
      AND m.is_from_me = 0
      AND m.associated_message_type = 0
    ORDER BY m.ROWID ASC
    LIMIT 100;
  `;

  return queryChatDb<ChatDbMessageRow>(dbPath, query);
}

/**
 * Query attachment metadata for a list of message ROWIDs.
 */
export async function queryAttachments(
  dbPath: string,
  messageIds: number[]
): Promise<ChatDbAttachmentRow[]> {
  const idList = messageIds.join(',');

  const query = `
    SELECT
      maj.message_id,
      a.filename,
      a.mime_type,
      a.total_bytes,
      a.transfer_name
    FROM message_attachment_join maj
    JOIN attachment a ON maj.attachment_id = a.ROWID
    WHERE maj.message_id IN (${idList});
  `;

  return queryChatDb<ChatDbAttachmentRow>(dbPath, query);
}

/**
 * Execute a SQL query against chat.db using the system `sqlite3` CLI.
 *
 * Uses `-json` mode for structured output (available on macOS 12+ Monterey).
 * Database is opened in read-only mode to avoid conflicts with Messages.app.
 */
export async function queryChatDb<T = Record<string, unknown>>(
  dbPath: string,
  query: string
): Promise<T[]> {
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      ['-json', '-readonly', dbPath, query],
      { timeout: 10_000 }
    );

    const trimmed = stdout.trim();
    if (!trimmed) return [];

    return JSON.parse(trimmed) as T[];
  } catch (error) {
    // sqlite3 returns exit code 0 with empty output for no-result queries
    // but exit code 1 for actual errors
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('no such table')) {
      throw new Error(`Messages database schema mismatch: ${message}`);
    }

    throw error;
  }
}

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Normalize a chat.db message row into a ChatIngressEnvelope.
 * Returns null if the message should be skipped.
 */
export function normalizeIMessage(
  row: ChatDbMessageRow,
  attachments?: ChatDbAttachmentRow[]
): ChatIngressEnvelope | null {
  const text = row.text ?? '';
  const media = normalizeAttachments(attachments);

  // Skip messages with no text and no media
  if (!text && media.length === 0) return null;

  // Determine if group (group_id is set, or chat_identifier doesn't look like a phone/email)
  const isGroup = !!row.group_id;
  const conversationId = row.chat_identifier;

  // Convert macOS Core Data timestamp to ISO string
  const timestamp = coreDataTimestampToDate(row.date).toISOString();

  const envelope: ChatIngressEnvelope = {
    channel: 'imessage',
    platformMessageId: row.guid,
    conversationId,
    peerId: row.sender,
    peerDisplay: undefined,  // Messages.app doesn't expose contact names in chat.db
    text,
    media: media.length > 0 ? media : undefined,
    isGroup,
    groupName: row.display_name ?? undefined,
    timestamp,
  };

  return envelope;
}

/**
 * Normalize chat.db attachment rows to media array.
 */
function normalizeAttachments(
  attachments?: ChatDbAttachmentRow[]
): NonNullable<ChatIngressEnvelope['media']> {
  if (!attachments || attachments.length === 0) return [];

  return attachments
    .filter((att): att is ChatDbAttachmentRow & { filename: string } => !!att.filename)
    .map((att) => ({
      kind: classifyMimeType(att.mime_type),
      ref: att.filename,  // Absolute path to attachment file
      mimeType: att.mime_type ?? undefined,
      fileName: att.transfer_name ?? undefined,
      size: att.total_bytes ?? undefined,
    }));
}

/**
 * Classify a MIME type into a media kind.
 */
function classifyMimeType(
  mimeType: string | null
): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
  if (!mimeType) return 'document';

  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';

  return 'document';
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the absolute path to the Messages database.
 */
export function getChatDbPath(): string {
  return join(homedir(), CHAT_DB_RELATIVE_PATH);
}

/**
 * Convert a macOS Core Data timestamp (nanoseconds since 2001-01-01) to a Date.
 */
export function coreDataTimestampToDate(nanoseconds: number): Date {
  const unixSeconds = nanoseconds / NANOSECOND_DIVISOR + CORE_DATA_EPOCH_OFFSET;
  return new Date(unixSeconds * 1000);
}
