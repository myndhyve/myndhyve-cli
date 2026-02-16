/**
 * MyndHyve CLI — Exponential Backoff
 *
 * Borrowed from OpenClaw's reconnection pattern with jitter.
 */

import type { ReconnectConfig } from '../config/types.js';

/**
 * Compute the next backoff delay with jitter.
 *
 * Uses exponential backoff: initialDelay * 2^attempt, capped at maxDelay.
 * Adds random jitter of 0-25% to prevent thundering herd.
 */
export function computeBackoff(config: ReconnectConfig, attempt: number): number {
  const { initialDelayMs, maxDelayMs } = config;

  // Exponential: initialDelay * 2^attempt
  const exponential = initialDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const capped = Math.min(exponential, maxDelayMs);

  // Add 0-25% random jitter
  const jitter = capped * Math.random() * 0.25;

  return Math.round(capped + jitter);
}

/**
 * Check if the maximum number of reconnection attempts has been reached.
 */
export function isMaxAttemptsReached(config: ReconnectConfig, attempt: number): boolean {
  return attempt >= config.maxAttempts;
}

/**
 * Sleep for the specified duration in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
