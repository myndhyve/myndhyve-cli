import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock auth module ─────────────────────────────────────────────────────────

vi.mock('../../auth/index.js', () => ({
  getToken: vi.fn(),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
    }
  },
}));

import { getToken } from '../../auth/index.js';
import { MyndHyveClient, APIClientError, getAPIClient, _resetAPIClientForTests } from '../client.js';

const mockGetToken = getToken as ReturnType<typeof vi.fn>;

// ── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetToken.mockReset();
  mockFetch.mockReset();
  mockGetToken.mockResolvedValue('test-id-token');
  _resetAPIClientForTests();
});

// ============================================================================
// MyndHyveClient - Basic HTTP Methods
// ============================================================================

describe('MyndHyveClient', () => {
  let client: MyndHyveClient;

  beforeEach(() => {
    client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });
  });

  describe('get()', () => {
    it('sends GET request with auth header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ items: [1, 2, 3] }),
      });

      const result = await client.get<{ items: number[] }>('/hyveApi/workflows');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.test.com/hyveApi/workflows');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer test-id-token');
      expect(result.items).toEqual([1, 2, 3]);
    });

    it('appends query parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ results: [] }),
      });

      await client.get('/hyveApi/search', { q: 'test', limit: '10' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('?q=test&limit=10');
    });
  });

  describe('post()', () => {
    it('sends POST request with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ id: 'new-123' }),
      });

      const result = await client.post<{ id: string }>('/hyveApi/projects', {
        name: 'Test Project',
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ name: 'Test Project' });
      expect(result.id).toBe('new-123');
    });
  });

  describe('put()', () => {
    it('sends PUT request with JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ updated: true }),
      });

      await client.put('/hyveApi/projects/123', { name: 'Updated' });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('PUT');
    });
  });

  describe('delete()', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers({}),
      });

      await client.delete('/hyveApi/projects/123');

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('DELETE');
    });
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('Error Handling', () => {
  let client: MyndHyveClient;

  beforeEach(() => {
    client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });
  });

  it('throws APIClientError for non-OK responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({ error: 'Internal server error' })),
    });

    await expect(client.get('/failing')).rejects.toThrow(APIClientError);
    await expect(client.get('/failing')).rejects.toThrow(/Internal server error/);
  });

  it('throws specific error for 401 Unauthorized', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    try {
      await client.get('/protected');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      expect((err as APIClientError).code).toBe('UNAUTHORIZED');
      expect((err as APIClientError).statusCode).toBe(401);
    }
  });

  it('throws specific error for 403 Forbidden', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({ error: 'Insufficient permissions' })),
    });

    try {
      await client.get('/admin');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      expect((err as APIClientError).code).toBe('FORBIDDEN');
    }
  });

  it('throws NETWORK_ERROR on fetch failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      await client.get('/unreachable');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      expect((err as APIClientError).code).toBe('NETWORK_ERROR');
    }
  });

  it('handles non-JSON error responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('Bad Gateway'),
    });

    await expect(client.get('/gateway')).rejects.toThrow(/Bad Gateway/);
  });

  it('handles text() failure in error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('read failed')),
    });

    await expect(client.get('/failing')).rejects.toThrow(APIClientError);
  });
});

// ============================================================================
// Auth Token Injection
// ============================================================================

describe('Auth Token Injection', () => {
  it('calls getToken for each request', async () => {
    const client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await client.get('/first');
    await client.get('/second');

    expect(mockGetToken).toHaveBeenCalledTimes(2);
  });

  it('uses refreshed token on subsequent calls', async () => {
    const client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });

    mockGetToken.mockResolvedValueOnce('token-v1');
    mockGetToken.mockResolvedValueOnce('token-v2');

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await client.get('/first');
    await client.get('/second');

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-v1');
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer token-v2');
  });

  it('propagates auth errors without wrapping', async () => {
    const { AuthError } = await import('../../auth/index.js');
    mockGetToken.mockRejectedValue(new AuthError('Not authenticated', 'NOT_AUTHENTICATED'));

    const client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });

    await expect(client.get('/protected')).rejects.toThrow('Not authenticated');
  });
});

// ============================================================================
// URL Building
// ============================================================================

describe('URL Building', () => {
  it('handles paths with leading slash', async () => {
    const client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await client.get('/hyveApi/test');

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/hyveApi/test');
  });

  it('handles paths without leading slash', async () => {
    const client = new MyndHyveClient({ baseUrl: 'https://api.test.com' });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await client.get('hyveApi/test');

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/hyveApi/test');
  });

  it('strips trailing slash from base URL', async () => {
    const client = new MyndHyveClient({ baseUrl: 'https://api.test.com/' });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await client.get('/path');

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/path');
  });
});

// ============================================================================
// getAPIClient() Singleton
// ============================================================================

describe('getAPIClient()', () => {
  it('returns a MyndHyveClient instance', () => {
    const client = getAPIClient();
    expect(client).toBeInstanceOf(MyndHyveClient);
  });

  it('returns the same instance on subsequent calls', () => {
    const client1 = getAPIClient();
    const client2 = getAPIClient();
    expect(client1).toBe(client2);
  });

  it('creates a new instance when config is provided', () => {
    const client1 = getAPIClient();
    const client2 = getAPIClient({ baseUrl: 'https://custom.api.com' });
    expect(client1).not.toBe(client2);
  });
});

// ============================================================================
// APIClientError
// ============================================================================

describe('APIClientError', () => {
  it('has correct name, code, and statusCode', () => {
    const err = new APIClientError('test error', 'TEST', 404);

    expect(err.name).toBe('APIClientError');
    expect(err.code).toBe('TEST');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('test error');
    expect(err).toBeInstanceOf(Error);
  });

  it('statusCode is optional', () => {
    const err = new APIClientError('network error', 'NETWORK_ERROR');

    expect(err.statusCode).toBeUndefined();
  });
});
