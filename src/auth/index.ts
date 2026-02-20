/**
 * MyndHyve CLI — Authentication Service
 *
 * Manages Firebase authentication for the CLI. Supports:
 * - Interactive browser-based OAuth login
 * - Direct token login (for CI/CD pipelines)
 * - MYNDHYVE_TOKEN environment variable override
 * - Automatic token refresh when expired
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../utils/logger.js';
import { formatTimeSince } from '../utils/format.js';
import { getCliDir, ensureCliDir } from '../config/loader.js';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  hasCredentials,
  isExpired,
  type Credentials,
} from './credentials.js';
import { browserLogin } from './browser.js';

const log = createLogger('Auth');

// ============================================================================
// TOKEN REFRESH
// ============================================================================

/**
 * In-memory cache of the Firebase API key for token refresh.
 *
 * This module-level variable avoids re-reading the API key file on every
 * `getToken()` call during a single CLI session. It is populated when:
 * - `login()` receives the key from the browser callback
 * - `getToken()` calls `loadApiKey()` for the first time
 *
 * Singleton state is acceptable here because the CLI runs as a short-lived
 * process (not a long-running server). Tests that exercise refresh should
 * call `_resetForTests()` in beforeEach.
 */
let cachedApiKey: string | undefined;

/**
 * In-flight refresh promise for deduplication.
 *
 * When multiple async API calls fire simultaneously while the token is
 * expired, each would independently call refreshIdToken(). This promise
 * ensures only one refresh is in-flight at a time — subsequent callers
 * await the same promise instead of starting a second refresh.
 */
let refreshPromise: Promise<string> | undefined;

/**
 * Refresh an expired ID token using the Firebase Auth REST API.
 * Requires the Firebase API key (public, safe to store/embed).
 *
 * @see https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
 */
async function refreshIdToken(
  refreshToken: string,
  apiKey: string
): Promise<{ idToken: string; refreshToken: string; expiresIn: number }> {
  const url = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error?.message || parsed.error || errorBody;
    } catch {
      errorMessage = errorBody || `HTTP ${response.status}`;
    }
    throw new AuthError(
      `Token refresh failed: ${errorMessage}`,
      'REFRESH_FAILED'
    );
  }

  const data = (await response.json()) as {
    id_token: string;
    refresh_token: string;
    expires_in: string;
  };
  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresIn: parseInt(data.expires_in, 10),
  };
}

// ============================================================================
// AUTH SERVICE
// ============================================================================

/**
 * Login via interactive browser OAuth.
 * Opens the default browser and waits for the auth callback.
 */
export async function login(): Promise<{ email: string }> {
  log.info('Starting browser login flow');

  const result = await browserLogin();

  // Save credentials
  saveCredentials(result.credentials);

  // Store API key for future refresh
  if (result.firebaseApiKey) {
    cachedApiKey = result.firebaseApiKey;
    saveApiKey(result.firebaseApiKey);
  }

  log.info('Login successful', { email: result.credentials.email });
  return { email: result.credentials.email };
}

/**
 * Login with a direct Firebase ID token (for CI/CD, scripts).
 *
 * Since we don't have the full auth context, the token cannot be refreshed.
 * The caller should provide a fresh token for each CI run.
 *
 * @throws {AuthError} if the token does not look like a valid JWT
 */
export async function loginWithToken(
  idToken: string,
  options?: { email?: string; uid?: string }
): Promise<{ email: string }> {
  // Basic JWT format validation (header.payload.signature)
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new AuthError(
      'Invalid token format. Expected a JWT (header.payload.signature).',
      'INVALID_TOKEN'
    );
  }

  // Decode token to extract basic claims (without verification)
  const claims = decodeIdToken(idToken);
  const email = options?.email || claims?.email || 'cli-user@myndhyve.com';
  const uid = options?.uid || claims?.sub || 'unknown';

  // Firebase ID tokens expire after 1 hour
  const expiresAt = claims?.exp
    ? new Date(claims.exp * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();

  const credentials: Credentials = {
    idToken,
    refreshToken: '', // Token-only login cannot be refreshed
    email,
    uid,
    expiresAt,
    savedAt: new Date().toISOString(),
  };

  saveCredentials(credentials);
  log.info('Token login successful', { email });
  return { email };
}

/**
 * Logout — clear all stored credentials.
 */
export function logout(): void {
  clearCredentials();
  clearApiKey();
  cachedApiKey = undefined;
  log.info('Logged out');
}

/**
 * Get a valid authentication token.
 *
 * Priority:
 * 1. MYNDHYVE_TOKEN environment variable (always wins)
 * 2. Stored credentials (refreshed if expired)
 *
 * @param forceRefresh - Force a token refresh even if the stored token
 *   appears valid. Used by the API client when a request returns 401
 *   (token revoked server-side but not yet expired by timestamp).
 * @throws {AuthError} if not authenticated or refresh fails
 */
export async function getToken(forceRefresh = false): Promise<string> {
  // Check environment variable first
  const envToken = process.env.MYNDHYVE_TOKEN;
  if (envToken) {
    log.debug('Using MYNDHYVE_TOKEN from environment');
    return envToken;
  }

  // Load stored credentials
  const creds = loadCredentials();
  if (!creds) {
    throw new AuthError(
      'Not authenticated. Run `myndhyve-cli auth login` to sign in.',
      'NOT_AUTHENTICATED'
    );
  }

  // Check if token is expired or force refresh requested
  if (forceRefresh || isExpired(creds)) {
    log.debug(forceRefresh ? 'Forced token refresh requested' : 'Token expired, attempting refresh');

    // Deduplicate concurrent refresh calls — only one in-flight at a time
    if (!refreshPromise) {
      refreshPromise = performTokenRefresh(creds).finally(() => {
        refreshPromise = undefined;
      });
    }
    return refreshPromise;
  }

  return creds.idToken;
}

/**
 * Perform token refresh. Extracted to enable deduplication via refreshPromise.
 */
async function performTokenRefresh(creds: Credentials): Promise<string> {
  if (creds.refreshToken) {
    const apiKey = cachedApiKey || loadApiKey();
    if (apiKey) {
      try {
        const refreshed = await refreshIdToken(creds.refreshToken, apiKey);

        const expiresAt = new Date(
          Date.now() + refreshed.expiresIn * 1000
        ).toISOString();

        const updatedCreds: Credentials = {
          ...creds,
          idToken: refreshed.idToken,
          refreshToken: refreshed.refreshToken,
          expiresAt,
          savedAt: new Date().toISOString(),
        };

        saveCredentials(updatedCreds);
        log.info('Token refreshed successfully');
        return refreshed.idToken;
      } catch (err) {
        log.warn('Token refresh failed', {
          reason: err instanceof Error ? err.message : 'unknown',
        });
        throw new AuthError(
          'Session expired and refresh failed. Run `myndhyve-cli auth login` to sign in again.',
          'REFRESH_FAILED'
        );
      }
    }
  }

  // No refresh token or no API key — require re-login
  const expiredAgo = formatTimeSince(new Date(creds.expiresAt));
  throw new AuthError(
    `Token expired ${expiredAgo} ago. Run \`myndhyve-cli auth login\` to refresh.`,
    'TOKEN_EXPIRED'
  );
}

// ============================================================================
// AUTH STATUS
// ============================================================================

export interface AuthStatus {
  authenticated: boolean;
  email?: string;
  uid?: string;
  expiresAt?: string;
  expired?: boolean;
  source: 'env' | 'credentials' | 'none';
}

export function getAuthStatus(): AuthStatus {
  // Check env variable
  if (process.env.MYNDHYVE_TOKEN) {
    return {
      authenticated: true,
      source: 'env',
    };
  }

  // Check stored credentials
  const creds = loadCredentials();
  if (!creds) {
    return {
      authenticated: false,
      source: 'none',
    };
  }

  return {
    authenticated: true,
    email: creds.email,
    uid: creds.uid,
    expiresAt: creds.expiresAt,
    expired: isExpired(creds),
    source: 'credentials',
  };
}

/**
 * Check if the user is authenticated (any method).
 */
export function isAuthenticated(): boolean {
  if (process.env.MYNDHYVE_TOKEN) return true;
  return hasCredentials();
}

// ============================================================================
// API KEY PERSISTENCE
// ============================================================================

function getApiKeyPath(): string {
  return join(getCliDir(), '.firebase-api-key');
}

function saveApiKey(apiKey: string): void {
  ensureCliDir();
  writeFileSync(getApiKeyPath(), apiKey, { mode: 0o600 });
}

function loadApiKey(): string | undefined {
  const path = getApiKeyPath();
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return undefined;
  }
}

function clearApiKey(): void {
  const path = getApiKeyPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

// ============================================================================
// TOKEN DECODING
// ============================================================================

/**
 * Decode a JWT ID token without verification.
 * Used only to extract claims like email and expiry.
 * NOT for security — the server verifies tokens.
 */
function decodeIdToken(
  token: string
): { email?: string; sub?: string; exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(payload);

    // Validate that parsed result is an object
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    return {
      email: typeof obj.email === 'string' ? obj.email : undefined,
      sub: typeof obj.sub === 'string' ? obj.sub : undefined,
      exp: typeof obj.exp === 'number' ? obj.exp : undefined,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Reset module-level state for test isolation.
 * Only call from test files — not for production use.
 */
export function _resetForTests(): void {
  cachedApiKey = undefined;
  refreshPromise = undefined;
}

// ============================================================================
// ERROR
// ============================================================================

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
