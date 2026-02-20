/**
 * MyndHyve CLI — Shared CLI Helpers
 *
 * Common utilities used across CLI command files.
 */

import { getAuthStatus } from '../auth/index.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

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
    printErrorResult({
      code: 'NOT_AUTHENTICATED',
      message: 'Not authenticated.',
      suggestion: 'Run `myndhyve-cli auth login` to sign in, or set the MYNDHYVE_TOKEN environment variable for CI/CD.',
    });
    process.exitCode = ExitCode.UNAUTHORIZED;
    return null;
  }

  if (!status.uid) {
    printErrorResult({
      code: 'MISSING_UID',
      message: 'User ID not available.',
      suggestion: 'Run `myndhyve-cli auth login` to refresh your session.',
    });
    process.exitCode = ExitCode.UNAUTHORIZED;
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
  printErrorResult({
    code: 'COMMAND_ERROR',
    message: `${context}: ${message}`,
  });
  process.exitCode = ExitCode.GENERAL_ERROR;
}

// ============================================================================
// TABLE FORMATTING
// ============================================================================

/**
 * Get the available terminal width for table output.
 * Falls back to 80 columns if detection fails.
 */
export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Format a fixed-width table row that fits within the terminal width.
 * Each column is defined by [value, width]. Columns are truncated
 * proportionally when the total exceeds the terminal width.
 */
export function formatTableRow(
  columns: Array<[string, number]>,
  indent = 2
): string {
  const termWidth = getTerminalWidth();
  const totalWidth = columns.reduce((sum, [, w]) => sum + w, 0) + indent;

  let row = ' '.repeat(indent);

  if (totalWidth <= termWidth) {
    // Fits — use original widths
    for (const [value, width] of columns) {
      row += truncate(value, width - 2).padEnd(width);
    }
  } else {
    // Doesn't fit — shrink columns proportionally
    const available = termWidth - indent;
    const scale = available / totalWidth;

    for (const [value, width] of columns) {
      const scaled = Math.max(4, Math.floor(width * scale));
      row += truncate(value, scaled - 2).padEnd(scaled);
    }
  }

  return row;
}

// ============================================================================
// DID-YOU-MEAN
// ============================================================================

/**
 * Simple Levenshtein distance for "did you mean?" suggestions.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Find the closest match from a list of candidates.
 * Returns the candidate if the distance is <= maxDistance, otherwise undefined.
 */
export function didYouMean(
  input: string,
  candidates: string[],
  maxDistance = 3
): string | undefined {
  let best: string | undefined;
  let bestDist = maxDistance + 1;

  for (const candidate of candidates) {
    const dist = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  return bestDist <= maxDistance ? best : undefined;
}
