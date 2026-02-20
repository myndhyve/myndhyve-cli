/**
 * MyndHyve CLI — Chat Service
 *
 * Manages AI chat sessions from the terminal. Ties together:
 * - Streaming (SSE parsing)
 * - History (local persistence)
 * - Authentication (via getToken)
 * - System prompt resolution (built-in defaults per hyve)
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

const log = createLogger('Chat');

// ============================================================================
// TYPES
// ============================================================================

/** Options for creating a new chat session. */
export interface ChatSessionOptions {
  /** System hyve ID (e.g., 'app-builder', 'landing-page'). */
  hyveId?: string;
  /** Custom agent name (maps to hyveId internally). */
  agentId?: string;
  /** AI provider to use. */
  provider?: string;
  /** Model ID or alias. */
  model?: string;
  /** Sampling temperature (0-2). */
  temperature?: number;
  /** Custom system prompt (overrides hyve default). */
  systemPrompt?: string;
  /** Resume an existing session by ID. */
  resumeSessionId?: string;
}

/** A live chat session. */
export interface ChatSession {
  /** Unique session ID. */
  sessionId: string;
  /** Resolved hyve ID. */
  hyveId?: string;
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
 */
export function createSession(options: ChatSessionOptions = {}): ChatSession {
  const hyveId = options.hyveId || options.agentId;
  const provider = options.provider || 'anthropic';
  const model = options.model || getDefaultModel(provider);
  const temperature = options.temperature ?? 0.7;

  // Resume existing session
  if (options.resumeSessionId) {
    const existing = loadConversation(options.resumeSessionId);
    if (existing) {
      log.info('Resumed session', { sessionId: existing.sessionId });
      return {
        sessionId: existing.sessionId,
        hyveId: existing.hyveId,
        provider: existing.provider || provider,
        model: existing.model || model,
        temperature,
        systemPrompt: options.systemPrompt || resolveSystemPrompt(existing.hyveId),
        messages: existing.messages,
        createdAt: existing.createdAt,
      };
    }
    log.warn('Session not found, creating new', {
      sessionId: options.resumeSessionId,
    });
  }

  const sessionId = generateSessionId();
  const systemPrompt = options.systemPrompt || resolveSystemPrompt(hyveId);

  log.info('Created session', { sessionId, hyveId, provider, model });

  return {
    sessionId,
    hyveId,
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
    hyveId: session.hyveId,
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
// SYSTEM PROMPT RESOLUTION
// ============================================================================

/** Built-in system prompts for system hyves. */
const HYVE_PROMPTS: Record<string, string> = {
  'app-builder': `You are MyndHyve App Builder, an expert AI assistant for building web applications. You help users create PRDs (Product Requirements Documents), design UI components, plan technical architecture, and generate implementation plans.

When the user describes an app idea:
1. Ask clarifying questions if the requirements are vague
2. Propose a structured approach (PRD → Design → Implementation)
3. Generate detailed, actionable specifications
4. Consider UX best practices, accessibility, and performance

Be concise, technical, and practical. Use markdown formatting for readability.`,

  'landing-page': `You are MyndHyve Landing Page Builder, an expert AI assistant for creating high-converting marketing landing pages. You help with copywriting, section design, A/B testing strategy, and conversion optimization.

When the user describes a landing page need:
1. Understand the target audience and value proposition
2. Suggest an effective page structure (Hero → Features → Social Proof → CTA)
3. Write compelling copy with clear CTAs
4. Recommend design patterns that drive conversions

Focus on clarity, persuasion, and measurable outcomes. Use markdown formatting.`,

  'hyve-maker': `You are MyndHyve Hyve Maker, an AI assistant that helps users create custom hyves (workspaces). You help design workspace layouts, define workflows, configure AI agents, and set up automation.

Guide users through:
1. Defining the hyve's purpose and target users
2. Designing the workspace layout and navigation
3. Configuring AI agents and their capabilities
4. Setting up workflows and automation rules

Be creative yet practical. Focus on user experience and productivity.`,
};

/** Default system prompt when no hyve is specified. */
const DEFAULT_SYSTEM_PROMPT = `You are MyndHyve AI, a helpful and knowledgeable assistant. You help users with a variety of tasks including writing, analysis, coding, and creative work.

Guidelines:
- Be concise and direct
- Use markdown formatting for readability
- Ask clarifying questions when requirements are ambiguous
- Provide actionable, practical advice
- Consider best practices and potential edge cases`;

/**
 * Resolve the system prompt for a given hyve ID.
 */
export function resolveSystemPrompt(hyveId?: string): string {
  if (!hyveId) return DEFAULT_SYSTEM_PROMPT;
  return HYVE_PROMPTS[hyveId] || DEFAULT_SYSTEM_PROMPT;
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
