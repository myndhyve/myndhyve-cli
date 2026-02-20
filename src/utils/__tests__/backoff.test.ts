import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeBackoff, isMaxAttemptsReached, sleep } from '../backoff.js';
import type { ReconnectConfig } from '../../config/types.js';

/**
 * Default reconnect config for tests.
 */
function makeConfig(overrides?: Partial<ReconnectConfig>): ReconnectConfig {
  return {
    maxAttempts: 10,
    initialDelayMs: 1_000,
    maxDelayMs: 300_000,
    watchdogTimeoutMs: 30 * 60 * 1000,
    ...overrides,
  };
}

describe('computeBackoff', () => {
  it('returns initialDelay * 2^attempt', () => {
    // Lock jitter to 0 so we get the exact exponential value
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const config = makeConfig({ initialDelayMs: 1_000 });

    expect(computeBackoff(config, 0)).toBe(1_000);  // 1000 * 2^0 = 1000
    expect(computeBackoff(config, 1)).toBe(2_000);  // 1000 * 2^1 = 2000
    expect(computeBackoff(config, 2)).toBe(4_000);  // 1000 * 2^2 = 4000
    expect(computeBackoff(config, 3)).toBe(8_000);  // 1000 * 2^3 = 8000
    expect(computeBackoff(config, 4)).toBe(16_000); // 1000 * 2^4 = 16000

    vi.restoreAllMocks();
  });

  it('caps at maxDelay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const config = makeConfig({ initialDelayMs: 1_000, maxDelayMs: 10_000 });

    // 1000 * 2^10 = 1,024,000 which should be capped at 10,000
    expect(computeBackoff(config, 10)).toBe(10_000);
    // 1000 * 2^5 = 32,000 -> capped at 10,000
    expect(computeBackoff(config, 5)).toBe(10_000);

    vi.restoreAllMocks();
  });

  it('adds 0-25% random jitter (result >= base, result <= base * 1.25)', () => {
    const config = makeConfig({ initialDelayMs: 1_000, maxDelayMs: 300_000 });
    const attempt = 3;
    const base = 1_000 * 2 ** attempt; // 8000

    // Run many samples to verify jitter range
    const results: number[] = [];
    for (let i = 0; i < 200; i++) {
      results.push(computeBackoff(config, attempt));
    }

    for (const result of results) {
      expect(result).toBeGreaterThanOrEqual(base);
      expect(result).toBeLessThanOrEqual(Math.round(base * 1.25));
    }
  });

  it('with jitter at maximum (Math.random = 1), adds exactly 25%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const config = makeConfig({ initialDelayMs: 1_000 });
    // 1000 * 2^2 = 4000, jitter = 4000 * 1 * 0.25 = 1000
    // total = 4000 + 1000 = 5000
    expect(computeBackoff(config, 2)).toBe(5_000);

    vi.restoreAllMocks();
  });

  it('handles attempt=0 (returns ~initialDelay)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const config = makeConfig({ initialDelayMs: 500 });
    // 500 * 2^0 = 500, jitter=0
    expect(computeBackoff(config, 0)).toBe(500);

    vi.restoreAllMocks();
  });

  it('handles large attempt values gracefully', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const config = makeConfig({ initialDelayMs: 1_000, maxDelayMs: 60_000 });
    // 1000 * 2^50 is astronomical, but capped at maxDelay
    expect(computeBackoff(config, 50)).toBe(60_000);

    vi.restoreAllMocks();
  });
});

describe('isMaxAttemptsReached', () => {
  it('returns false when under limit', () => {
    const config = makeConfig({ maxAttempts: 5 });
    expect(isMaxAttemptsReached(config, 0)).toBe(false);
    expect(isMaxAttemptsReached(config, 3)).toBe(false);
    expect(isMaxAttemptsReached(config, 4)).toBe(false);
  });

  it('returns true when at limit', () => {
    const config = makeConfig({ maxAttempts: 5 });
    expect(isMaxAttemptsReached(config, 5)).toBe(true);
  });

  it('returns true when over limit', () => {
    const config = makeConfig({ maxAttempts: 5 });
    expect(isMaxAttemptsReached(config, 10)).toBe(true);
  });

  it('handles Infinity maxAttempts', () => {
    const config = makeConfig({ maxAttempts: Infinity });
    expect(isMaxAttemptsReached(config, 0)).toBe(false);
    expect(isMaxAttemptsReached(config, 999_999)).toBe(false);
    expect(isMaxAttemptsReached(config, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('handles maxAttempts of 1', () => {
    const config = makeConfig({ maxAttempts: 1 });
    expect(isMaxAttemptsReached(config, 0)).toBe(false);
    expect(isMaxAttemptsReached(config, 1)).toBe(true);
  });
});

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after specified ms', async () => {
    let resolved = false;
    const promise = sleep(1_000).then(() => { resolved = true; });

    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);

    await promise;
  });

  it('resolves immediately for 0 ms', async () => {
    let resolved = false;
    const promise = sleep(0).then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);

    await promise;
  });
});
