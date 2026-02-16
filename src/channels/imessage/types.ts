/**
 * MyndHyve CLI — iMessage Channel Types
 *
 * Types for macOS Messages.app integration via AppleScript + chat.db.
 */

// ============================================================================
// CHAT.DB ROW TYPES
// ============================================================================

/**
 * Raw row from the chat.db SQLite query.
 * Fields come from the `message`, `handle`, and `chat` tables.
 */
export interface ChatDbMessageRow {
  /** message.ROWID */
  rowid: number;
  /** message.text (can be null for media-only messages) */
  text: string | null;
  /** message.date — nanoseconds since 2001-01-01 00:00:00 UTC */
  date: number;
  /** handle.id — phone number or email (e.g., "+1234567890" or "user@icloud.com") */
  sender: string;
  /** chat.chat_identifier — phone/email for 1:1, or "chatNNN" for groups */
  chat_identifier: string;
  /** chat.display_name — group name (null for 1:1) */
  display_name: string | null;
  /** chat.group_id — null for 1:1 */
  group_id: string | null;
  /** message.associated_message_guid — set if this is a reply/reaction */
  associated_message_guid: string | null;
  /** message.cache_has_attachments — 1 if message has attachments */
  cache_has_attachments: number;
  /** message.guid — unique message identifier */
  guid: string;
}

/**
 * Raw attachment row from chat.db.
 */
export interface ChatDbAttachmentRow {
  /** message_attachment_join.message_id (message ROWID) */
  message_id: number;
  /** attachment.filename — absolute path like ~/Library/Messages/Attachments/... */
  filename: string | null;
  /** attachment.mime_type */
  mime_type: string | null;
  /** attachment.total_bytes */
  total_bytes: number | null;
  /** attachment.transfer_name — original file name */
  transfer_name: string | null;
}

// ============================================================================
// APPLESCRIPT SEND PARAMS
// ============================================================================

export interface IMessageSendParams {
  /** Recipient identifier — phone number, email, or chat ID for groups */
  to: string;
  /** Message text */
  text: string;
  /** Whether this is a group chat ID (starts with "chat") */
  isGroup: boolean;
}

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

/**
 * macOS Core Data timestamp epoch: 2001-01-01T00:00:00Z in Unix seconds.
 * chat.db stores timestamps as nanoseconds since this epoch.
 */
export const CORE_DATA_EPOCH_OFFSET = 978307200;

/**
 * chat.db timestamps on macOS 10.13+ are in nanoseconds.
 * Divide by this to get seconds.
 */
export const NANOSECOND_DIVISOR = 1_000_000_000;

/**
 * Default poll interval for scanning chat.db.
 */
export const IMESSAGE_POLL_INTERVAL_MS = 2000;

/**
 * Path to the Messages database (relative to user home).
 */
export const CHAT_DB_RELATIVE_PATH = 'Library/Messages/chat.db';
