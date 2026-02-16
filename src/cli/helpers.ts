/**
 * MyndHyve CLI — Shared CLI Helpers
 *
 * Common utilities used across CLI command files.
 */

import { getAuthStatus } from '../auth/index.js';

// ============================================================================
// AUTH
// ============================================================================

/**
 * Require authentication and return user info.
 * Prints an error and sets exitCode if not authenticated.
 */
export function requireAuth(): { uid: string; email: string } | null {
  const status = getAuthStatus();

  if (!status.authenticated) {
    console.error('\n  Error: Not authenticated. Run `myndhyve-cli auth login` first.\n');
    process.exitCode = 1;
    return null;
  }

  if (!status.uid) {
    console.error('\n  Error: User ID not available. Run `myndhyve-cli auth login` to refresh.\n');
    process.exitCode = 1;
    return null;
  }

  return { uid: status.uid, email: status.email || 'unknown' };
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Truncate a string to a maximum length, appending an ellipsis if needed.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

/**
 * Format an ISO date string as a human-readable relative time.
 */
export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return 'just now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// ============================================================================
// ERROR OUTPUT
// ============================================================================

/**
 * Print a structured error message and set process exit code.
 */
export function printError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  Error: ${context}`);
  console.error(`  ${message}\n`);
  process.exitCode = 1;
}
