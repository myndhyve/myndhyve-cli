import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { streamChat, StreamError, type StreamCallbacks, type StreamRequest } from '../streaming.js';

// ── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a mock SSE Response with a ReadableStream body. */
function mockSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Build a mock error Response (non-200). */
function mockErrorResponse(
  status: number,
  body: string | Record<string, unknown> = ''
): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Error',
  });
}

/** Create a default StreamRequest for testing. */
function makeRequest(overrides?: Partial<StreamRequest>): StreamRequest {
  return {
    url: 'https://us-central1-myndhyve.cloudfunctions.net/aiProxyStream',
    token: 'test-firebase-token',
    body: {
      provider: 'anthropic',
      messages: [{ role: 'user', content: 'Hello' }],
    },
    ...overrides,
  };
}

/** Create mock callbacks that record calls. */
function makeCallbacks(): StreamCallbacks & {
  onDelta: Mock;
  onComplete: Mock;
  onError: Mock;
} {
  return {
    onDelta: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  };
}

/** Wait for async SSE processing to flush. */
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 50));

// ── Setup ───────────────────────────────────────────────────────────────────

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

// ============================================================================
// streamChat — Successful Streaming
// ============================================================================

describe('streamChat — successful streaming', () => {
  it('emits deltas and completes with full content', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        'data: {"content":"Hello world","delta":" world"}\n\n',
        'data: {"done":true,"content":"Hello world"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(2, ' world');
    expect(callbacks.onComplete).toHaveBeenCalledOnce();
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello world');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('returns an abort function', async () => {
    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"done":true,"content":"ok"}\n\n',
      ])
    );

    const abort = await streamChat(makeRequest(), makeCallbacks());

    expect(typeof abort).toBe('function');
  });

  it('handles single-chunk stream', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"content":"Hi","delta":"Hi","done":true}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledWith('Hi');
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hi');
  });

  it('sends correct request headers and body', async () => {
    fetchMock.mockResolvedValueOnce(
      mockSSEResponse(['data: {"done":true,"content":""}\n\n'])
    );

    await streamChat(
      makeRequest({
        token: 'my-firebase-token',
        body: {
          provider: 'openai',
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Test' }],
          temperature: 0.7,
        },
      }),
      makeCallbacks()
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us-central1-myndhyve.cloudfunctions.net/aiProxyStream');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer my-firebase-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.provider).toBe('openai');
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.7);
  });
});

// ============================================================================
// streamChat — Error Chunk Handling
// ============================================================================

describe('streamChat — error chunks in SSE data', () => {
  it('calls onError for error chunk with status', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        'data: {"error":"Rate limit exceeded","status":429}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');
    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.code).toBe('STREAM_ERROR');
    expect(err.statusCode).toBe(429);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('calls onError with BLOCKED code for blocked content', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"error":"Content blocked by safety filter","blocked":true,"status":400}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('BLOCKED');
    expect(err.message).toBe('Content blocked by safety filter');
    expect(err.statusCode).toBe(400);
  });

  it('stops processing after error chunk', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"error":"Server error","status":500}\n\n',
        'data: {"content":"This should not arrive","delta":"This should not arrive"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onError).toHaveBeenCalledOnce();
    // The delta after the error should NOT be called because processSSELine returns true
    expect(callbacks.onDelta).not.toHaveBeenCalled();
  });
});

// ============================================================================
// streamChat — HTTP Error Responses
// ============================================================================

describe('streamChat — HTTP error responses', () => {
  it('calls onError with UNAUTHORIZED for 401', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(401, { error: 'Invalid token' })
    );

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid token');
  });

  it('calls onError with RATE_LIMITED for 429', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(429, { error: 'Too many requests', retryAfter: 30 })
    );

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(30);
  });

  it('calls onError with API_ERROR for 500', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(500, { message: 'Internal server error' })
    );

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Internal server error');
  });

  it('handles non-JSON error body gracefully', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(502, 'Bad Gateway')
    );

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(502);
    expect(err.message).toBe('Bad Gateway');
  });

  it('handles empty error body', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(503, '')
    );

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain('503');
  });

  it('returns a no-op abort function on HTTP error', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(mockErrorResponse(401, ''));

    const abort = await streamChat(makeRequest(), callbacks);

    expect(typeof abort).toBe('function');
    // Should not throw when called
    abort();
  });
});

// ============================================================================
// streamChat — Network Errors
// ============================================================================

describe('streamChat — network errors', () => {
  it('calls onError with NETWORK_ERROR for fetch failure', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toContain('Failed to fetch');
  });

  it('calls onError with TIMEOUT for timeout errors', async () => {
    const callbacks = makeCallbacks();

    const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');
    fetchMock.mockRejectedValueOnce(timeoutError);

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toContain('timed out');
  });

  it('calls onError with NETWORK_ERROR for non-Error rejection', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockRejectedValueOnce('connection refused');

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toContain('connection refused');
  });

  it('calls onError for no response body', async () => {
    const callbacks = makeCallbacks();

    // Response with ok: true but null body
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    await streamChat(makeRequest(), callbacks);

    expect(callbacks.onError).toHaveBeenCalledOnce();
    const err = callbacks.onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(StreamError);
    expect(err.code).toBe('NO_BODY');
  });
});

// ============================================================================
// streamChat — Abort / Cancellation
// ============================================================================

describe('streamChat — abort / cancellation', () => {
  it('does not call onError when user aborts before fetch', async () => {
    const callbacks = makeCallbacks();
    const userController = new AbortController();

    // Abort before fetch resolves
    userController.abort();

    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    );

    await streamChat(
      makeRequest({ signal: userController.signal }),
      callbacks
    );

    // When signal is already aborted, no error should be reported
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('abort function cancels in-progress stream', async () => {
    const callbacks = makeCallbacks();
    let _streamController: ReadableStreamDefaultController<Uint8Array>;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        _streamController = controller;
        // Enqueue first chunk immediately
        controller.enqueue(
          encoder.encode('data: {"content":"Hello","delta":"Hello"}\n\n')
        );
      },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    const abort = await streamChat(makeRequest(), callbacks);

    // Wait for first chunk to process
    await flushPromises();
    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');

    // Abort the stream
    abort();

    // Give time for abort to propagate
    await flushPromises();

    // No error should be reported for user-initiated abort
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// SSE Line Parsing Edge Cases
// ============================================================================

describe('SSE line parsing edge cases', () => {
  it('ignores empty lines between SSE data', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        '\n\n',
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        '\n\n',
        'data: {"done":true,"content":"Hello"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello');
  });

  it('ignores non-data SSE lines (comments, event, id)', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        ': this is a comment\n',
        'event: message\n',
        'id: 1\n',
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        'retry: 3000\n',
        'data: {"done":true,"content":"Hello"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledTimes(1);
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('ignores [DONE] marker', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        'data: {"done":true,"content":"Hello"}\n\n',
        'data: [DONE]\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    // onComplete should only be called once (from the done chunk, not [DONE])
    expect(callbacks.onComplete).toHaveBeenCalledOnce();
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('handles malformed JSON in SSE data gracefully', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {invalid json}\n\n',
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        'data: {"done":true,"content":"Hello"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    // Malformed JSON should be silently skipped
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onDelta).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello');
  });

  it('handles chunks split across multiple enqueues', async () => {
    const callbacks = makeCallbacks();

    // Simulate the SSE data arriving in fragmented TCP packets
    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"content":"He',        // Incomplete JSON
        'llo","delta":"Hello"}\n\n',    // Rest of first chunk
        'data: {"done":true,"content":"Hello"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello');
  });

  it('handles data with extra whitespace after colon', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data:   {"content":"Hello","delta":"Hello"}  \n\n',
        'data:{"content":"Hello world","delta":" world"}\n\n',
        'data: {"done":true,"content":"Hello world"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(2, ' world');
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello world');
  });

  it('handles stream ending without explicit done chunk', async () => {
    const callbacks = makeCallbacks();

    // Stream closes without a done:true chunk
    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"content":"Hello","delta":"Hello"}\n\n',
        'data: {"content":"Hello world","delta":" world"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    // Should still complete with accumulated content when stream ends
    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello world');
  });

  it('handles delta-only chunks (no content field)', async () => {
    const callbacks = makeCallbacks();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"delta":"Hello"}\n\n',
        'data: {"delta":" world"}\n\n',
        'data: {"done":true,"content":"Hello world"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello world');
  });

  it('falls back to accumulated deltas when stream ends without content field (#15)', async () => {
    const callbacks = makeCallbacks();

    // Server sends only delta fields, no content field, and stream closes without done
    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        'data: {"delta":"Hello"}\n\n',
        'data: {"delta":" world"}\n\n',
      ])
    );

    await streamChat(makeRequest(), callbacks);
    await flushPromises();

    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    // Should fall back to accumulated deltas since no content field was ever sent
    expect(callbacks.onComplete).toHaveBeenCalledWith('Hello world');
  });
});

// ============================================================================
// StreamError
// ============================================================================

describe('StreamError', () => {
  it('has correct name, code, statusCode, and retryAfter', () => {
    const err = new StreamError('Rate limited', 'RATE_LIMITED', 429, 60);

    expect(err.name).toBe('StreamError');
    expect(err.message).toBe('Rate limited');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(60);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StreamError);
  });

  it('works without optional fields', () => {
    const err = new StreamError('Network issue', 'NETWORK_ERROR');

    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.statusCode).toBeUndefined();
    expect(err.retryAfter).toBeUndefined();
  });
});
