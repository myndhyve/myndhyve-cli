/**
 * Tests for `WorkflowRuntimeClient` — the Bearer-auth + SSE wrapper
 * for the Cloud Run workflow-runtime endpoints.
 *
 * Coverage:
 *   - Token attach: every fetch carries `Authorization: Bearer <token>`
 *   - 401 retry: a single 401 force-refreshes the token, second 401
 *     surfaces `WorkflowRuntimeAuthError`
 *   - URL building: streamMode + bufferMs query params encoded correctly
 *   - Last-Event-ID forwarded on initial connect when supplied
 *   - Error envelope: F-2026-04-29-01-compliant `{error: code, message:
 *     human, hint?}` parses into `WorkflowRuntimeError` with all fields
 *   - pollEvents: parses `events`/`nextSequence`/`isComplete` from
 *     the JSON body
 *   - SSE stream: returns parsed events from a synthetic body
 *   - Default terminal-event detector matches the engine's run-level
 *     terminal events (run.completed/failed/cancelled/timed-out)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn<(forceRefresh?: boolean) => Promise<string>>(),
}));

vi.mock('../../auth/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../auth/index.js')>(
    '../../auth/index.js',
  );
  return {
    ...actual,
    getToken: (forceRefresh?: boolean) => mockGetToken(forceRefresh),
  };
});

import {
  WorkflowRuntimeClient,
  WorkflowRuntimeAuthError,
  WorkflowRuntimeError,
  isDefaultTerminalEvent,
} from '../workflowRuntimeClient.js';

// ─── Test fetch harness ───────────────────────────────────────────

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

let fetchCalls: FetchCall[] = [];
let fetchHandler: (call: FetchCall) => Response | Promise<Response>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  fetchHandler = () =>
    new Response('default', {
      status: 500,
      statusText: 'No handler set',
    });
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call: FetchCall = { url, init };
    fetchCalls.push(call);
    return fetchHandler(call);
  }) as typeof globalThis.fetch;
  mockGetToken.mockReset();
  mockGetToken.mockResolvedValue('test-token-1');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// ─── Tests ────────────────────────────────────────────────────────

describe('WorkflowRuntimeClient.pollEvents', () => {
  it('attaches Bearer token from getToken()', async () => {
    fetchHandler = () => jsonResponse({ events: [], nextSequence: 0, isComplete: false });
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    await client.pollEvents('run-1');
    expect(fetchCalls).toHaveLength(1);
    const headers = new Headers(fetchCalls[0]?.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token-1');
  });

  it('builds the canonical URL with lastSequence query param', async () => {
    fetchHandler = () => jsonResponse({ events: [], nextSequence: 5, isComplete: false });
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    await client.pollEvents('run-1', { lastSequence: 4 });
    expect(fetchCalls[0]?.url).toBe(
      'https://wf.example/v1/runs/run-1/events/poll?lastSequence=4',
    );
  });

  it('parses the success body shape', async () => {
    fetchHandler = () =>
      jsonResponse({
        events: [{ sequence: 5, type: 'node.completed' }],
        nextSequence: 6,
        isComplete: false,
      });
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const result = await client.pollEvents('run-1');
    expect(result.events).toHaveLength(1);
    expect(result.nextSequence).toBe(6);
    expect(result.isComplete).toBe(false);
  });

  it('parses canonical error envelope into WorkflowRuntimeError', async () => {
    fetchHandler = () =>
      jsonResponse(
        {
          error: 'run_not_found',
          message: 'Run not found',
          hint: 'Check the runId or use `workflows list`.',
        },
        404,
      );
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    await expect(client.pollEvents('missing')).rejects.toMatchObject({
      name: 'WorkflowRuntimeError',
      code: 'run_not_found',
      message: 'Run not found',
      hint: 'Check the runId or use `workflows list`.',
      httpStatus: 404,
    });
  });

  it('falls back to "unknown" code when the body is non-JSON', async () => {
    fetchHandler = () =>
      new Response('<html>Service Unavailable</html>', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'content-type': 'text/html' },
      });
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const err = (await client.pollEvents('run-1').catch((e: unknown) => e)) as WorkflowRuntimeError;
    expect(err).toBeInstanceOf(WorkflowRuntimeError);
    expect(err.code).toBe('unknown');
    expect(err.httpStatus).toBe(503);
  });

  it('retries once with a refreshed token on 401, then surfaces auth error', async () => {
    let attempt = 0;
    mockGetToken.mockImplementation((forceRefresh?: boolean) => {
      // First call: returns stale token. Second (forceRefresh=true)
      // returns fresh, but the server still 401s — surfaces auth.
      attempt += 1;
      return Promise.resolve(forceRefresh ? 'fresh-token' : 'stale-token');
    });
    fetchHandler = () =>
      jsonResponse({ error: 'auth_required', message: 'token rejected' }, 401);
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    await expect(client.pollEvents('run-1')).rejects.toBeInstanceOf(
      WorkflowRuntimeAuthError,
    );
    // Two fetches: original + retry with refreshed token.
    expect(fetchCalls).toHaveLength(2);
    expect(new Headers(fetchCalls[0]?.init?.headers).get('Authorization')).toBe(
      'Bearer stale-token',
    );
    expect(new Headers(fetchCalls[1]?.init?.headers).get('Authorization')).toBe(
      'Bearer fresh-token',
    );
    // getToken called twice: first regular, second forceRefresh=true.
    expect(attempt).toBe(2);
  });

  it('passes through after a successful 401-retry without surfacing auth error', async () => {
    let serverCallCount = 0;
    fetchHandler = () => {
      serverCallCount += 1;
      if (serverCallCount === 1) {
        return jsonResponse({ error: 'auth_required', message: 'expired' }, 401);
      }
      return jsonResponse({ events: [], nextSequence: 0, isComplete: false });
    };
    mockGetToken
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const result = await client.pollEvents('run-1');
    expect(result.isComplete).toBe(false);
    expect(fetchCalls).toHaveLength(2);
  });
});

describe('WorkflowRuntimeClient.streamEvents URL building', () => {
  it('encodes streamMode + bufferMs as query params', async () => {
    fetchHandler = () => sseResponse('event: ping\ndata: 1\n\n');
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const gen = client.streamEvents('run-1', {
      streamMode: 'updates,messages',
      bufferMs: 500,
      maxReconnects: 0,
    });
    // Drive one iteration so the request fires.
    await gen.next();
    expect(fetchCalls[0]?.url).toBe(
      'https://wf.example/v1/runs/run-1/events?streamMode=updates%2Cmessages&bufferMs=500',
    );
  });

  it('forwards Last-Event-ID when supplied', async () => {
    fetchHandler = () => sseResponse('event: ping\ndata: 1\n\n');
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const gen = client.streamEvents('run-1', { lastEventId: '42', maxReconnects: 0 });
    await gen.next();
    expect(new Headers(fetchCalls[0]?.init?.headers).get('Last-Event-ID')).toBe('42');
  });

  it('omits Last-Event-ID on initial connect when not supplied', async () => {
    fetchHandler = () => sseResponse('event: ping\ndata: 1\n\n');
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const gen = client.streamEvents('run-1', { maxReconnects: 0 });
    await gen.next();
    expect(new Headers(fetchCalls[0]?.init?.headers).get('Last-Event-ID')).toBeNull();
  });

  it('yields parsed events from the SSE body', async () => {
    fetchHandler = () =>
      sseResponse(
        'id: 1\nevent: run.started\ndata: {"r":1}\n\n' +
          'id: 2\nevent: run.completed\ndata: {"r":1}\n\n',
      );
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example' });
    const events: { id: string | null; event: string }[] = [];
    for await (const ev of client.streamEvents('run-1', { maxReconnects: 0 })) {
      events.push({ id: ev.id, event: ev.event });
    }
    expect(events).toEqual([
      { id: '1', event: 'run.started' },
      { id: '2', event: 'run.completed' },
    ]);
  });
});

describe('isDefaultTerminalEvent', () => {
  it.each([
    ['run.completed', true],
    ['run.failed', true],
    ['run.cancelled', true],
    ['run.timed-out', true],
    ['node.completed', false],
    ['run.started', false],
    ['run.suspended', false],
    ['', false],
  ])('returns %s → %s', (eventName, expected) => {
    expect(isDefaultTerminalEvent({ id: null, event: eventName, data: '' })).toBe(expected);
  });
});

describe('baseUrl handling', () => {
  it('strips trailing slashes from the base URL', async () => {
    fetchHandler = () => jsonResponse({ events: [], nextSequence: 0, isComplete: false });
    const client = new WorkflowRuntimeClient({ baseUrl: 'https://wf.example///' });
    await client.pollEvents('run-1');
    expect(fetchCalls[0]?.url).toBe('https://wf.example/v1/runs/run-1/events/poll');
  });
});
