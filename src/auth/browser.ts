/**
 * MyndHyve CLI — Browser OAuth Flow
 *
 * Opens the MyndHyve web app for authentication and catches the callback
 * on a localhost HTTP server. The web app redirects with Firebase tokens
 * after the user authenticates.
 *
 * Flow:
 * 1. CLI starts an HTTP server on a random port (127.0.0.1 only)
 * 2. Opens browser to https://myndhyve.com/cli-auth?port={PORT}
 * 3. User authenticates in the browser (Google, email, etc.)
 * 4. Web app POSTs to http://localhost:{PORT}/callback with tokens
 * 5. CLI saves credentials and closes the server
 *
 * Security notes:
 * - The callback server only binds to 127.0.0.1 (localhost).
 * - POST is the preferred callback method (tokens in body, not URL).
 * - GET callbacks are supported for compatibility but tokens appear
 *   in the URL, which may be logged by the OS or browser history.
 * - CORS is restricted to the MyndHyve origin.
 * - POST body size is limited to 64 KB to prevent memory exhaustion.
 */

import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { createLogger } from '../utils/logger.js';
import type { Credentials } from './credentials.js';

const log = createLogger('BrowserAuth');

/** Base URL for the MyndHyve web app's CLI auth page. */
const AUTH_BASE_URL = 'https://myndhyve.com/cli-auth';

/** How long to wait for the browser callback before timing out. */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum POST body size in bytes (64 KB). */
const MAX_BODY_SIZE = 64 * 1024;

/** Allowed CORS origin for callback requests. */
const ALLOWED_ORIGIN = 'https://myndhyve.com';

// ============================================================================
// BROWSER LOGIN
// ============================================================================

export interface BrowserLoginResult {
  credentials: Credentials;
  /** Firebase API key for token refresh (public, safe to store). */
  firebaseApiKey?: string;
}

/**
 * Launch browser-based OAuth flow.
 *
 * Starts a local HTTP server, opens the browser, and waits for the
 * callback with auth tokens.
 */
export async function browserLogin(): Promise<BrowserLoginResult> {
  const { server, port } = await startCallbackServer();

  try {
    // Open browser to the MyndHyve auth page
    const authUrl = `${AUTH_BASE_URL}?port=${port}&callback=http://localhost:${port}/callback`;
    log.info('Opening browser for authentication', { url: authUrl });

    // Dynamic import of 'open' package (optional — may not be installed)
    let openBrowser: (url: string) => Promise<unknown>;
    try {
      const open = await import('open');
      openBrowser = open.default;
    } catch {
      // Fallback: try platform-specific commands
      const { exec } = await import('node:child_process');
      const { platform } = await import('node:os');
      const os = platform();
      openBrowser = (url: string) =>
        new Promise((resolve, reject) => {
          const cmd =
            os === 'darwin'
              ? `open "${url}"`
              : os === 'win32'
                ? `start "" "${url}"`
                : `xdg-open "${url}"`;
          exec(cmd, (err) => (err ? reject(err) : resolve(undefined)));
        });
    }

    await openBrowser(authUrl);

    // Wait for the callback
    const result = await waitForCallback(server, port);
    return result;
  } finally {
    closeServer(server);
  }
}

// ============================================================================
// CALLBACK SERVER
// ============================================================================

interface ServerInfo {
  server: Server;
  port: number;
}

function startCallbackServer(): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    // Listen on random port, localhost only
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      const port = address.port;
      log.debug('Callback server started', { port });
      resolve({ server, port });
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });
}

function waitForCallback(server: Server, port: number): Promise<BrowserLoginResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Authentication timed out. Please try again.'));
    }, AUTH_TIMEOUT_MS);

    server.on('request', (req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        // Handle both GET (query params) and POST (JSON body)
        if (req.method === 'GET') {
          clearTimeout(timeout);
          handleCallbackParams(url.searchParams, res, resolve, reject);
        } else if (req.method === 'POST') {
          let body = '';
          let bodySize = 0;
          let aborted = false;

          req.on('data', (chunk: Buffer) => {
            bodySize += chunk.length;
            if (bodySize > MAX_BODY_SIZE) {
              aborted = true;
              req.destroy();
              clearTimeout(timeout);
              sendError(res, 'Request body too large');
              reject(new Error('Callback POST body exceeded size limit'));
              return;
            }
            body += chunk;
          });

          req.on('end', () => {
            if (aborted) return;
            clearTimeout(timeout);
            try {
              const params = new URLSearchParams();
              const data = JSON.parse(body);
              for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                  params.set(key, value);
                }
              }
              handleCallbackParams(params, res, resolve, reject);
            } catch {
              sendError(res, 'Invalid callback data');
              reject(new Error('Received invalid callback data from browser'));
            }
          });
        } else {
          sendError(res, 'Method not allowed');
        }
      } else if (url.pathname === '/health') {
        // Health check endpoint for the web app to verify CLI is listening
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...corsHeaders(),
        });
        res.end(JSON.stringify({ ok: true, version: '1.0' }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
  });
}

function handleCallbackParams(
  params: URLSearchParams,
  res: import('node:http').ServerResponse,
  resolve: (result: BrowserLoginResult) => void,
  reject: (error: Error) => void
): void {
  const idToken = params.get('idToken');
  const refreshToken = params.get('refreshToken');
  const email = params.get('email');
  const uid = params.get('uid');
  const expiresAt = params.get('expiresAt');
  const error = params.get('error');

  if (error) {
    sendError(res, 'Authentication failed');
    reject(new Error(`Authentication failed: ${error}`));
    return;
  }

  if (!idToken || !refreshToken || !email || !uid || !expiresAt) {
    const missing = [
      !idToken && 'idToken',
      !refreshToken && 'refreshToken',
      !email && 'email',
      !uid && 'uid',
      !expiresAt && 'expiresAt',
    ].filter(Boolean);
    sendError(res, 'Missing required fields');
    reject(new Error(`Missing required callback fields: ${missing.join(', ')}`));
    return;
  }

  const now = new Date().toISOString();
  const credentials = {
    idToken,
    refreshToken,
    email,
    uid,
    expiresAt,
    savedAt: now,
  };

  const firebaseApiKey = params.get('apiKey') || undefined;

  // Send success page to browser
  sendSuccess(res, email);

  log.info('Authentication successful', { email });
  resolve({ credentials, firebaseApiKey });
}

// ============================================================================
// CORS & RESPONSE HELPERS
// ============================================================================

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendSuccess(res: import('node:http').ServerResponse, email: string): void {
  const html = `<!DOCTYPE html>
<html>
<head>
<title>MyndHyve CLI - Authenticated</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f0f23; color: #e2e8f0; }
  .subtitle { color: #94a3b8; }
  .hint { color: #64748b; font-size: 0.875rem; margin-top: 1.5rem; }
  @media (prefers-color-scheme: light) {
    body { background: #f8fafc; color: #1e293b; }
    .subtitle { color: #475569; }
    .hint { color: #94a3b8; }
  }
</style>
</head>
<body>
  <div style="text-align: center; max-width: 400px; padding: 2rem;">
    <div style="font-size: 3rem; margin-bottom: 1rem;">&#10003;</div>
    <h1 style="margin: 0 0 0.5rem; font-size: 1.5rem;">Authenticated!</h1>
    <p class="subtitle">Logged in as <strong>${escapeHtml(email)}</strong></p>
    <p class="hint">You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html',
    ...corsHeaders(),
  });
  res.end(html);
}

function sendError(res: import('node:http').ServerResponse, message: string): void {
  const html = `<!DOCTYPE html>
<html>
<head>
<title>MyndHyve CLI - Error</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f0f23; color: #e2e8f0; }
  .error-msg { color: #f87171; }
  .hint { color: #64748b; font-size: 0.875rem; margin-top: 1.5rem; }
  @media (prefers-color-scheme: light) {
    body { background: #f8fafc; color: #1e293b; }
    .error-msg { color: #dc2626; }
    .hint { color: #94a3b8; }
  }
</style>
</head>
<body>
  <div style="text-align: center; max-width: 400px; padding: 2rem;">
    <div style="font-size: 3rem; margin-bottom: 1rem;">&#10007;</div>
    <h1 style="margin: 0 0 0.5rem; font-size: 1.5rem;">Authentication Failed</h1>
    <p class="error-msg">${escapeHtml(message)}</p>
    <p class="hint">Please try again in the terminal.</p>
  </div>
</body>
</html>`;

  res.writeHead(400, {
    'Content-Type': 'text/html',
    ...corsHeaders(),
  });
  res.end(html);
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[ch] || ch;
  });
}

function closeServer(server: Server): void {
  try {
    server.close();
    server.closeAllConnections();
  } catch {
    // Server already closed
  }
}
