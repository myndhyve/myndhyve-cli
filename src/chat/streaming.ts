/**
 * MyndHyve CLI — SSE Stream Parser
 *
 * Parses Server-Sent Events from the `aiProxyStream` Cloud Function.
 * Uses native Node.js fetch + ReadableStream for zero-dependency streaming.
 *
 * SSE format from aiProxyStream:
 *   data: {"content":"Hello","delta":"Hello"}
 *   data: {"content":"Hello world","delta":" world"}
 *   data: {"done":true,"content":"Hello world"}
 *   data: {"error":"Rate limit exceeded","status":429}
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('Streaming');

// ============================================================================
// TYPES
// ============================================================================

/** A single parsed chunk from the SSE stream. */
export interface StreamChunk {
  /** Accumulated content so far. */
  content?: string;
  /** New text delta for this chunk. */
  delta?: string;
  /** True when the stream is complete. */
  done?: boolean;
  /** Error message if the stream encountered an error. */
  error?: string;
  /** HTTP status code on error (e.g., 429 for rate limit). */
  status?: number;
  /** True if the response was blocked by safety filters. */
  blocked?: boolean;
}

/** Callbacks for stream event handling. */
export interface StreamCallbacks {
  /** Called for each new text delta. */
  onDelta: (delta: string) => void;
  /** Called when the stream completes successfully. */
  onComplete: (fullContent: string) => void;
  /** Called when the stream encounters an error. */
  onError: (error: StreamError) => void;
}

/** Structured error from the streaming API. */
export class StreamError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = 'StreamError';
  }
}

// ============================================================================
// SSE REQUEST
// ============================================================================

/** Configuration for a streaming AI request. */
export interface StreamRequest {
  /** Cloud Function endpoint URL. */
  url: string;
  /** Firebase ID token for authentication. */
  token: string;
  /** Request body (will be JSON-serialized). */
  body: {
    provider: string;
    model?: string;
    messages: Array<{ role: string; content: string }>;
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (default: 120s). */
  timeoutMs?: number;
}

/**
 * Send a streaming request to the AI proxy and process the SSE response.
 *
 * Returns an abort function that can be called to cancel the stream.
 *
 * @example
 * ```typescript
 * const abort = await streamChat({
 *   url: 'https://us-central1-myndhyve.cloudfunctions.net/aiProxyStream',
 *   token: 'firebase-id-token',
 *   body: {
 *     provider: 'anthropic',
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   },
 * }, {
 *   onDelta: (delta) => process.stdout.write(delta),
 *   onComplete: (content) => console.log('\n[Done]'),
 *   onError: (err) => console.error(err.message),
 * });
 * ```
 */
export async function streamChat(
  request: StreamRequest,
  callbacks: StreamCallbacks
): Promise<() => void> {
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? 120_000;

  // Combine user signal, our controller, and timeout into a single signal
  // so that abort() cancels the fetch AND the stream reader (#1)
  const signal = request.signal
    ? AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.token}`,
      },
      body: JSON.stringify(request.body),
      signal,
    });

    // Handle non-200 responses before streaming
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      let errorMessage: string;
      let retryAfter: number | undefined;

      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.error || parsed.message || errorBody;
        retryAfter = parsed.retryAfter;
      } catch {
        errorMessage = errorBody || `HTTP ${response.status}`;
      }

      const code =
        response.status === 429
          ? 'RATE_LIMITED'
          : response.status === 401
            ? 'UNAUTHORIZED'
            : 'API_ERROR';

      callbacks.onError(
        new StreamError(errorMessage, code, response.status, retryAfter)
      );
      return () => {};
    }

    // Check for streaming body
    if (!response.body) {
      callbacks.onError(
        new StreamError('No response body received', 'NO_BODY')
      );
      return () => {};
    }

    // Process SSE stream in background
    processSSEStream(response.body, callbacks, signal).catch((err) => {
      if (!signal.aborted) {
        callbacks.onError(
          new StreamError(
            err instanceof Error ? err.message : String(err),
            'STREAM_ERROR'
          )
        );
      }
    });

    return () => controller.abort();
  } catch (err) {
    if (signal.aborted) {
      // User cancelled — don't report as error
      return () => {};
    }

    if (err instanceof DOMException && err.name === 'TimeoutError') {
      callbacks.onError(
        new StreamError('Request timed out', 'TIMEOUT')
      );
    } else {
      callbacks.onError(
        new StreamError(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
          'NETWORK_ERROR'
        )
      );
    }

    return () => {};
  }
}

// ============================================================================
// SSE PARSER
// ============================================================================

/**
 * Process a ReadableStream as SSE, parsing chunks and invoking callbacks.
 */
async function processSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalContent = '';
  let accumulatedDeltas = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          processSSELine(buffer, callbacks, (content) => {
            finalContent = content;
          }, (delta) => {
            accumulatedDeltas += delta;
          });
        }

        // If we didn't get an explicit done chunk, complete with what we have.
        // Prefer server-provided content; fall back to accumulated deltas (#15).
        const completionContent = finalContent || accumulatedDeltas;
        if (completionContent) {
          callbacks.onComplete(completionContent);
        }
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines and process complete lines
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const shouldStop = processSSELine(trimmed, callbacks, (content) => {
          finalContent = content;
        }, (delta) => {
          accumulatedDeltas += delta;
        });

        if (shouldStop) {
          reader.cancel();
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process a single SSE line. Returns true if the stream should stop.
 */
function processSSELine(
  line: string,
  callbacks: StreamCallbacks,
  setContent: (content: string) => void,
  addDelta?: (delta: string) => void
): boolean {
  // SSE lines must start with "data: "
  if (!line.startsWith('data:')) return false;

  const jsonStr = line.slice(5).trim();
  if (!jsonStr || jsonStr === '[DONE]') return false;

  let chunk: StreamChunk;
  try {
    chunk = JSON.parse(jsonStr);
  } catch {
    log.debug('Failed to parse SSE chunk', { line });
    return false;
  }

  // Handle errors
  if (chunk.error) {
    callbacks.onError(
      new StreamError(
        chunk.error,
        chunk.blocked ? 'BLOCKED' : 'STREAM_ERROR',
        chunk.status
      )
    );
    return true;
  }

  // Track accumulated content
  if (chunk.content) {
    setContent(chunk.content);
  }

  // Emit delta and track for fallback completion (#15)
  if (chunk.delta) {
    addDelta?.(chunk.delta);
    callbacks.onDelta(chunk.delta);
  }

  // Handle completion
  if (chunk.done) {
    callbacks.onComplete(chunk.content || '');
    return true;
  }

  return false;
}

// ============================================================================
// CONVENIENCE
// ============================================================================

/** Default AI Proxy endpoint URL. */
export const AI_PROXY_URL =
  'https://us-central1-myndhyve.cloudfunctions.net/aiProxyStream';
