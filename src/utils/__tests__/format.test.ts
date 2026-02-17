import { describe, it, expect } from 'vitest';
import { formatTimeSince, formatTimeUntil } from '../format.js';

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
    const date = new Date(Date.now() + 3 * 24 * 60 * 60_000); // 3 days from now
    expect(formatTimeUntil(date)).toBe('3 days');
  });

  it('returns "0 minutes" for past dates', () => {
    const date = new Date(Date.now() - 60_000); // 1 minute ago
    expect(formatTimeUntil(date)).toBe('0 minutes');
  });
});
