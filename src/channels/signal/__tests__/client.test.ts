import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return mockFetch.mockResolvedValueOnce({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
  });
}

const BASE_URL = 'http://127.0.0.1:18080';

// ---------------------------------------------------------------------------
// Import (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  signalRpcCall,
  sendMessage,
  startLink,
  finishLink,
  registerAccount,
  verifyAccount,
  getVersion,
  healthCheck,
  SignalRpcError,
  _resetRequestId,
} from '../client.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset();
  _resetRequestId();
});

// ===========================================================================
// signalRpcCall
// ===========================================================================

describe('signalRpcCall', () => {
  it('makes correct HTTP request with JSON-RPC 2.0 format', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: 'ok' });

    await signalRpcCall(BASE_URL, 'someMethod', { key: 'value' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/rpc`);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(options.body);
    expect(body).toEqual({
      jsonrpc: '2.0',
      method: 'someMethod',
      params: { key: 'value' },
      id: 1,
    });
  });

  it('increments request ID for each call', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: 'a' });
    mockFetchResponse({ jsonrpc: '2.0', id: 2, result: 'b' });
    mockFetchResponse({ jsonrpc: '2.0', id: 3, result: 'c' });

    await signalRpcCall(BASE_URL, 'method1');
    await signalRpcCall(BASE_URL, 'method2');
    await signalRpcCall(BASE_URL, 'method3');

    const ids = mockFetch.mock.calls.map(
      (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string).id
    );
    expect(ids).toEqual([1, 2, 3]);
  });

  it('returns result on success', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { version: '0.13.4' },
    });

    const result = await signalRpcCall<{ version: string }>(
      BASE_URL,
      'version'
    );
    expect(result).toEqual({ version: '0.13.4' });
  });

  it('throws SignalRpcError on JSON-RPC error response', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    });

    await expect(signalRpcCall(BASE_URL, 'badMethod')).rejects.toThrow(
      SignalRpcError
    );

    try {
      mockFetchResponse({
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32601, message: 'Method not found' },
      });
      await signalRpcCall(BASE_URL, 'badMethod');
    } catch (err) {
      expect(err).toBeInstanceOf(SignalRpcError);
      const rpcErr = err as SignalRpcError;
      expect(rpcErr.code).toBe(-32601);
      expect(rpcErr.message).toBe('Method not found');
      expect(rpcErr.method).toBe('badMethod');
    }
  });

  it('throws SignalRpcError on non-OK HTTP status', async () => {
    mockFetchResponse(null, false, 503);

    await expect(signalRpcCall(BASE_URL, 'send')).rejects.toThrow(
      SignalRpcError
    );

    try {
      mockFetchResponse(null, false, 500);
      await signalRpcCall(BASE_URL, 'send');
    } catch (err) {
      expect(err).toBeInstanceOf(SignalRpcError);
      const rpcErr = err as SignalRpcError;
      expect(rpcErr.code).toBe(-1);
      expect(rpcErr.method).toBe('send');
      expect(rpcErr.message).toContain('HTTP');
    }
  });

  it('sends request without params when none are provided', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: { version: '1.0' } });

    await signalRpcCall(BASE_URL, 'version');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toBeUndefined();
  });
});

// ===========================================================================
// sendMessage
// ===========================================================================

describe('sendMessage', () => {
  it('sends a direct message with correct params', async () => {
    const sendResult = [
      {
        type: 'SUCCESS',
        recipientAddress: { uuid: 'abc-123', number: '+15551234567' },
        timestamp: 1700000000000,
      },
    ];
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: sendResult });

    const result = await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      message: 'Hello from MyndHyve',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('send');
    expect(body.params).toEqual({
      message: 'Hello from MyndHyve',
      recipient: ['+15551234567'],
    });
    expect(result).toEqual(sendResult);
  });

  it('sends to a group with correct params', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      groupId: 'group-abc-123',
      message: 'Hello group!',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toEqual({
      message: 'Hello group!',
      groupId: 'group-abc-123',
    });
    // Should not include recipient when groupId is provided
    expect(body.params.recipient).toBeUndefined();
  });

  it('prefers groupId over recipient when both are provided', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      groupId: 'group-xyz',
      message: 'Both provided',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.groupId).toBe('group-xyz');
    expect(body.params.recipient).toBeUndefined();
  });

  it('includes attachments when provided', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      message: 'See attached',
      attachments: ['/tmp/photo.jpg', '/tmp/document.pdf'],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.attachments).toEqual([
      '/tmp/photo.jpg',
      '/tmp/document.pdf',
    ]);
  });

  it('does not include attachments key when array is empty', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      message: 'No attachments',
      attachments: [],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.attachments).toBeUndefined();
  });

  it('includes quote params when provided', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      message: 'Replying to you',
      quoteTimestamp: 1700000000000,
      quoteAuthor: '+15559876543',
      quoteMessage: 'Original message text',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.quoteTimestamp).toBe(1700000000000);
    expect(body.params.quoteAuthor).toBe('+15559876543');
    expect(body.params.quoteMessage).toBe('Original message text');
  });

  it('does not include quoteAuthor/quoteMessage when quoteTimestamp is not set', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      message: 'No quote',
      quoteAuthor: '+15559876543',
      quoteMessage: 'This should be ignored',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.quoteTimestamp).toBeUndefined();
    expect(body.params.quoteAuthor).toBeUndefined();
    expect(body.params.quoteMessage).toBeUndefined();
  });

  it('includes mentions when provided', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      groupId: 'group-abc',
      message: 'Hey @Alice and @Bob',
      mentions: ['0:5:uuid-alice', '10:4:uuid-bob'],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.mentions).toEqual([
      '0:5:uuid-alice',
      '10:4:uuid-bob',
    ]);
  });

  it('does not include mentions key when array is empty', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: [{ type: 'SUCCESS', recipientAddress: {} }],
    });

    await sendMessage(BASE_URL, {
      recipient: '+15551234567',
      message: 'No mentions',
      mentions: [],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.mentions).toBeUndefined();
  });
});

// ===========================================================================
// startLink
// ===========================================================================

describe('startLink', () => {
  it('sends correct method and deviceName param', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { deviceLinkUri: 'sgnl://linkdevice?uuid=abc&pub_key=xyz' },
    });

    await startLink(BASE_URL, 'MyndHyve Relay');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('startLink');
    expect(body.params).toEqual({ deviceName: 'MyndHyve Relay' });
  });

  it('returns deviceLinkUri', async () => {
    const expectedUri = 'sgnl://linkdevice?uuid=abc-def&pub_key=xyz123';
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { deviceLinkUri: expectedUri },
    });

    const result = await startLink(BASE_URL, 'MyndHyve Relay');

    expect(result).toEqual({ deviceLinkUri: expectedUri });
  });
});

// ===========================================================================
// finishLink
// ===========================================================================

describe('finishLink', () => {
  it('sends correct method and deviceLinkUri param', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { number: '+15551234567', uuid: 'uuid-abc-123' },
    });

    await finishLink(
      BASE_URL,
      'sgnl://linkdevice?uuid=abc&pub_key=xyz'
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('finishLink');
    expect(body.params).toEqual({
      deviceLinkUri: 'sgnl://linkdevice?uuid=abc&pub_key=xyz',
    });
  });

  it('returns number and uuid', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { number: '+15551234567', uuid: 'uuid-abc-123' },
    });

    const result = await finishLink(
      BASE_URL,
      'sgnl://linkdevice?uuid=abc&pub_key=xyz'
    );

    expect(result).toEqual({
      number: '+15551234567',
      uuid: 'uuid-abc-123',
    });
  });
});

// ===========================================================================
// registerAccount
// ===========================================================================

describe('registerAccount', () => {
  it('sends correct params with defaults', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: null });

    await registerAccount(BASE_URL, { number: '+15551234567' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('register');
    expect(body.params).toEqual({
      account: '+15551234567',
      captcha: undefined,
      voice: false,
    });
  });

  it('sends captcha and voice when provided', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: null });

    await registerAccount(BASE_URL, {
      number: '+15551234567',
      captcha: 'captcha-token-abc',
      voice: true,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toEqual({
      account: '+15551234567',
      captcha: 'captcha-token-abc',
      voice: true,
    });
  });

  it('resolves without returning a value', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: null });

    const result = await registerAccount(BASE_URL, {
      number: '+15551234567',
    });

    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// verifyAccount
// ===========================================================================

describe('verifyAccount', () => {
  it('sends correct params', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: null });

    await verifyAccount(BASE_URL, {
      number: '+15551234567',
      verificationCode: '123-456',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('verify');
    expect(body.params).toEqual({
      account: '+15551234567',
      verificationCode: '123-456',
    });
  });

  it('resolves without returning a value', async () => {
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: null });

    const result = await verifyAccount(BASE_URL, {
      number: '+15551234567',
      verificationCode: '999-999',
    });

    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// getVersion
// ===========================================================================

describe('getVersion', () => {
  it('returns version string from response', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { version: '0.13.4' },
    });

    const version = await getVersion(BASE_URL);

    expect(version).toBe('0.13.4');
  });

  it('calls the version RPC method', async () => {
    mockFetchResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { version: '0.12.0' },
    });

    await getVersion(BASE_URL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('version');
    expect(body.params).toBeUndefined();
  });
});

// ===========================================================================
// healthCheck
// ===========================================================================

describe('healthCheck', () => {
  it('returns true when daemon responds OK', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await healthCheck(BASE_URL);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/check`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('returns false when daemon responds with non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await healthCheck(BASE_URL);

    expect(result).toBe(false);
  });

  it('returns false when daemon is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await healthCheck(BASE_URL);

    expect(result).toBe(false);
  });

  it('returns false on timeout', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    const result = await healthCheck(BASE_URL);

    expect(result).toBe(false);
  });
});

// ===========================================================================
// SignalRpcError
// ===========================================================================

describe('SignalRpcError', () => {
  it('creates error with correct properties', () => {
    const err = new SignalRpcError('Something went wrong', -32600, 'send');

    expect(err.message).toBe('Something went wrong');
    expect(err.code).toBe(-32600);
    expect(err.method).toBe('send');
  });

  it('has correct name property', () => {
    const err = new SignalRpcError('test', -1, 'test');

    expect(err.name).toBe('SignalRpcError');
  });

  it('is an instance of Error', () => {
    const err = new SignalRpcError('test', -1, 'test');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SignalRpcError);
  });

  describe('fromRpcError', () => {
    it('creates error with correct code, message, and method', () => {
      const rpcError = {
        code: -32601,
        message: 'Method not found',
        data: { detail: 'unknown method' },
      };

      const err = SignalRpcError.fromRpcError(rpcError, 'badMethod');

      expect(err).toBeInstanceOf(SignalRpcError);
      expect(err.code).toBe(-32601);
      expect(err.message).toBe('Method not found');
      expect(err.method).toBe('badMethod');
      expect(err.name).toBe('SignalRpcError');
    });

    it('creates error from minimal RPC error object', () => {
      const rpcError = { code: -32700, message: 'Parse error' };

      const err = SignalRpcError.fromRpcError(rpcError, 'send');

      expect(err.code).toBe(-32700);
      expect(err.message).toBe('Parse error');
      expect(err.method).toBe('send');
    });
  });
});

// ===========================================================================
// _resetRequestId
// ===========================================================================

describe('_resetRequestId', () => {
  it('resets the ID counter back to 1', async () => {
    // Make a few calls to increment the counter
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: 'a' });
    mockFetchResponse({ jsonrpc: '2.0', id: 2, result: 'b' });
    await signalRpcCall(BASE_URL, 'method1');
    await signalRpcCall(BASE_URL, 'method2');

    // Reset
    _resetRequestId();

    // Next call should use id: 1
    mockFetchResponse({ jsonrpc: '2.0', id: 1, result: 'c' });
    await signalRpcCall(BASE_URL, 'method3');

    const lastBody = JSON.parse(
      mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body
    );
    expect(lastBody.id).toBe(1);
  });
});
