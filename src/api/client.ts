/**
 * MyndHyve CLI — Authenticated API Client
 *
 * HTTP client for MyndHyve Cloud APIs. Uses Firebase ID tokens for
 * authentication (same as the web app). Follows the same error handling
 * pattern as RelayClient but with auto-injected auth headers.
 */

import { getToken, AuthError } from '../auth/index.js';
import { createLogger } from '../utils/logger.js';

const _log = createLogger('MyndHyveClient');

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_BASE_URL = 'https://us-central1-myndhyve.cloudfunctions.net';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface MyndHyveClientConfig {
  /** Base URL for Cloud Functions (without trailing slash). */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

// ============================================================================
// CLIENT
// ============================================================================

export class MyndHyveClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: MyndHyveClientConfig) {
    this.baseUrl = (config?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = config?.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  // ── HTTP Methods ──────────────────────────────────────────────────────────

  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    let url = this.buildUrl(path);
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(this.buildUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(this.buildUrl(path), { method: 'DELETE' });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private buildUrl(path: string): string {
    // Support both absolute paths (/aiProxy/stream) and function names (aiProxy)
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /**
   * @param isRetry - If true, this is a retry after a 401 with a force-refreshed
   *   token. Prevents infinite retry loops: a second 401 throws immediately.
   */
  private async request<T>(url: string, init: RequestInit, isRetry = false): Promise<T> {
    // Get auth token — on retry, force-refresh to get a new token
    let token: string;
    try {
      token = await getToken(isRetry);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new APIClientError(
        'Failed to get authentication token',
        'AUTH_ERROR'
      );
    }

    // Merge auth header with existing headers
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let errorMessage: string;
        try {
          const parsed = JSON.parse(errorBody);
          errorMessage = parsed.error || parsed.message || errorBody;
        } catch {
          errorMessage = errorBody || `HTTP ${response.status}`;
        }

        // On 401, retry once with a force-refreshed token.
        // Handles tokens that were revoked server-side but appear
        // valid locally (not expired by timestamp).
        if (response.status === 401 && !isRetry) {
          _log.debug('Received 401, retrying with refreshed token');
          return this.request<T>(url, init, true);
        }

        if (response.status === 401) {
          throw new APIClientError(
            'Authentication expired. Run `myndhyve-cli auth login` to sign in again.',
            'UNAUTHORIZED',
            401
          );
        }

        if (response.status === 403) {
          throw new APIClientError(
            `Permission denied: ${errorMessage}`,
            'FORBIDDEN',
            403
          );
        }

        throw new APIClientError(
          `API error (${response.status}): ${errorMessage}`,
          'API_ERROR',
          response.status
        );
      }

      // Handle empty responses (204, etc.)
      const contentType = response.headers.get('content-type');
      if (
        response.status === 204 ||
        !contentType?.includes('application/json')
      ) {
        return {} as T;
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof APIClientError || error instanceof AuthError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new APIClientError('Request timed out', 'TIMEOUT');
      }

      throw new APIClientError(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
        'NETWORK_ERROR'
      );
    }
  }
}

// ============================================================================
// ERROR
// ============================================================================

export class APIClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'APIClientError';
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultClient: MyndHyveClient | undefined;

/**
 * Get or create the default MyndHyveClient instance.
 *
 * When called without arguments, returns the existing singleton (creating one
 * with defaults if needed). When called with a config, always creates a new
 * instance and replaces the singleton.
 *
 * @example
 * ```typescript
 * // Use default Cloud Functions URL
 * const client = getAPIClient();
 * const data = await client.get('/hyveApi/workflows');
 *
 * // Override base URL (e.g., for local emulator)
 * const devClient = getAPIClient({ baseUrl: 'http://localhost:5001' });
 * ```
 */
export function getAPIClient(config?: MyndHyveClientConfig): MyndHyveClient {
  if (!defaultClient || config) {
    defaultClient = new MyndHyveClient(config);
  }
  return defaultClient;
}

/**
 * Reset the singleton client. For test isolation only.
 */
export function _resetAPIClientForTests(): void {
  defaultClient = undefined;
}
