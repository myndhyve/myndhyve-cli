/**
 * MyndHyve CLI — Chat Service
 *
 * Manages AI chat sessions from the terminal. Ties together:
 * - Streaming (SSE parsing)
 * - History (local persistence)
 * - Authentication (via getToken)
 * - System prompt resolution (built-in defaults per canvas type)
 */

import { getToken } from '../auth/index.js';
import { createLogger } from '../utils/logger.js';
import {
  streamChat,
  StreamError,
  AI_PROXY_URL,
  type StreamCallbacks,
} from './streaming.js';
import {
  saveConversation,
  loadConversation,
  generateSessionId,
  generateTitle,
  type Conversation,
  type ChatMessage,
} from './history.js';
import { fetchCanvasTypeSystemPrompt } from '../api/prompts.js';

const log = createLogger('Chat');

// ============================================================================
// TYPES
// ============================================================================

/** Options for creating a new chat session. */
export interface ChatSessionOptions {
  /** Canvas type ID (e.g., 'app-builder', 'landing-page'). */
  canvasTypeId?: string;
  /** Custom agent name (maps to canvasTypeId internally). */
  agentId?: string;
  /** AI provider to use. */
  provider?: string;
  /** Model ID or alias. */
  model?: string;
  /** Sampling temperature (0-2). */
  temperature?: number;
  /** Custom system prompt (overrides canvas type default). */
  systemPrompt?: string;
  /** Resume an existing session by ID. */
  resumeSessionId?: string;
}

/** A live chat session. */
export interface ChatSession {
  /** Unique session ID. */
  sessionId: string;
  /** Resolved canvas type ID. */
  canvasTypeId?: string;
  /** Provider being used. */
  provider: string;
  /** Model being used. */
  model: string;
  /** Temperature setting. */
  temperature: number;
  /** System prompt for this session. */
  systemPrompt: string;
  /** All messages in this session. */
  messages: ChatMessage[];
  /** Session creation time. */
  createdAt: string;
}

/** Callbacks for streaming a chat response. */
export interface ChatStreamCallbacks {
  /** Called for each text delta. */
  onDelta?: (delta: string) => void;
  /** Called when the full response is ready. */
  onComplete?: (content: string) => void;
  /** Called on error. */
  onError?: (error: StreamError) => void;
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new chat session or resume an existing one.
 *
 * Fetches the system prompt from the Prompt API (database-first).
 * Falls back to hardcoded defaults if the API is unavailable.
 */
export async function createSession(options: ChatSessionOptions = {}): Promise<ChatSession> {
  const canvasTypeId = options.canvasTypeId || options.agentId;
  const provider = options.provider || 'anthropic';
  const model = options.model || getDefaultModel(provider);
  const temperature = options.temperature ?? 0.7;

  // Resume existing session
  if (options.resumeSessionId) {
    const existing = loadConversation(options.resumeSessionId);
    if (existing) {
      log.info('Resumed session', { sessionId: existing.sessionId });
      const systemPrompt = options.systemPrompt || await resolveSystemPrompt(existing.canvasTypeId);
      return {
        sessionId: existing.sessionId,
        canvasTypeId: existing.canvasTypeId,
        provider: existing.provider || provider,
        model: existing.model || model,
        temperature,
        systemPrompt,
        messages: existing.messages,
        createdAt: existing.createdAt,
      };
    }
    log.warn('Session not found, creating new', {
      sessionId: options.resumeSessionId,
    });
  }

  const sessionId = generateSessionId();
  const systemPrompt = options.systemPrompt || await resolveSystemPrompt(canvasTypeId);

  log.info('Created session', { sessionId, canvasTypeId, provider, model });

  return {
    sessionId,
    canvasTypeId,
    provider,
    model,
    temperature,
    systemPrompt,
    messages: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Send a message in a chat session and stream the response.
 *
 * Adds the user message to history, streams the AI response, and
 * persists the conversation after completion.
 */
export async function sendMessage(
  session: ChatSession,
  userMessage: string,
  callbacks: ChatStreamCallbacks = {}
): Promise<string> {
  const now = new Date().toISOString();

  // Add user message to history
  session.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: now,
  });

  // Get auth token — rollback user message on failure (#4, #7)
  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    session.messages.pop(); // Remove the user message we just added
    throw err;
  }

  // Build messages array for the API
  const apiMessages = buildAPIMessages(session);

  // Stream the response
  return new Promise<string>((resolve, reject) => {
    const streamCallbacks: StreamCallbacks = {
      onDelta(delta) {
        callbacks.onDelta?.(delta);
      },

      onComplete(content) {
        // Add assistant message to history
        session.messages.push({
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
        });

        // Persist conversation
        persistSession(session);

        callbacks.onComplete?.(content);
        resolve(content);
      },

      onError(error) {
        callbacks.onError?.(error);
        reject(error);
      },
    };

    // Errors from streamChat are routed through callbacks.onError → reject (#6)
    streamChat(
      {
        url: AI_PROXY_URL,
        token,
        body: {
          provider: session.provider,
          model: session.model,
          messages: apiMessages,
          systemPrompt: session.systemPrompt,
          temperature: session.temperature,
        },
      },
      streamCallbacks
    ).catch((err) => {
      // Only reject if not already settled via onError/onComplete
      callbacks.onError?.(
        err instanceof StreamError
          ? err
          : new StreamError(
              err instanceof Error ? err.message : String(err),
              'STREAM_ERROR'
            )
      );
      reject(err);
    });
  });
}

/** Maximum messages persisted per conversation to prevent unbounded file growth. */
const MAX_PERSISTED_MESSAGES = 500;

/**
 * Save the current session state to disk.
 *
 * Caps stored messages at {@link MAX_PERSISTED_MESSAGES}, keeping the most
 * recent ones. The in-memory session is not trimmed.
 */
export function persistSession(session: ChatSession): void {
  const title =
    session.messages.length > 0
      ? generateTitle(
          session.messages.find((m) => m.role === 'user')?.content || 'New Chat'
        )
      : 'New Chat';

  // Trim to last N messages for storage (#5) — don't mutate session.messages
  const messagesToSave = session.messages.length > MAX_PERSISTED_MESSAGES
    ? session.messages.slice(-MAX_PERSISTED_MESSAGES)
    : session.messages;

  const conversation: Conversation = {
    sessionId: session.sessionId,
    title,
    canvasTypeId: session.canvasTypeId,
    model: session.model,
    provider: session.provider,
    messages: messagesToSave,
    createdAt: session.createdAt,
    updatedAt: new Date().toISOString(),
  };

  try {
    saveConversation(conversation);
  } catch (err) {
    log.warn('Failed to save conversation', {
      sessionId: session.sessionId,
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// ============================================================================
// API MESSAGE BUILDING
// ============================================================================

/**
 * Build the messages array for the AI proxy API.
 *
 * Sends the last 30 messages (API limit) excluding system messages
 * (system prompt is sent separately).
 */
function buildAPIMessages(
  session: ChatSession
): Array<{ role: string; content: string }> {
  const messages = session.messages
    .filter((m) => m.role !== 'system')
    .slice(-30);

  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

// ============================================================================
// SYSTEM PROMPT RESOLUTION (Database-First)
// ============================================================================

/** Fallback prompt when no canvas type is specified or API is unavailable. */
const DEFAULT_SYSTEM_PROMPT = `You are MyndHyve AI, a helpful and knowledgeable assistant. You help users with a variety of tasks including writing, analysis, coding, and creative work.

Guidelines:
- Be concise and direct
- Use markdown formatting for readability
- Ask clarifying questions when requirements are ambiguous
- Provide actionable, practical advice
- Consider best practices and potential edge cases`;

/**
 * Resolve the system prompt for a given canvas type ID.
 *
 * Database-first: fetches from the Prompt API (Firestore-backed).
 * Falls back to DEFAULT_SYSTEM_PROMPT if the API is unavailable.
 */
export async function resolveSystemPrompt(canvasTypeId?: string): Promise<string> {
  if (!canvasTypeId) return DEFAULT_SYSTEM_PROMPT;

  try {
    const apiPrompt = await fetchCanvasTypeSystemPrompt(canvasTypeId);
    if (apiPrompt) {
      log.debug('Resolved prompt from API', { canvasTypeId });
      return apiPrompt;
    }
  } catch (err) {
    log.warn('Failed to fetch system prompt from API, using fallback', {
      canvasTypeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return DEFAULT_SYSTEM_PROMPT;
}

// ============================================================================
// DEFAULT MODEL RESOLUTION
// ============================================================================

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  minimax: 'minimax-m2.5',
};

function getDefaultModel(provider: string): string {
  return DEFAULT_MODELS[provider] || 'claude-sonnet';
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export type { Conversation, ChatMessage } from './history.js';
export { StreamError } from './streaming.js';
export type { StreamCallbacks } from './streaming.js';
export {
  listConversations,
  getLatestConversation,
  deleteConversation,
  clearAllConversations,
  loadConversation,
} from './history.js';
export { renderMarkdown, createStreamRenderer } from './renderer.js';
