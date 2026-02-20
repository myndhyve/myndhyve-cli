import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── Mock dependencies BEFORE importing ───────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

vi.mock('../browser.js', () => ({
  browserLogin: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { browserLogin } from '../browser.js';
import {
  login,
  loginWithToken,
  logout,
  getToken,
  getAuthStatus,
  isAuthenticated,
  AuthError,
  _resetForTests,
} from '../index.js';
import type { Credentials } from '../credentials.js';

// ── Cast mocks ───────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;
const mockBrowserLogin = browserLogin as ReturnType<typeof vi.fn>;

// ── Test data ────────────────────────────────────────────────────────────────

const validCredentials: Credentials = {
  idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoiZGF2aWRAbXluZGh5dmUuY29tIiwiZXhwIjoxOTk5OTk5OTk5fQ.signature',
  refreshToken: 'AEu4IL3-refresh-token-abc',
  email: 'david@myndhyve.com',
  uid: 'user-123',
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  savedAt: new Date().toISOString(),
};

const expiredCredentials: Credentials = {
  ...validCredentials,
  expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
};

// ── Fetch mock ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Reset between tests ─────────────────────────────────────────────────────

const originalEnv = process.env;

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockUnlinkSync.mockReset();
  mockBrowserLogin.mockReset();
  mockFetch.mockReset();
  _resetForTests();

  // Clear MYNDHYVE_TOKEN env var
  process.env = { ...originalEnv };
  delete process.env.MYNDHYVE_TOKEN;
});

afterEach(() => {
  process.env = originalEnv;
});

// ============================================================================
// login()
// ============================================================================

describe('login()', () => {
  it('calls browserLogin and saves credentials', async () => {
    mockExistsSync.mockReturnValue(true); // CLI dir exists
    mockBrowserLogin.mockResolvedValue({
      credentials: validCredentials,
      firebaseApiKey: 'AIzaTestKey123',
    });

    const result = await login();

    expect(mockBrowserLogin).toHaveBeenCalledOnce();
    expect(result.email).toBe('david@myndhyve.com');
    // Credentials should be saved
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

// ============================================================================
// loginWithToken()
// ============================================================================

describe('loginWithToken()', () => {
  it('saves credentials from provided token', async () => {
    mockExistsSync.mockReturnValue(true);

    // Create a minimal JWT for testing
    const payload = { sub: 'user-456', email: 'ci@myndhyve.com', exp: 9999999999 };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `eyJhbGciOiJSUzI1NiJ9.${encodedPayload}.signature`;

    const result = await loginWithToken(token);

    expect(result.email).toBe('ci@myndhyve.com');
    expect(mockWriteFileSync).toHaveBeenCalled();

    // Verify saved credentials contain the token
    const savedContent = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(savedContent.idToken).toBe(token);
    expect(savedContent.email).toBe('ci@myndhyve.com');
    expect(savedContent.uid).toBe('user-456');
  });

  it('uses provided email/uid overrides', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await loginWithToken('some.token.here', {
      email: 'override@test.com',
      uid: 'custom-uid',
    });

    expect(result.email).toBe('override@test.com');
    const savedContent = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(savedContent.email).toBe('override@test.com');
    expect(savedContent.uid).toBe('custom-uid');
  });

  it('stores empty refresh token (token-only login cannot be refreshed)', async () => {
    mockExistsSync.mockReturnValue(true);

    // Minimal JWT with 3 parts
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', email: 'a@b.com', exp: 9999999999 })).toString('base64url');
    await loginWithToken(`header.${payload}.sig`);

    const savedContent = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(savedContent.refreshToken).toBe('');
  });

  it('rejects tokens that are not valid JWT format', async () => {
    // Not a JWT at all
    await expect(loginWithToken('not-a-jwt')).rejects.toThrow(AuthError);
    await expect(loginWithToken('not-a-jwt')).rejects.toThrow('Invalid token format');
  });

  it('rejects tokens with empty segments', async () => {
    // Missing signature segment
    await expect(loginWithToken('header.payload.')).rejects.toThrow(AuthError);
    await expect(loginWithToken('.payload.sig')).rejects.toThrow(AuthError);
  });
});

// ============================================================================
// logout()
// ============================================================================

describe('logout()', () => {
  it('clears credentials and API key files', () => {
    mockExistsSync.mockReturnValue(true);

    logout();

    // Should delete both credentials.json and .firebase-api-key
    expect(mockUnlinkSync).toHaveBeenCalled();
  });
});

// ============================================================================
// getToken()
// ============================================================================

describe('getToken()', () => {
  it('returns MYNDHYVE_TOKEN env var when set', async () => {
    process.env.MYNDHYVE_TOKEN = 'env-token-xyz';

    const token = await getToken();

    expect(token).toBe('env-token-xyz');
  });

  it('returns stored token when valid', async () => {
    // Mock: credentials file exists and is valid
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validCredentials));

    const token = await getToken();

    expect(token).toBe(validCredentials.idToken);
  });

  it('throws AuthError when not authenticated', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(getToken()).rejects.toThrow(AuthError);
    await expect(getToken()).rejects.toThrow('Not authenticated');
  });

  it('throws AuthError when token expired and no refresh possible', async () => {
    // No API key file, no refresh token
    const expiredNoRefresh: Credentials = {
      ...expiredCredentials,
      refreshToken: '',
    };

    mockExistsSync.mockImplementation((path: string) => {
      if ((path as string).endsWith('credentials.json')) return true;
      if ((path as string).endsWith('.firebase-api-key')) return false;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(expiredNoRefresh));

    await expect(getToken()).rejects.toThrow(AuthError);
    await expect(getToken()).rejects.toThrow(/expired/i);
  });

  it('env var takes priority over stored credentials', async () => {
    process.env.MYNDHYVE_TOKEN = 'env-token';

    // Also have stored credentials
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validCredentials));

    const token = await getToken();

    expect(token).toBe('env-token');
  });
});

// ============================================================================
// getToken() — forceRefresh
// ============================================================================

describe('getToken() — forceRefresh', () => {
  /** Helper: set up mocks so credentials load + API key exists + refresh succeeds. */
  function setupRefreshMocks(creds: Credentials = validCredentials): void {
    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('credentials.json')) return true;
      if (path.endsWith('.firebase-api-key')) return true;
      return true;
    });
    mockReadFileSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.firebase-api-key')) return 'AIzaTestKey';
      return JSON.stringify(creds);
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id_token: 'refreshed-id-token',
        refresh_token: 'new-refresh-token',
        expires_in: '3600',
      }),
    });
  }

  it('triggers refresh even when stored token is not expired', async () => {
    setupRefreshMocks(validCredentials); // Not expired

    const token = await getToken(true);

    expect(token).toBe('refreshed-id-token');
    expect(mockFetch).toHaveBeenCalledOnce();
    // Credentials should be saved with the new token
    expect(mockWriteFileSync).toHaveBeenCalled();
    const savedContent = JSON.parse(
      mockWriteFileSync.mock.calls.find(
        (c: string[]) => typeof c[0] === 'string' && c[0].endsWith('credentials.json')
      )?.[1] as string
    );
    expect(savedContent.idToken).toBe('refreshed-id-token');
  });

  it('deduplicates concurrent refresh calls — only one fetch fires', async () => {
    setupRefreshMocks(expiredCredentials);

    // Fire two concurrent getToken calls — both see expired token
    const [token1, token2] = await Promise.all([
      getToken(),
      getToken(),
    ]);

    expect(token1).toBe('refreshed-id-token');
    expect(token2).toBe('refreshed-id-token');

    // Only one actual refresh call made
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('clears refreshPromise after failure so next call can retry', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path.endsWith('credentials.json')) return true;
      if (path.endsWith('.firebase-api-key')) return true;
      return true;
    });
    mockReadFileSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.firebase-api-key')) return 'AIzaTestKey';
      return JSON.stringify(expiredCredentials);
    });

    // First attempt: refresh fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('TOKEN_EXPIRED'),
    });

    await expect(getToken()).rejects.toThrow(AuthError);

    // Second attempt: refresh succeeds (new fetch mock)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: '3600',
      }),
    });

    const token = await getToken();
    expect(token).toBe('new-token');

    // Two fetch calls total
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// getAuthStatus()
// ============================================================================

describe('getAuthStatus()', () => {
  it('returns source=env when MYNDHYVE_TOKEN is set', () => {
    process.env.MYNDHYVE_TOKEN = 'some-token';

    const status = getAuthStatus();

    expect(status.authenticated).toBe(true);
    expect(status.source).toBe('env');
  });

  it('returns source=none when not authenticated', () => {
    mockExistsSync.mockReturnValue(false);

    const status = getAuthStatus();

    expect(status.authenticated).toBe(false);
    expect(status.source).toBe('none');
  });

  it('returns credentials info when stored', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validCredentials));

    const status = getAuthStatus();

    expect(status.authenticated).toBe(true);
    expect(status.source).toBe('credentials');
    expect(status.email).toBe('david@myndhyve.com');
    expect(status.uid).toBe('user-123');
    expect(status.expired).toBe(false);
  });

  it('reports expired status for expired credentials', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(expiredCredentials));

    const status = getAuthStatus();

    expect(status.authenticated).toBe(true);
    expect(status.expired).toBe(true);
  });
});

// ============================================================================
// isAuthenticated()
// ============================================================================

describe('isAuthenticated()', () => {
  it('returns true when MYNDHYVE_TOKEN is set', () => {
    process.env.MYNDHYVE_TOKEN = 'token';

    expect(isAuthenticated()).toBe(true);
  });

  it('returns true when credentials file exists', () => {
    mockExistsSync.mockReturnValue(true);

    expect(isAuthenticated()).toBe(true);
  });

  it('returns false when no auth source available', () => {
    mockExistsSync.mockReturnValue(false);

    expect(isAuthenticated()).toBe(false);
  });
});

// ============================================================================
// AuthError
// ============================================================================

describe('AuthError', () => {
  it('has correct name and code', () => {
    const err = new AuthError('test message', 'TEST_CODE');

    expect(err.name).toBe('AuthError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err).toBeInstanceOf(Error);
  });
});
