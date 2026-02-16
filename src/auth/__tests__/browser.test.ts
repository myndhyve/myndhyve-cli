import { describe, it, expect, vi } from 'vitest';

// ── Mock the 'open' package before importing browser module ──────────────────

const mockOpen = vi.fn(() => Promise.resolve());

vi.mock('open', () => ({
  default: mockOpen,
}));

import { browserLogin } from '../browser.js';

// Helper: make HTTP request to localhost
async function httpRequest(
  port: number,
  path: string,
  options?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  }
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const response = await fetch(url, {
    method: options?.method || 'GET',
    headers: options?.headers,
    body: options?.body,
  });

  const body = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return { status: response.status, headers, body };
}

/** Extract the callback server port from the auth URL passed to open(). */
function extractPort(): number {
  const calls = mockOpen.mock.calls;
  const lastCall = calls[calls.length - 1] as unknown[];
  const authUrl = String(lastCall?.[0] ?? '');
  const match = authUrl.match(/port=(\d+)/);
  if (!match) throw new Error('Could not extract port from open() call');
  return parseInt(match[1], 10);
}

describe('browserLogin()', () => {
  it('resolves with credentials when POST callback is received', async () => {
    mockOpen.mockClear();
    const loginPromise = browserLogin();

    // Give the server time to start
    await new Promise((r) => setTimeout(r, 100));
    expect(mockOpen).toHaveBeenCalledOnce();

    const port = extractPort();

    // POST credentials to the callback endpoint
    const callbackData = {
      idToken: 'test-id-token',
      refreshToken: 'test-refresh-token',
      email: 'test@myndhyve.com',
      uid: 'uid-123',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      apiKey: 'AIzaTestKey',
    };

    const response = await httpRequest(port, '/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callbackData),
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('Authenticated');

    const result = await loginPromise;
    expect(result.credentials.email).toBe('test@myndhyve.com');
    expect(result.credentials.idToken).toBe('test-id-token');
    expect(result.firebaseApiKey).toBe('AIzaTestKey');
  });

  it('resolves with credentials when GET callback is received', async () => {
    mockOpen.mockClear();
    const loginPromise = browserLogin();
    await new Promise((r) => setTimeout(r, 100));

    const port = extractPort();
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const params = new URLSearchParams({
      idToken: 'get-id-token',
      refreshToken: 'get-refresh-token',
      email: 'get@myndhyve.com',
      uid: 'uid-get',
      expiresAt,
    });

    const response = await httpRequest(port, `/callback?${params.toString()}`);
    expect(response.status).toBe(200);

    const result = await loginPromise;
    expect(result.credentials.email).toBe('get@myndhyve.com');
    expect(result.credentials.idToken).toBe('get-id-token');
  });

  it('returns CORS headers restricted to myndhyve.com', async () => {
    mockOpen.mockClear();
    const loginPromise = browserLogin();
    await new Promise((r) => setTimeout(r, 100));

    const port = extractPort();

    // Health check should include CORS headers
    const response = await httpRequest(port, '/health');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://myndhyve.com');

    // Clean up by sending valid callback
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    await httpRequest(port, '/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: 'tok',
        refreshToken: 'ref',
        email: 'x@y.com',
        uid: 'u',
        expiresAt,
      }),
    });

    await loginPromise;
  });

  it('rejects when callback has error parameter', async () => {
    mockOpen.mockClear();
    const loginPromise = browserLogin();
    // Attach rejection handler immediately to prevent unhandled rejection warning.
    // The original promise still rejects, so rejects.toThrow works.
    loginPromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 100));

    const port = extractPort();

    const response = await httpRequest(port, '/callback?error=access_denied');
    expect(response.status).toBe(400);

    await expect(loginPromise).rejects.toThrow('Authentication failed: access_denied');
  });

  it('rejects when callback is missing required fields', async () => {
    mockOpen.mockClear();
    const loginPromise = browserLogin();
    loginPromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 100));

    const port = extractPort();

    const response = await httpRequest(port, '/callback?idToken=tok');
    expect(response.status).toBe(400);

    await expect(loginPromise).rejects.toThrow('Missing required callback fields');
  });
});
