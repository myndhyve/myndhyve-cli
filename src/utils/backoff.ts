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
  const exponential = initialDelayMs * 2 ** attempt;

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
 * Optionally accepts an AbortSignal for cancellation (e.g. during shutdown).
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
