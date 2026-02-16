/**
 * MyndHyve CLI — Credential Storage
 *
 * Securely stores Firebase auth credentials at ~/.myndhyve-cli/credentials.json.
 * File permissions are restricted to owner-only (0o600).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getCliDir, ensureCliDir } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Credentials');

// ============================================================================
// SCHEMA
// ============================================================================

export const CredentialsSchema = z.object({
  /** Firebase ID token for API authentication. */
  idToken: z.string().min(1),
  /** Firebase refresh token for obtaining new ID tokens. Empty when using token-only login. */
  refreshToken: z.string(),
  /** User email address. */
  email: z.string().email(),
  /** Firebase user UID. */
  uid: z.string().min(1),
  /** Token expiration timestamp (ISO 8601). */
  expiresAt: z.string().datetime(),
  /** When credentials were last saved. */
  savedAt: z.string().datetime(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

// ============================================================================
// PATHS
// ============================================================================

export function getCredentialsPath(): string {
  return join(getCliDir(), 'credentials.json');
}

// ============================================================================
// LOAD / SAVE / CLEAR
// ============================================================================

/**
 * Load stored credentials from disk.
 * Returns null if no credentials exist or they're invalid.
 */
export function loadCredentials(): Credentials | null {
  const credPath = getCredentialsPath();

  if (!existsSync(credPath)) {
    return null;
  }

  try {
    const raw = readFileSync(credPath, 'utf-8');
    const json = JSON.parse(raw);
    return CredentialsSchema.parse(json);
  } catch (error) {
    log.warn('Failed to load credentials', {
      reason: error instanceof Error ? error.message : 'parse error',
    });
    return null;
  }
}

/**
 * Save credentials to disk with restricted permissions.
 */
export function saveCredentials(credentials: Credentials): void {
  ensureCliDir();
  const credPath = getCredentialsPath();

  const validated = CredentialsSchema.parse(credentials);
  writeFileSync(credPath, JSON.stringify(validated, null, 2), { mode: 0o600 });
  log.debug('Credentials saved', { email: validated.email });
}

/**
 * Remove stored credentials from disk.
 */
export function clearCredentials(): void {
  const credPath = getCredentialsPath();

  if (existsSync(credPath)) {
    unlinkSync(credPath);
    log.debug('Credentials cleared');
  }
}

/**
 * Check if credentials exist on disk (does not validate expiry).
 */
export function hasCredentials(): boolean {
  return existsSync(getCredentialsPath());
}

/**
 * Check if stored credentials have expired.
 */
export function isExpired(credentials: Credentials): boolean {
  const expiresAt = new Date(credentials.expiresAt).getTime();
  // Consider expired 5 minutes before actual expiry for safety margin
  return Date.now() >= expiresAt - 5 * 60 * 1000;
}
