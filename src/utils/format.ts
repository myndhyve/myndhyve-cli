/**
 * MyndHyve CLI — Formatting Utilities
 *
 * Shared formatting functions used across CLI commands and services.
 */

/**
 * Format the time elapsed since a given date as a human-readable string.
 *
 * Examples: "just now", "3 minutes", "2 hours", "5 days"
 */
export function formatTimeSince(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

/**
 * Format a duration in milliseconds as a human-readable "time until" string.
 *
 * Examples: "3 minutes", "2 hours"
 */
export function formatTimeUntil(futureDate: Date): string {
  const diffMs = futureDate.getTime() - Date.now();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}
