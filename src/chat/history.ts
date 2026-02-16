/**
 * MyndHyve CLI — Conversation History
 *
 * Persists conversations locally in ~/.myndhyve-cli/conversations/.
 * Each conversation is a JSON file with messages, metadata, and timestamps.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getCliDir } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChatHistory');

// ============================================================================
// SCHEMA
// ============================================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  timestamp: z.string().datetime(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string(),
  hyveId: z.string().optional(),
  agentId: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  messages: z.array(ChatMessageSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

/** Summary of a conversation for listing. */
export interface ConversationSummary {
  sessionId: string;
  title: string;
  hyveId?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// PATHS
// ============================================================================

function getConversationsDir(): string {
  return join(getCliDir(), 'conversations');
}

function getConversationPath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(getConversationsDir(), `${safe}.json`);
}

function ensureConversationsDir(): void {
  const dir = getConversationsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * Save a conversation to disk.
 */
export function saveConversation(conversation: Conversation): void {
  ensureConversationsDir();
  const path = getConversationPath(conversation.sessionId);
  const validated = ConversationSchema.parse(conversation);
  writeFileSync(path, JSON.stringify(validated, null, 2), { mode: 0o600 });
  log.debug('Conversation saved', {
    sessionId: conversation.sessionId,
    messages: conversation.messages.length,
  });
}

/**
 * Load a conversation from disk.
 * Returns null if the conversation doesn't exist or is invalid.
 */
export function loadConversation(sessionId: string): Conversation | null {
  const path = getConversationPath(sessionId);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const json = JSON.parse(raw);
    return ConversationSchema.parse(json);
  } catch (error) {
    log.warn('Failed to load conversation', {
      sessionId,
      reason: error instanceof Error ? error.message : 'parse error',
    });
    return null;
  }
}

/**
 * List all saved conversations, sorted by most recent first.
 */
export function listConversations(): ConversationSummary[] {
  const dir = getConversationsDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const summaries: ConversationSummary[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const conv = ConversationSchema.parse(JSON.parse(raw));
      summaries.push({
        sessionId: conv.sessionId,
        title: conv.title,
        hyveId: conv.hyveId,
        messageCount: conv.messages.length,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      });
    } catch {
      // Skip invalid files
    }
  }

  // Sort by updatedAt descending (most recent first)
  summaries.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return summaries;
}

/**
 * Get the most recently updated conversation.
 */
export function getLatestConversation(): Conversation | null {
  const summaries = listConversations();
  if (summaries.length === 0) return null;
  return loadConversation(summaries[0].sessionId);
}

/**
 * Delete a conversation.
 * Returns true if the file was deleted, false if it didn't exist.
 */
export function deleteConversation(sessionId: string): boolean {
  const path = getConversationPath(sessionId);
  if (!existsSync(path)) return false;

  unlinkSync(path);
  log.debug('Conversation deleted', { sessionId });
  return true;
}

/**
 * Delete all conversations.
 * Returns the number of conversations deleted.
 */
export function clearAllConversations(): number {
  const dir = getConversationsDir();
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      unlinkSync(join(dir, file));
    } catch {
      // Skip files that can't be deleted
    }
  }

  log.debug('All conversations cleared', { count: files.length });
  return files.length;
}

// ============================================================================
// SESSION ID GENERATION
// ============================================================================

/**
 * Generate a unique session ID for a new conversation.
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `chat_${timestamp}_${random}`;
}

/**
 * Generate a title from the first user message.
 * Truncates to 60 characters.
 */
export function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + '...';
}
