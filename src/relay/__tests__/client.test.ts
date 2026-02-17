import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RelayClient, RelayClientError } from '../client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock Response object. */
function mockResponse(
  body: unknown,
  status = 200,
  ok = true
): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as Response['type'],
    url: '',
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    bytes: vi.fn(),
  } as unknown as Response;
}

function mockErrorResponse(
  status: number,
  errorBody: string | Record<string, unknown> = ''
): Response {
  const bodyStr = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody);
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(errorBody),
    text: vi.fn().mockResolvedValue(bodyStr),
    headers: new Headers(),
    redirected: false,
    statusText: 'Error',
    type: 'basic' as Response['type'],
    url: '',
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    bytes: vi.fn(),
  } as unknown as Response;
}

// ── Setup ────────────────────────────────────────────────────────────────────

let fetchMock: Mock;
const BASE_URL = 'https://api.myndhyve.test/relay';

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

// ============================================================================
// CONSTRUCTOR
// ============================================================================

describe('RelayClient — constructor', () => {
  it('strips trailing slash from base URL', () => {
    const client = new RelayClient('https://api.test.com/relay/');
    fetchMock.mockResolvedValueOnce(
      mockResponse({ relayId: 'r1', activationCode: 'AC', activationCodeExpiresAt: '2025-01-01' })
    );
    client.register('whatsapp', 'Test', 'token123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/relay/register',
      expect.anything()
    );
  });

  it('does not double-strip when no trailing slash', () => {
    const client = new RelayClient('https://api.test.com/relay');
    fetchMock.mockResolvedValueOnce(
      mockResponse({ relayId: 'r1', activationCode: 'AC', activationCodeExpiresAt: '2025-01-01' })
    );
    client.register('whatsapp', 'Test', 'token123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.com/relay/register',
      expect.anything()
    );
  });
});

// ============================================================================
// register()
// ============================================================================

describe('RelayClient.register()', () => {
  it('sends correct POST with auth header and returns parsed response', async () => {
    const client = new RelayClient(BASE_URL);
    const expected = {
      relayId: 'relay-123',
      activationCode: 'ABC123',
      activationCodeExpiresAt: '2025-06-01T00:00:00Z',
    };
    fetchMock.mockResolvedValueOnce(mockResponse(expected));

    const result = await client.register('whatsapp', 'My Laptop', 'firebase-id-token-xyz');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/register`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer firebase-id-token-xyz');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ channel: 'whatsapp', label: 'My Laptop' });
    expect(result).toEqual(expected);
  });
});

// ============================================================================
// activate()
// ============================================================================

describe('RelayClient.activate()', () => {
  it('sends POST and stores returned deviceToken on client instance', async () => {
    const client = new RelayClient(BASE_URL);
    const activateResp = {
      deviceToken: 'dt-secret-456',
      tokenExpiresAt: '2025-12-31T23:59:59Z',
      heartbeatIntervalSeconds: 30,
      outboundPollIntervalSeconds: 5,
    };
    fetchMock.mockResolvedValueOnce(mockResponse(activateResp));

    const result = await client.activate('relay-123', 'ABC123', '0.1.0', {
      os: 'darwin',
      arch: 'arm64',
    });

    expect(result).toEqual(activateResp);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/activate`);
    expect(init.method).toBe('POST');
    // No Authorization header for activate — activation code is in body
    expect(init.headers['Authorization']).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.relayId).toBe('relay-123');
    expect(body.activationCode).toBe('ABC123');
    expect(body.version).toBe('0.1.0');
    expect(body.metadata).toEqual({ os: 'darwin', arch: 'arm64' });

    // After activation, device token should be usable for heartbeat
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, hasPendingOutbound: false, heartbeatIntervalSeconds: 30 })
    );
    await client.heartbeat('relay-123');
    const [, hbInit] = fetchMock.mock.calls[1];
    expect(hbInit.headers['Authorization']).toBe('Bearer dt-secret-456');
  });
});

// ============================================================================
// revoke()
// ============================================================================

describe('RelayClient.revoke()', () => {
  it('sends POST with auth header and reason', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    await client.revoke('relay-123', 'firebase-id-token', 'user requested');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/revoke`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer firebase-id-token');
    const body = JSON.parse(init.body);
    expect(body.relayId).toBe('relay-123');
    expect(body.reason).toBe('user requested');
  });

  it('sends POST without reason when omitted', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    await client.revoke('relay-123', 'firebase-id-token');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.relayId).toBe('relay-123');
    expect(body.reason).toBeUndefined();
  });
});

// ============================================================================
// heartbeat()
// ============================================================================

describe('RelayClient.heartbeat()', () => {
  it('sends POST with device token auth and returns response', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    const expected = {
      ok: true,
      hasPendingOutbound: true,
      heartbeatIntervalSeconds: 30,
    };
    fetchMock.mockResolvedValueOnce(mockResponse(expected));

    const result = await client.heartbeat('relay-123', {
      version: '0.1.0',
      uptimeSeconds: 3600,
    });

    expect(result).toEqual(expected);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/heartbeat`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer dt-token');
    const body = JSON.parse(init.body);
    expect(body.relayId).toBe('relay-123');
    expect(body.version).toBe('0.1.0');
    expect(body.uptimeSeconds).toBe(3600);
  });

  it('sends heartbeat without optional status fields', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, hasPendingOutbound: false, heartbeatIntervalSeconds: 30 })
    );

    await client.heartbeat('relay-123');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.relayId).toBe('relay-123');
    // No extra status fields
    expect(body.version).toBeUndefined();
  });
});

// ============================================================================
// sendInbound()
// ============================================================================

describe('RelayClient.sendInbound()', () => {
  it('sends POST with envelope and returns response', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    const envelope = {
      channel: 'whatsapp' as const,
      platformMessageId: 'msg-001',
      conversationId: 'conv-001',
      peerId: '+1234567890',
      peerDisplay: 'Alice',
      text: 'Hello MyndHyve!',
      isGroup: false,
      timestamp: '2025-06-01T12:00:00Z',
    };
    const expected = { ok: true, sessionKey: 'sess-001', dispatched: true };
    fetchMock.mockResolvedValueOnce(mockResponse(expected));

    const result = await client.sendInbound('relay-123', envelope);

    expect(result).toEqual(expected);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/inbound`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer dt-token');
    const body = JSON.parse(init.body);
    expect(body.relayId).toBe('relay-123');
    expect(body.envelope).toEqual(envelope);
    expect(body.stagedMedia).toBeUndefined();
  });

  it('handles media in inbound request', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    const envelope = {
      channel: 'signal' as const,
      platformMessageId: 'msg-002',
      conversationId: 'conv-002',
      peerId: 'user-signal-id',
      text: 'Check this photo',
      isGroup: false,
      timestamp: '2025-06-01T12:00:00Z',
      media: [
        {
          kind: 'image' as const,
          ref: 'media-ref-001',
          mimeType: 'image/jpeg',
          size: 102400,
        },
      ],
    };
    const stagedMedia = [
      { ref: 'media-ref-001', base64: 'aGVsbG8=', mimeType: 'image/jpeg' },
    ];
    const expected = { ok: true, dispatched: true };
    fetchMock.mockResolvedValueOnce(mockResponse(expected));

    const result = await client.sendInbound('relay-123', envelope, stagedMedia);

    expect(result).toEqual(expected);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stagedMedia).toEqual(stagedMedia);
    expect(body.envelope.media).toHaveLength(1);
  });
});

// ============================================================================
// pollOutbound()
// ============================================================================

describe('RelayClient.pollOutbound()', () => {
  it('sends GET with relayId query param and returns message array', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    const messages = [
      {
        id: 'out-001',
        envelope: {
          channel: 'whatsapp',
          conversationId: 'conv-001',
          text: 'AI response here',
        },
        queuedAt: '2025-06-01T12:05:00Z',
        priority: 0,
        attempts: 0,
      },
    ];
    fetchMock.mockResolvedValueOnce(mockResponse({ messages }));

    const result = await client.pollOutbound('relay-123');

    expect(result).toEqual(messages);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/outbound?relayId=relay-123`);
    expect(init.method).toBe('GET');
    expect(init.headers['Authorization']).toBe('Bearer dt-token');
  });

  it('returns empty array when no messages', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    fetchMock.mockResolvedValueOnce(mockResponse({ messages: [] }));

    const result = await client.pollOutbound('relay-123');

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('encodes relayId in query parameter', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    fetchMock.mockResolvedValueOnce(mockResponse({ messages: [] }));

    await client.pollOutbound('relay/special chars+123');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/outbound?relayId=relay%2Fspecial%20chars%2B123`);
  });
});

// ============================================================================
// ackOutbound()
// ============================================================================

describe('RelayClient.ackOutbound()', () => {
  it('sends POST with delivery ack', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    const ack = {
      outboundMessageId: 'out-001',
      success: true,
      platformMessageId: 'wa-msg-001',
      durationMs: 150,
    };
    await client.ackOutbound(ack);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/ack`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer dt-token');
    expect(JSON.parse(init.body)).toEqual(ack);
  });

  it('sends failure ack with error details', async () => {
    const client = new RelayClient(BASE_URL, 'dt-token');
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true }));

    const ack = {
      outboundMessageId: 'out-002',
      success: false,
      error: 'Contact not found',
      retryable: false,
      durationMs: 50,
    };
    await client.ackOutbound(ack);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Contact not found');
    expect(body.retryable).toBe(false);
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('RelayClient — error handling', () => {
  it('throws RelayClientError with API_ERROR code for HTTP 401', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(401, { error: 'Unauthorized' })
    );

    const err = await client
      .register('whatsapp', 'Test', 'bad-token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain('401');
    expect(err.message).toContain('Unauthorized');
  });

  it('throws RelayClientError with API_ERROR code for HTTP 500', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(500, { message: 'Internal Server Error' })
    );

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toContain('Internal Server Error');
  });

  it('parses error body with "error" field', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(400, { error: 'Bad channel' })
    );

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err.message).toContain('Bad channel');
  });

  it('parses error body with "message" field', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockResolvedValueOnce(
      mockErrorResponse(403, { message: 'Forbidden' })
    );

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err.message).toContain('Forbidden');
  });

  it('handles non-JSON error body gracefully', async () => {
    const client = new RelayClient(BASE_URL);
    const resp = {
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue('Bad Gateway'),
      headers: new Headers(),
      redirected: false,
      statusText: 'Bad Gateway',
      type: 'basic' as Response['type'],
      url: '',
      clone: vi.fn(),
      body: null,
      bodyUsed: false,
      arrayBuffer: vi.fn(),
      blob: vi.fn(),
      formData: vi.fn(),
      json: vi.fn(),
      bytes: vi.fn(),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(resp);

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('Bad Gateway');
  });

  it('handles empty error body', async () => {
    const client = new RelayClient(BASE_URL);
    const resp = {
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue(''),
      headers: new Headers(),
      redirected: false,
      statusText: 'Service Unavailable',
      type: 'basic' as Response['type'],
      url: '',
      clone: vi.fn(),
      body: null,
      bodyUsed: false,
      arrayBuffer: vi.fn(),
      blob: vi.fn(),
      formData: vi.fn(),
      json: vi.fn(),
      bytes: vi.fn(),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(resp);

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('API_ERROR');
    expect(err.message).toContain('503');
  });

  it('throws NETWORK_ERROR for fetch rejection', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toContain('fetch failed');
    expect(err.statusCode).toBeUndefined();
  });

  it('throws NETWORK_ERROR for non-Error rejection', async () => {
    const client = new RelayClient(BASE_URL);
    fetchMock.mockRejectedValueOnce('connection refused');

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toContain('connection refused');
  });

  it('throws TIMEOUT for AbortError (DOMException)', async () => {
    const client = new RelayClient(BASE_URL);
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);

    const err = await client
      .register('whatsapp', 'Test', 'token')
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toContain('timed out');
  });

  it('throws NO_DEVICE_TOKEN when calling heartbeat without token', async () => {
    const client = new RelayClient(BASE_URL);

    const err = await client.heartbeat('relay-123').catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('NO_DEVICE_TOKEN');
    expect(err.message).toContain('Device token not set');
  });

  it('throws NO_DEVICE_TOKEN when calling sendInbound without token', async () => {
    const client = new RelayClient(BASE_URL);
    const envelope = {
      channel: 'whatsapp' as const,
      platformMessageId: 'msg-001',
      conversationId: 'conv-001',
      peerId: '+1234567890',
      text: 'Hi',
      isGroup: false,
      timestamp: '2025-06-01T12:00:00Z',
    };

    const err = await client.sendInbound('relay-123', envelope).catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('NO_DEVICE_TOKEN');
  });

  it('throws NO_DEVICE_TOKEN when calling pollOutbound without token', async () => {
    const client = new RelayClient(BASE_URL);

    const err = await client.pollOutbound('relay-123').catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('NO_DEVICE_TOKEN');
  });

  it('throws NO_DEVICE_TOKEN when calling ackOutbound without token', async () => {
    const client = new RelayClient(BASE_URL);

    const err = await client
      .ackOutbound({
        outboundMessageId: 'out-001',
        success: true,
        durationMs: 100,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(RelayClientError);
    expect(err.code).toBe('NO_DEVICE_TOKEN');
  });
});

// ============================================================================
// setDeviceToken()
// ============================================================================

describe('RelayClient.setDeviceToken()', () => {
  it('updates token used in subsequent requests', async () => {
    const client = new RelayClient(BASE_URL, 'old-token');
    fetchMock.mockResolvedValue(
      mockResponse({ ok: true, hasPendingOutbound: false, heartbeatIntervalSeconds: 30 })
    );

    // First request with old token
    await client.heartbeat('relay-123');
    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer old-token');

    // Update token
    client.setDeviceToken('new-token');

    // Second request with new token
    await client.heartbeat('relay-123');
    expect(fetchMock.mock.calls[1][1].headers['Authorization']).toBe('Bearer new-token');
  });

  it('allows previously-blocked methods to succeed after setting token', async () => {
    const client = new RelayClient(BASE_URL); // no token
    client.setDeviceToken('fresh-token');

    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, hasPendingOutbound: false, heartbeatIntervalSeconds: 30 })
    );

    await client.heartbeat('relay-123');

    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer fresh-token');
  });
});

// ============================================================================
// RelayClientError
// ============================================================================

describe('RelayClientError', () => {
  it('has correct name, code, and statusCode properties', () => {
    const err = new RelayClientError('Something broke', 'API_ERROR', 500);
    expect(err.name).toBe('RelayClientError');
    expect(err.message).toBe('Something broke');
    expect(err.code).toBe('API_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RelayClientError);
  });

  it('works without statusCode', () => {
    const err = new RelayClientError('No network', 'NETWORK_ERROR');
    expect(err.statusCode).toBeUndefined();
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
