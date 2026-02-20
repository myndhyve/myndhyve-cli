import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const { mockGetAuthStatus } = vi.hoisted(() => ({
  mockGetAuthStatus: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../auth/index.js', () => ({
  getAuthStatus: (...args: unknown[]) => mockGetAuthStatus(...args),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: vi.fn((error: { message: string; suggestion?: string }) => {
    process.stderr.write(`\n  Error: ${error.message}\n`);
    if (error.suggestion) process.stderr.write(`  ${error.suggestion}\n`);
    process.stderr.write('\n');
  }),
}));

import { requireAuth, truncate, formatRelativeTime, printError } from '../helpers.js';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  let stderrSpy: MockInstance;

  beforeEach(() => {
    mockGetAuthStatus.mockReset();
    process.exitCode = undefined;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('returns { uid, email } when authenticated with uid and email', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      uid: 'user-123',
      email: 'test@example.com',
      source: 'credentials',
    });

    const result = requireAuth();

    expect(result).toEqual({ uid: 'user-123', email: 'test@example.com' });
    expect(process.exitCode).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('returns null and sets exitCode = 4 (UNAUTHORIZED) when not authenticated', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: false,
      source: 'none',
    });

    const result = requireAuth();

    expect(result).toBeNull();
    expect(process.exitCode).toBe(4);
  });

  it('prints "Not authenticated" error when not authenticated', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: false,
      source: 'none',
    });

    requireAuth();

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Not authenticated');
    expect(output).toContain('myndhyve-cli auth login');
  });

  it('returns null and sets exitCode = 4 when authenticated but no uid', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      uid: undefined,
      email: 'test@example.com',
      source: 'env',
    });

    const result = requireAuth();

    expect(result).toBeNull();
    expect(process.exitCode).toBe(4);
  });

  it('prints "User ID not available" error when authenticated but no uid', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      uid: undefined,
      email: 'test@example.com',
      source: 'credentials',
    });

    requireAuth();

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('User ID not available');
  });

  it('returns null and sets exitCode when uid is empty string', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      uid: '',
      email: 'test@example.com',
      source: 'credentials',
    });

    const result = requireAuth();

    expect(result).toBeNull();
    expect(process.exitCode).toBe(4);
  });

  it('uses "unknown" as email fallback when email is missing', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      uid: 'user-456',
      email: undefined,
      source: 'credentials',
    });

    const result = requireAuth();

    expect(result).toEqual({ uid: 'user-456', email: 'unknown' });
  });

  it('uses "unknown" as email fallback when email is empty string', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      uid: 'user-789',
      email: '',
      source: 'credentials',
    });

    const result = requireAuth();

    expect(result).toEqual({ uid: 'user-789', email: 'unknown' });
  });
});

// ── truncate ──────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('returns original string when shorter than maxLen', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns original string when exactly maxLen', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and appends ellipsis when longer than maxLen', () => {
    const result = truncate('hello world', 6);
    expect(result).toBe('hello\u2026');
    expect(result.length).toBe(6);
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('handles maxLen = 1 on multi-char string', () => {
    const result = truncate('hello', 1);
    expect(result).toBe('\u2026');
    expect(result.length).toBe(1);
  });

  it('returns single char string unchanged when maxLen >= 1', () => {
    expect(truncate('a', 1)).toBe('a');
  });

  it('truncates correctly at exact boundary', () => {
    // maxLen = 4 on 5-char string: 3 chars + ellipsis
    const result = truncate('abcde', 4);
    expect(result).toBe('abc\u2026');
  });

  it('handles maxLen = 0 on empty string', () => {
    expect(truncate('', 0)).toBe('');
  });

  it('preserves unicode characters in truncated output', () => {
    const result = truncate('cafe\u0301 mocha', 6);
    // str.slice(0, 5) + ellipsis
    expect(result.length).toBe(6);
  });
});

// ── formatRelativeTime ────────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for dates less than 1 minute ago', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(thirtySecondsAgo)).toBe('just now');
  });

  it('returns "just now" for the current moment (0ms diff)', () => {
    const now = new Date(Date.now()).toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns "1m ago" for exactly 1 minute ago', () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    expect(formatRelativeTime(oneMinuteAgo)).toBe('1m ago');
  });

  it('returns "Xm ago" for several minutes', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatRelativeTime(tenMinutesAgo)).toBe('10m ago');
  });

  it('returns "59m ago" at 59 minutes (boundary before hours)', () => {
    const fiftyNineMinutesAgo = new Date(Date.now() - 59 * 60_000).toISOString();
    expect(formatRelativeTime(fiftyNineMinutesAgo)).toBe('59m ago');
  });

  it('returns "1h ago" at exactly 60 minutes', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(formatRelativeTime(oneHourAgo)).toBe('1h ago');
  });

  it('returns "Xh ago" for several hours', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(fiveHoursAgo)).toBe('5h ago');
  });

  it('returns "23h ago" at 23 hours (boundary before days)', () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(twentyThreeHoursAgo)).toBe('23h ago');
  });

  it('returns "1d ago" at exactly 24 hours', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(oneDayAgo)).toBe('1d ago');
  });

  it('returns "Xd ago" for several days', () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(fifteenDaysAgo)).toBe('15d ago');
  });

  it('returns "29d ago" at 29 days (boundary before months)', () => {
    const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(twentyNineDaysAgo)).toBe('29d ago');
  });

  it('returns "1mo ago" at exactly 30 days', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(thirtyDaysAgo)).toBe('1mo ago');
  });

  it('returns "Xmo ago" for several months', () => {
    const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(sixMonthsAgo)).toBe('6mo ago');
  });

  it('returns "11mo ago" at 11 months (boundary before years)', () => {
    const elevenMonthsAgo = new Date(Date.now() - 11 * 30 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(elevenMonthsAgo)).toBe('11mo ago');
  });

  it('returns "1y ago" at 12 months', () => {
    const twelveMonthsAgo = new Date(Date.now() - 12 * 30 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(twelveMonthsAgo)).toBe('1y ago');
  });

  it('returns "Xy ago" for multiple years', () => {
    const threeYearsAgo = new Date(Date.now() - 3 * 12 * 30 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(threeYearsAgo)).toBe('3y ago');
  });

  it('returns "just now" for future dates', () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(futureDate)).toBe('just now');
  });

  it('returns "just now" for far future dates', () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(farFuture)).toBe('just now');
  });
});

// ── printError ────────────────────────────────────────────────────────────────

describe('printError', () => {
  let stderrSpy: MockInstance;

  beforeEach(() => {
    process.exitCode = undefined;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('sets process.exitCode to 1', () => {
    printError('test context', new Error('boom'));
    expect(process.exitCode).toBe(1);
  });

  it('prints context to stderr', () => {
    printError('Loading config', new Error('file not found'));

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Loading config');
  });

  it('prints Error .message to stderr', () => {
    printError('Upload failed', new Error('network timeout'));

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('network timeout');
  });

  it('handles string errors directly', () => {
    printError('Parse failed', 'unexpected token');

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('unexpected token');
    expect(process.exitCode).toBe(1);
  });

  it('handles number errors via String()', () => {
    printError('Exit code', 42);

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('42');
    expect(process.exitCode).toBe(1);
  });

  it('handles null errors via String()', () => {
    printError('Null error', null);

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('null');
  });

  it('handles undefined errors via String()', () => {
    printError('Undefined error', undefined);

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('undefined');
  });

  it('handles object errors via String()', () => {
    printError('Object error', { code: 'ERR' });

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('[object Object]');
  });

  it('writes error output to stderr', () => {
    printError('ctx', new Error('msg'));

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('ctx');
    expect(output).toContain('msg');
  });
});
