import { describe, it, expect } from 'vitest';
import {
  formatTimeSince,
  formatTimeUntil,
  formatRunError,
  __RUN_ERROR_HINTS__,
} from '../format.js';
import { RUN_ERROR_CODES } from '@myndhyve/wop';

describe('formatTimeSince()', () => {
  it('returns "just now" for dates less than 1 minute ago', () => {
    const date = new Date(Date.now() - 30_000); // 30 seconds ago
    expect(formatTimeSince(date)).toBe('just now');
  });

  it('returns minutes for recent dates', () => {
    const date = new Date(Date.now() - 5 * 60_000); // 5 minutes ago
    expect(formatTimeSince(date)).toBe('5 minutes');
  });

  it('handles singular minute', () => {
    const date = new Date(Date.now() - 60_000); // 1 minute ago
    expect(formatTimeSince(date)).toBe('1 minute');
  });

  it('returns hours for dates more than 60 minutes ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60_000); // 3 hours ago
    expect(formatTimeSince(date)).toBe('3 hours');
  });

  it('handles singular hour', () => {
    const date = new Date(Date.now() - 60 * 60_000); // 1 hour ago
    expect(formatTimeSince(date)).toBe('1 hour');
  });

  it('returns days for dates more than 24 hours ago', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60_000); // 2 days ago
    expect(formatTimeSince(date)).toBe('2 days');
  });

  it('handles singular day', () => {
    const date = new Date(Date.now() - 24 * 60 * 60_000); // 1 day ago
    expect(formatTimeSince(date)).toBe('1 day');
  });
});

describe('formatTimeUntil()', () => {
  it('returns minutes for near-future dates', () => {
    const date = new Date(Date.now() + 10 * 60_000 + 500); // 10 minutes from now (with buffer)
    expect(formatTimeUntil(date)).toBe('10 minutes');
  });

  it('handles singular minute', () => {
    const date = new Date(Date.now() + 90_000); // ~1.5 minutes from now → floors to 1
    expect(formatTimeUntil(date)).toBe('1 minute');
  });

  it('returns hours for dates more than 60 minutes away', () => {
    const date = new Date(Date.now() + 2 * 60 * 60_000); // 2 hours from now
    expect(formatTimeUntil(date)).toBe('2 hours');
  });

  it('returns days for dates more than 24 hours away', () => {
    // Add 1-min buffer so Math.floor doesn't round down due to ms elapsed between Date.now() calls
    const date = new Date(Date.now() + 3 * 24 * 60 * 60_000 + 60_000);
    expect(formatTimeUntil(date)).toBe('3 days');
  });

  it('returns "0 minutes" for past dates', () => {
    const date = new Date(Date.now() - 60_000); // 1 minute ago
    expect(formatTimeUntil(date)).toBe('0 minutes');
  });
});

describe('formatRunError()', () => {
  it('formats a known code with the canonical [code] message shape', () => {
    const out = formatRunError({ code: 'run_not_found', message: 'no such run' });
    expect(out).toBe('[run_not_found] no such run');
  });

  it('appends nodeId when present', () => {
    const out = formatRunError({
      code: 'node_execution_failed',
      message: 'executor threw',
      nodeId: 'n-42',
    });
    expect(out).toBe('[node_execution_failed] executor threw (node: n-42)');
  });

  it('omits nodeId clause when absent', () => {
    const out = formatRunError({ code: 'auth_required', message: 'need login' });
    expect(out).not.toContain('node:');
  });

  it('surfaces a hint on a second line when withHint=true and code is known', () => {
    const out = formatRunError(
      { code: 'recursion_limit_exceeded', message: 'observed 51 > limit 50' },
      { withHint: true },
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[recursion_limit_exceeded] observed 51 > limit 50');
    expect(lines[1]).toMatch(/^ {2}Hint: /);
    expect(lines[1]).toContain('recursionLimit');
  });

  it('surfaces a hint for capability_not_provided', () => {
    const out = formatRunError(
      { code: 'capability_not_provided', message: 'chat.sendPrompt missing' },
      { withHint: true },
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('capability provider');
  });

  it('omits hint when withHint=false (default)', () => {
    const out = formatRunError({
      code: 'recursion_limit_exceeded',
      message: 'observed 51 > limit 50',
    });
    expect(out.split('\n')).toHaveLength(1);
    expect(out).not.toContain('Hint:');
  });

  it('omits hint for unknown wire codes (forward-compat)', () => {
    const out = formatRunError(
      // Code not in RUN_ERROR_CODES — exercises the isRunErrorCode guard.
      { code: 'future_code_not_in_union', message: 'future failure mode' },
      { withHint: true },
    );
    expect(out.split('\n')).toHaveLength(1);
    expect(out).not.toContain('Hint:');
  });

  it('every wire code in RUN_ERROR_CODES has a hint entry (drift gate)', () => {
    // The hint table lives in the CLI but maps codes from the shared
    // types package. If a future PR adds a wire code without a hint,
    // this test fails immediately and the CLI's UX coverage stays in
    // sync with the wire surface.
    const missing = RUN_ERROR_CODES.filter(
      (code) => __RUN_ERROR_HINTS__[code] === undefined,
    );
    expect(missing).toEqual([]);
  });
});
