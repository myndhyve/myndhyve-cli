/**
 * MyndHyve CLI — Cloud Run `workflow-runtime` client.
 *
 * Bearer-auth fetch + SSE wrapper for the canonical WOP endpoints
 * exposed by the workflow-runtime Cloud Run service. Distinct from
 * the existing `MyndHyveClient` (which targets Cloud Functions);
 * workflow-runtime is a separate service with its own URL + audience.
 *
 * Today this client owns the per-run event surface that
 * `workflows tail` and `workflows run --watch` consume:
 *
 *   - `streamEvents(runId, opts)` — SSE event stream with auto-resume
 *   - `pollEvents(runId, opts)` — short-poll fallback for non-SSE
 *     callers (rare; SSE is the recommended path)
 *
 * Auth: reuses the Firebase ID token from `src/auth/getToken()`. On
 * 401 the client force-refreshes the token once and retries; further
 * 401 surfaces as `WorkflowRuntimeAuthError` for the caller to
 * surface as `auth_required` per the canonical error envelope.
 *
 * Error envelope: workflow-runtime emits the spec-compliant
 * `{ error: <machine_code>, message: <human>, hint?: <…> }` shape per
 * F-2026-04-29-01. {@link extractErrorEnvelope} parses it; downstream
 * consumers can route through `formatRunError` for hint surfacing.
 *
 * @see services/workflow-runtime/src/routes/canonicalRuns.ts (server)
 * @see docs/wop-spec/v1/api/openapi.yaml `streamRunEvents` + `pollRunEvents`
 */

import { getToken, AuthError } from '../auth/index.js';
import { resolveWorkflowRuntimeUrl } from '../config/defaults.js';
import { createLogger } from '../utils/logger.js';
import {
  consumeSseStreamWithReconnect,
  type ParsedSseEvent,
  type ReconnectStreamOptions,
} from './workflowEvents.js';

const log = createLogger('WorkflowRuntimeClient');

/**
 * Stream-mode values supported by `GET /v1/runs/{runId}/events` per
 * `docs/wop-spec/v1/stream-modes.md`. Mixed mode supports comma-
 * separated values like `'updates,messages'`; `values` MUST NOT mix
 * with another mode (server returns 400).
 */
export type StreamMode =
  | 'updates'
  | 'values'
  | 'messages'
  | 'debug'
  | string; // mixed: 'updates,messages'

/**
 * Options for {@link WorkflowRuntimeClient.streamEvents}. All
 * optional; defaults match the spec's defaults (`updates` mode, no
 * buffering, no resume cursor).
 */
export interface StreamEventsOptions {
  /** SSE stream mode — single (`updates`) or mixed (`updates,messages`). */
  readonly streamMode?: StreamMode;
  /** Server-side aggregation window in ms (0–5000). 0 disables. */
  readonly bufferMs?: number;
  /** Resume cursor — last `id:` seen on a previous connect. */
  readonly lastEventId?: string | null;
  /** Optional abort signal — closes the loop early. */
  readonly signal?: AbortSignal;
  /**
   * Hook called on the first parsed event whose `event` field is in
   * `TERMINAL_EVENT_TYPES` (run-level terminal events). The reconnect
   * loop disconnects cleanly afterward. Defaults to recognizing
   * `'run.completed' | 'run.failed' | 'run.cancelled' | 'run.timed-out'`.
   */
  readonly isTerminalEvent?: (event: ParsedSseEvent) => boolean;
  /** Reconnect budget. Default 10. */
  readonly maxReconnects?: number;
}

/**
 * Default terminal-event detector. Matches the canonical run-level
 * terminal events emitted by the engine. NOT the same as
 * `TERMINAL_RUN_STATUSES` (which is a status enum); this is the SSE
 * `event:` field set produced when the run reaches one of those
 * statuses.
 */
const DEFAULT_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.timed-out',
]);

export function isDefaultTerminalEvent(event: ParsedSseEvent): boolean {
  return DEFAULT_TERMINAL_EVENT_TYPES.has(event.event);
}

// ─── Error types ──────────────────────────────────────────────────

/**
 * Thrown when the runtime returns 401 even after a force-refreshed
 * token. The caller surfaces this as `auth_required` per the
 * canonical error-code vocabulary.
 */
export class WorkflowRuntimeAuthError extends Error {
  readonly code = 'auth_required';
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRuntimeAuthError';
  }
}

/**
 * Thrown when the runtime returns a non-success HTTP status with the
 * canonical envelope. Carries the machine code + human message + any
 * optional hint so callers can route through `formatRunError`.
 */
export class WorkflowRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint: string | undefined,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'WorkflowRuntimeError';
  }
}

interface CanonicalErrorEnvelope {
  readonly error?: unknown;
  readonly message?: unknown;
  readonly hint?: unknown;
}

/**
 * Parse a 4xx/5xx response body into a `WorkflowRuntimeError`. Pulls
 * `error` (machine code) + `message` (human) + optional `hint` per
 * F-2026-04-29-01. If the body isn't JSON or doesn't carry the
 * canonical fields, falls back to a generic `unknown` code with the
 * status text as the message.
 */
async function extractErrorEnvelope(
  response: Response,
): Promise<WorkflowRuntimeError> {
  let body: CanonicalErrorEnvelope | null = null;
  try {
    body = (await response.json()) as CanonicalErrorEnvelope;
  } catch {
    // Body wasn't JSON — synthesize from status.
  }
  const code = typeof body?.error === 'string' ? body.error : 'unknown';
  const message =
    typeof body?.message === 'string'
      ? body.message
      : `HTTP ${response.status} ${response.statusText}`;
  const hint = typeof body?.hint === 'string' ? body.hint : undefined;
  return new WorkflowRuntimeError(message, code, hint, response.status);
}

// ─── Client ───────────────────────────────────────────────────────

export interface PollEventsOptions {
  /** Resume cursor — only events with sequence > lastSequence return. */
  readonly lastSequence?: number;
  /** Wait window for the (currently MVP-short-) poll. */
  readonly timeoutMs?: number;
}

export interface PollEventsResult {
  readonly events: ReadonlyArray<unknown>;
  readonly nextSequence: number;
  readonly isComplete: boolean;
}

/**
 * Cloud Run workflow-runtime client. Stateless — methods do their
 * own auth + retry. Construct once at command boot; reuse across
 * calls within a single CLI invocation.
 */
export class WorkflowRuntimeClient {
  private readonly baseUrl: string;

  constructor(opts: { baseUrl?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? resolveWorkflowRuntimeUrl()).replace(/\/+$/, '');
  }

  /**
   * Open the SSE event stream and yield parsed events. Auto-resumes
   * on transient drops via `Last-Event-ID`. The async generator
   * terminates when (a) a terminal event arrives, (b) the supplied
   * abort signal fires, or (c) the reconnect budget is exhausted.
   *
   * Each yielded event is a `ParsedSseEvent` — callers JSON-parse
   * `event.data` to get the wire-shape `RunEventDoc`.
   */
  streamEvents(
    runId: string,
    opts: StreamEventsOptions = {},
  ): AsyncGenerator<ParsedSseEvent, void, void> {
    const reconnectOpts: ReconnectStreamOptions = {
      openStream: async (resumeFromId) => {
        const url = this.buildStreamUrl(runId, opts);
        const lastEventId = resumeFromId ?? opts.lastEventId ?? null;
        const response = await this.fetchWithAuth(url, {
          headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined,
          // Stream — don't auto-buffer; iterate the body.
          // signal forwarded through reconnectOpts below.
        });
        if (!response.ok) {
          throw await extractErrorEnvelope(response);
        }
        const body = response.body;
        if (!body) {
          throw new WorkflowRuntimeError(
            'Server returned empty body for SSE stream',
            'unknown',
            undefined,
            response.status,
          );
        }
        return body;
      },
      isTerminalEvent: opts.isTerminalEvent ?? isDefaultTerminalEvent,
      maxReconnects: opts.maxReconnects ?? 10,
      signal: opts.signal,
    };
    return consumeSseStreamWithReconnect(reconnectOpts);
  }

  /**
   * Short-poll fallback for callers that can't use SSE. Returns
   * events with sequence > `lastSequence` plus a flag indicating
   * whether the run is terminal.
   */
  async pollEvents(
    runId: string,
    opts: PollEventsOptions = {},
  ): Promise<PollEventsResult> {
    const url = new URL(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (opts.lastSequence !== undefined) {
      url.searchParams.set('lastSequence', String(opts.lastSequence));
    }
    if (opts.timeoutMs !== undefined) {
      url.searchParams.set('timeout', String(opts.timeoutMs));
    }
    const response = await this.fetchWithAuth(url.toString());
    if (!response.ok) {
      throw await extractErrorEnvelope(response);
    }
    const body = (await response.json()) as {
      events?: unknown[];
      nextSequence?: number;
      isComplete?: boolean;
    };
    return {
      events: body.events ?? [],
      nextSequence: typeof body.nextSequence === 'number' ? body.nextSequence : 0,
      isComplete: body.isComplete === true,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────

  private buildStreamUrl(runId: string, opts: StreamEventsOptions): string {
    const url = new URL(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`);
    if (opts.streamMode) url.searchParams.set('streamMode', opts.streamMode);
    if (opts.bufferMs !== undefined) {
      url.searchParams.set('bufferMs', String(opts.bufferMs));
    }
    return url.toString();
  }

  /**
   * Fetch with Bearer token attach + 401-retry-with-refresh. Returns
   * the raw `Response` so streaming callers can iterate the body
   * themselves; non-streaming callers `await response.json()` after
   * checking `response.ok`.
   *
   * The 401 retry follows the same pattern as `MyndHyveClient` (see
   * `src/api/client.ts`): one force-refresh, then surface as auth
   * error. This avoids an infinite loop when the user's session is
   * truly revoked.
   */
  private async fetchWithAuth(
    url: string,
    init: RequestInit = {},
    isRetry = false,
  ): Promise<Response> {
    let token: string;
    try {
      token = await getToken(isRetry);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new WorkflowRuntimeAuthError(err.message);
      }
      throw err;
    }
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'text/event-stream, application/json');
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401 && !isRetry) {
      log.debug('Received 401 from workflow-runtime; retrying with refreshed token', {
        url,
      });
      // Drain the body so the connection can be reused.
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      return this.fetchWithAuth(url, init, true);
    }
    if (response.status === 401) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }
      throw new WorkflowRuntimeAuthError(
        'workflow-runtime rejected the refreshed token. Run `myndhyve-cli auth login` to re-authenticate.',
      );
    }
    return response;
  }
}
