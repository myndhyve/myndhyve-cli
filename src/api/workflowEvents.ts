/**
 * MyndHyve CLI — SSE event parser for the WOP workflow-runtime
 * `/v1/runs/{runId}/events` endpoint.
 *
 * Native Server-Sent Events parser, no `eventsource` dependency. The
 * SSE wire format is small:
 *
 *   id: <opaque-id>             (optional; carries `Last-Event-ID`)
 *   event: <event-name>         (optional; default "message")
 *   data: <payload-line-1>
 *   data: <payload-line-2>
 *   <blank-line>                (terminates the event)
 *
 *   : comment-line              (heartbeat / keep-alive — ignored)
 *
 * Multi-line `data:` is concatenated with `\n`. Blank line dispatches
 * the accumulated event. The `data` payload is JSON-parsed by callers
 * (the wire shape is `RunEventDoc` per `docs/wop-spec/v1/api/asyncapi.yaml`).
 *
 * The parser is shape-agnostic — it yields `{id, event, data}` triples
 * and lets callers decide how to interpret them. This keeps the parser
 * reusable for any SSE-emitting endpoint the CLI might consume later
 * (e.g. `aiProxy` chat streaming, a future operations stream).
 *
 * **Reconnect contract.** The caller is responsible for tracking the
 * last `id:` value and re-issuing the request with `Last-Event-ID`
 * on transient failure. {@link streamSseEvents} surfaces the parsed
 * events; {@link consumeSseStreamWithReconnect} adds the auto-resume
 * loop on top.
 *
 * @see docs/wop-spec/v1/stream-modes.md
 * @see docs/wop-spec/v1/api/asyncapi.yaml
 */

import { computeBackoff, sleep } from '../utils/backoff.js';
import type { ReconnectConfig } from '../config/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SseParser');

/**
 * One parsed SSE event. `data` is the raw concatenated payload lines
 * — callers JSON-parse if the upstream is JSON. `event` is the
 * `event:` field value (default `"message"` per spec). `id` is the
 * `id:` field used by `Last-Event-ID` reconnect.
 */
export interface ParsedSseEvent {
  readonly id: string | null;
  readonly event: string;
  readonly data: string;
}

/**
 * Parse a UTF-8-encoded SSE byte stream and yield events as they
 * complete. The async generator drains the stream; the caller's
 * `for await` loop terminates when the upstream closes.
 *
 * Buffer-management notes:
 *   - Decoder is stream-aware (`{ stream: true }`) so a multi-byte
 *     UTF-8 char split across chunks doesn't corrupt the output.
 *   - The line buffer holds at most one in-progress line; events
 *     dispatch as soon as the blank-line terminator arrives.
 *   - An end-of-stream WITHOUT a trailing blank line still flushes
 *     the in-flight event (rare but possible if the server closes
 *     mid-event during a force-flush).
 */
export async function* streamSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';
  let currentId: string | null = null;
  let currentEvent = 'message';
  const dataLines: string[] = [];

  const flush = (): ParsedSseEvent | null => {
    if (dataLines.length === 0 && currentEvent === 'message' && currentId === null) {
      return null;
    }
    const event: ParsedSseEvent = {
      id: currentId,
      event: currentEvent,
      data: dataLines.join('\n'),
    };
    currentId = null;
    currentEvent = 'message';
    dataLines.length = 0;
    return event;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on `\n` rather than `\r\n` because Node's TextDecoder
      // already collapses `\r\n` → `\n` for ASCII text. SSE spec
      // permits `\r`, `\n`, or `\r\n`; defensive replace below
      // handles any stragglers.
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Drain complete lines (everything up to the last `\n`); keep
      // the partial trailing line in the buffer for the next chunk.
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (line === '') {
          // Blank line dispatches the accumulated event.
          const event = flush();
          if (event) yield event;
          continue;
        }
        if (line.startsWith(':')) {
          // Comment / keep-alive — ignored per spec.
          continue;
        }

        const colonIdx = line.indexOf(':');
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        // Spec: drop a single space after the colon if present.
        let valueStr = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
        if (valueStr.startsWith(' ')) valueStr = valueStr.slice(1);

        switch (field) {
          case 'id':
            currentId = valueStr;
            break;
          case 'event':
            currentEvent = valueStr || 'message';
            break;
          case 'data':
            dataLines.push(valueStr);
            break;
          case 'retry':
            // Spec: integer milliseconds for the next reconnect
            // delay. The CLI honors its own backoff schedule rather
            // than letting the server set retry timing — log + drop.
            log.debug('SSE retry hint received (ignored by CLI)', { value: valueStr });
            break;
          default:
            // Unknown field — spec requires it be ignored.
            break;
        }
      }
    }

    // End-of-stream. Decode any remaining bytes (handles the case
    // where the trailing chunk didn't end on a UTF-8 boundary), then
    // flush a final in-flight event if one was accumulating.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      // The trailing chunk had data but no terminating `\n`. Treat
      // it as a final field line.
      const lines = buffer.split('\n').filter((l) => l !== '');
      for (const line of lines) {
        if (line.startsWith(':')) continue;
        const colonIdx = line.indexOf(':');
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        let valueStr = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
        if (valueStr.startsWith(' ')) valueStr = valueStr.slice(1);
        if (field === 'id') currentId = valueStr;
        else if (field === 'event') currentEvent = valueStr || 'message';
        else if (field === 'data') dataLines.push(valueStr);
      }
    }
    const final = flush();
    if (final) yield final;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader already released by the runtime on close — fine.
    }
  }
}

// ─── Reconnect loop ───────────────────────────────────────────────

/**
 * Options for {@link consumeSseStreamWithReconnect}. The caller
 * supplies an `openStream` factory that returns a fresh
 * `ReadableStream<Uint8Array>` every time; the loop calls it on
 * initial connect AND after each transient failure.
 *
 * The factory receives the last seen `id:` value (or `null` on the
 * first connect) so the caller can attach `Last-Event-ID` per spec.
 *
 * `isTerminalEvent` is the callback that closes the loop cleanly
 * — the SSE stream stays open server-side after a terminal run
 * event because the engine keeps the listener attached for any
 * subsequent `run.restored-from-snapshot` events. CLI consumers
 * that just want "wait for terminal" treat the first matching
 * event as their cue to disconnect and exit.
 */
export interface ReconnectStreamOptions {
  /**
   * Factory that opens a fresh SSE stream. Called once on first
   * connect (with `lastEventId = null`) and again on each retry
   * (with the most recent `id:` seen).
   */
  readonly openStream: (lastEventId: string | null) => Promise<ReadableStream<Uint8Array>>;
  /**
   * Returns `true` when the supplied event indicates the run has
   * reached a terminal state and the consumer should disconnect.
   * Default: never terminal (loop runs until the caller breaks).
   */
  readonly isTerminalEvent?: (event: ParsedSseEvent) => boolean;
  /**
   * Maximum number of reconnect attempts after a transient failure.
   * Default 10. The first connect doesn't count toward this budget.
   */
  readonly maxReconnects?: number;
  /**
   * Backoff schedule for reconnect attempts. Defaults to a sensible
   * profile (initial 250ms, max 30s, exponential). The `maxAttempts`
   * field is honored as the reconnect budget if set; otherwise
   * {@link maxReconnects} above governs.
   */
  readonly backoff?: Partial<ReconnectConfig>;
  /** Optional abort signal — closes the loop early. */
  readonly signal?: AbortSignal;
}

/**
 * Consume an SSE stream with `Last-Event-ID` auto-resume on transient
 * failure. Yields parsed events as they arrive; terminates cleanly
 * when (a) the supplied `isTerminalEvent` matches, (b) the abort
 * signal fires, or (c) the reconnect budget is exhausted.
 *
 * Reconnect ladder:
 *   - Initial open via `openStream(null)`.
 *   - On unexpected close (no terminal event seen, no abort), wait
 *     `backoff` and retry via `openStream(lastEventId)`.
 *   - Each failure increments the attempt counter; budget exhaust
 *     surfaces as a terminal `error` event (kind: `'sse-reconnect-budget-exhausted'`)
 *     so callers see WHY the stream stopped.
 */
export async function* consumeSseStreamWithReconnect(
  opts: ReconnectStreamOptions,
): AsyncGenerator<ParsedSseEvent, void, void> {
  const maxReconnects = opts.maxReconnects ?? 10;
  const isTerminalEvent = opts.isTerminalEvent ?? (() => false);
  // Default profile: 250ms → 500 → 1s → … capped at 30s, max 10
  // attempts (caller can tighten via `backoff.maxAttempts`). The
  // `watchdogTimeoutMs` field is required by `ReconnectConfig`'s Zod
  // schema (relay-channel watchdog) but unused by `computeBackoff`;
  // pin a placeholder so TS is happy.
  const backoffConfig: ReconnectConfig = {
    initialDelayMs: 250,
    maxDelayMs: 30_000,
    maxAttempts: maxReconnects,
    watchdogTimeoutMs: 30 * 60 * 1000,
    ...(opts.backoff ?? {}),
  };
  let lastEventId: string | null = null;
  let attempts = 0;
  // First connect doesn't count toward the budget. Subsequent
  // reconnects do.

  while (true) {
    if (opts.signal?.aborted) return;
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await opts.openStream(lastEventId);
    } catch (err) {
      // openStream itself failed — count as a reconnect attempt.
      attempts += 1;
      if (attempts > maxReconnects) {
        yield {
          id: lastEventId,
          event: 'error',
          data: JSON.stringify({
            kind: 'sse-open-failed',
            attempts,
            lastError: err instanceof Error ? err.message : String(err),
          }),
        };
        return;
      }
      const delay = computeBackoff(backoffConfig, attempts - 1);
      log.warn('SSE openStream failed; backing off', {
        attempt: attempts,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await sleep(delay, opts.signal);
      } catch {
        return; // aborted during sleep
      }
      continue;
    }

    let sawTerminal = false;
    let streamError: unknown = null;
    try {
      for await (const event of streamSseEvents(stream)) {
        if (event.id !== null) lastEventId = event.id;
        yield event;
        if (isTerminalEvent(event)) {
          sawTerminal = true;
          return;
        }
        if (opts.signal?.aborted) return;
      }
    } catch (err) {
      streamError = err;
      log.warn('SSE stream errored mid-flight', {
        error: err instanceof Error ? err.message : String(err),
        lastEventId,
      });
    }

    if (sawTerminal) return;

    // Stream closed without terminal — try to reconnect.
    attempts += 1;
    if (attempts > maxReconnects) {
      yield {
        id: lastEventId,
        event: 'error',
        data: JSON.stringify({
          kind: 'sse-reconnect-budget-exhausted',
          attempts,
          lastEventId,
          lastError: streamError instanceof Error ? streamError.message : String(streamError),
        }),
      };
      return;
    }
    const delay = computeBackoff(backoffConfig, attempts - 1);
    log.debug('SSE stream closed unexpectedly; reconnecting after backoff', {
      attempt: attempts,
      maxReconnects,
      delayMs: delay,
      lastEventId,
    });
    try {
      await sleep(delay, opts.signal);
    } catch {
      return; // aborted during sleep
    }
  }
}
