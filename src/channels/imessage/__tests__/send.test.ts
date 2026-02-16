/**
 * Tests for iMessage send module (AppleScript sending) and types constants.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExecFileAsync, mockLog } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => mockLog,
}));

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

import {
  escapeAppleScript,
  sendIMessage,
  isIMessageConfigured,
  IMessageSendError,
} from '../send.js';

import {
  CORE_DATA_EPOCH_OFFSET,
  NANOSECOND_DIVISOR,
  IMESSAGE_POLL_INTERVAL_MS,
  CHAT_DB_RELATIVE_PATH,
} from '../types.js';

import type { IMessageSendParams } from '../types.js';

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecFileAsync.mockReset();
  mockLog.debug.mockReset();
  mockLog.info.mockReset();
  mockLog.warn.mockReset();
  mockLog.error.mockReset();
});

// ============================================================================
// escapeAppleScript
// ============================================================================

describe('escapeAppleScript', () => {
  it('escapes double quotes', () => {
    expect(escapeAppleScript('say "hello"')).toBe('say \\"hello\\"');
  });

  it('escapes backslashes', () => {
    expect(escapeAppleScript('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('does not alter newlines (handled by buildTextExpression)', () => {
    // escapeAppleScript only handles \ and " — newlines are handled at a higher level
    expect(escapeAppleScript('line1\nline2')).toBe('line1\nline2');
  });

  it('does not alter carriage returns (handled by buildTextExpression)', () => {
    expect(escapeAppleScript('line1\rline2')).toBe('line1\rline2');
  });

  it('does not alter tabs (safe as literal in AppleScript strings)', () => {
    expect(escapeAppleScript('col1\tcol2')).toBe('col1\tcol2');
  });

  it('handles strings with quotes and backslashes', () => {
    const input = 'He said "wow" at C:\\Users';
    const result = escapeAppleScript(input);
    expect(result).toBe('He said \\"wow\\" at C:\\\\Users');
  });

  it('handles empty strings', () => {
    expect(escapeAppleScript('')).toBe('');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeAppleScript('hello world')).toBe('hello world');
  });

  it('escapes backslash before other characters to prevent double escaping', () => {
    // A backslash followed by a quote: \ then " -> \\ then \"
    const input = '\\"';
    const result = escapeAppleScript(input);
    expect(result).toBe('\\\\\\"');
  });
});

// ============================================================================
// sendIMessage — Direct (1:1)
// ============================================================================

describe('sendIMessage', () => {
  describe('direct messages', () => {
    const directParams: IMessageSendParams = {
      to: '+15551234567',
      text: 'Hello from test',
      isGroup: false,
    };

    it('calls osascript with correct arguments for direct message', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage(directParams);

      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);

      const [binary, args] = mockExecFileAsync.mock.calls[0];
      expect(binary).toBe('osascript');
      expect(args).toHaveLength(2);
      expect(args[0]).toBe('-e');
    });

    it('generates AppleScript with participant/buddy for direct message', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage(directParams);

      const script: string = mockExecFileAsync.mock.calls[0][1][1];
      expect(script).toContain('tell application "Messages"');
      expect(script).toContain('set targetService to 1st account whose service type = iMessage');
      expect(script).toContain('participant "+15551234567" of targetService');
      expect(script).toContain('send "Hello from test" to targetBuddy');
      expect(script).toContain('end tell');
    });

    it('escapes special characters in recipient and text', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage({
        to: 'user@icloud.com',
        text: 'He said "hi"',
        isGroup: false,
      });

      const script: string = mockExecFileAsync.mock.calls[0][1][1];
      expect(script).toContain('He said \\"hi\\"');
    });

    it('uses linefeed concatenation for multi-line messages', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage({
        to: '+15551234567',
        text: 'Line 1\nLine 2\nLine 3',
        isGroup: false,
      });

      const script: string = mockExecFileAsync.mock.calls[0][1][1];
      // Multi-line text is split and joined with AppleScript linefeed
      expect(script).toContain('"Line 1" & linefeed & "Line 2" & linefeed & "Line 3"');
      expect(script).toContain('send "Line 1" & linefeed & "Line 2" & linefeed & "Line 3" to targetBuddy');
    });

    it('handles \\r\\n line endings in messages', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage({
        to: '+15551234567',
        text: 'Windows\r\nline breaks',
        isGroup: false,
      });

      const script: string = mockExecFileAsync.mock.calls[0][1][1];
      expect(script).toContain('"Windows" & linefeed & "line breaks"');
    });

    it('handles single-line messages without linefeed concatenation', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage({
        to: '+15551234567',
        text: 'Single line',
        isGroup: false,
      });

      const script: string = mockExecFileAsync.mock.calls[0][1][1];
      expect(script).toContain('send "Single line" to targetBuddy');
      expect(script).not.toContain('linefeed');
    });

    it('sets 15s timeout on execFile call', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage(directParams);

      const opts = mockExecFileAsync.mock.calls[0][2];
      expect(opts).toEqual({ timeout: 15_000 });
    });

    it('logs debug messages on success', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage(directParams);

      expect(mockLog.debug).toHaveBeenCalledWith(
        'Sending iMessage',
        expect.objectContaining({
          to: '+15551234567',
          isGroup: false,
          textLength: 15,
        })
      );
      expect(mockLog.debug).toHaveBeenCalledWith('iMessage sent', { to: '+15551234567' });
    });
  });

  // --------------------------------------------------------------------------
  // Group messages
  // --------------------------------------------------------------------------

  describe('group messages', () => {
    const groupParams: IMessageSendParams = {
      to: 'chat123456',
      text: 'Group hello',
      isGroup: true,
    };

    it('calls osascript with correct arguments for group message', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage(groupParams);

      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
      const [binary] = mockExecFileAsync.mock.calls[0];
      expect(binary).toBe('osascript');
    });

    it('generates AppleScript with chat id for group message', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await sendIMessage(groupParams);

      const script: string = mockExecFileAsync.mock.calls[0][1][1];
      expect(script).toContain('tell application "Messages"');
      expect(script).toContain('set targetChat to chat id "chat123456"');
      expect(script).toContain('send "Group hello" to targetChat');
      expect(script).toContain('end tell');
      // Should NOT contain participant/buddy logic
      expect(script).not.toContain('targetService');
      expect(script).not.toContain('targetBuddy');
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws IMessageSendError when execFile fails', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('osascript: command not found'));

      await expect(sendIMessage({ to: '+15551234567', text: 'hi', isGroup: false }))
        .rejects.toThrow(IMessageSendError);
    });

    it('IMessageSendError has correct message including recipient', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('connection refused'));

      await expect(sendIMessage({ to: '+15551234567', text: 'hi', isGroup: false }))
        .rejects.toThrow('Failed to send iMessage to +15551234567: connection refused');
    });

    it('IMessageSendError has correct recipient property', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('fail'));

      try {
        await sendIMessage({ to: 'user@example.com', text: 'hi', isGroup: false });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(IMessageSendError);
        expect((err as IMessageSendError).recipient).toBe('user@example.com');
      }
    });

    it('IMessageSendError has correct isGroup property for direct message', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('fail'));

      try {
        await sendIMessage({ to: '+15551234567', text: 'hi', isGroup: false });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as IMessageSendError).isGroup).toBe(false);
      }
    });

    it('IMessageSendError has correct isGroup property for group message', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('fail'));

      try {
        await sendIMessage({ to: 'chat999', text: 'hi', isGroup: true });
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as IMessageSendError).isGroup).toBe(true);
      }
    });

    it('handles non-Error rejection values', async () => {
      mockExecFileAsync.mockRejectedValue('string error');

      await expect(sendIMessage({ to: '+15551234567', text: 'hi', isGroup: false }))
        .rejects.toThrow('Failed to send iMessage to +15551234567: string error');
    });
  });
});

// ============================================================================
// isIMessageConfigured
// ============================================================================

describe('isIMessageConfigured', () => {
  it('returns true when osascript returns count > 0', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '1\n', stderr: '' });

    const result = await isIMessageConfigured();

    expect(result).toBe(true);
  });

  it('returns true for multiple accounts', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '3\n', stderr: '' });

    const result = await isIMessageConfigured();

    expect(result).toBe(true);
  });

  it('returns false when osascript returns "0"', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '0\n', stderr: '' });

    const result = await isIMessageConfigured();

    expect(result).toBe(false);
  });

  it('returns false when osascript fails (throws)', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('osascript not available'));

    const result = await isIMessageConfigured();

    expect(result).toBe(false);
  });

  it('calls osascript with correct script to count iMessage accounts', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '1\n', stderr: '' });

    await isIMessageConfigured();

    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    const [binary, args, opts] = mockExecFileAsync.mock.calls[0];
    expect(binary).toBe('osascript');
    expect(args[0]).toBe('-e');

    const script: string = args[1];
    expect(script).toContain('tell application "Messages"');
    expect(script).toContain('count of (accounts whose service type = iMessage)');
    expect(script).toContain('end tell');

    expect(opts).toEqual({ timeout: 10_000 });
  });

  it('returns false for non-numeric stdout', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: 'not a number\n', stderr: '' });

    const result = await isIMessageConfigured();

    // parseInt('not a number') => NaN, NaN > 0 => false
    expect(result).toBe(false);
  });
});

// ============================================================================
// IMessageSendError
// ============================================================================

describe('IMessageSendError', () => {
  it('has correct name property', () => {
    const err = new IMessageSendError('test error', '+15551234567', false);
    expect(err.name).toBe('IMessageSendError');
  });

  it('is an instance of Error', () => {
    const err = new IMessageSendError('test error', '+15551234567', false);
    expect(err).toBeInstanceOf(Error);
  });

  it('stores recipient', () => {
    const err = new IMessageSendError('test error', 'user@example.com', false);
    expect(err.recipient).toBe('user@example.com');
  });

  it('stores isGroup as false for direct messages', () => {
    const err = new IMessageSendError('test error', '+15551234567', false);
    expect(err.isGroup).toBe(false);
  });

  it('stores isGroup as true for group messages', () => {
    const err = new IMessageSendError('test error', 'chat123', true);
    expect(err.isGroup).toBe(true);
  });

  it('stores message', () => {
    const err = new IMessageSendError('custom message', '+15551234567', false);
    expect(err.message).toBe('custom message');
  });
});

// ============================================================================
// types.ts — Constants
// ============================================================================

describe('iMessage type constants', () => {
  it('CORE_DATA_EPOCH_OFFSET is 978307200 (2001-01-01 in unix seconds)', () => {
    expect(CORE_DATA_EPOCH_OFFSET).toBe(978307200);
    // Verify it corresponds to 2001-01-01T00:00:00Z
    const date = new Date(CORE_DATA_EPOCH_OFFSET * 1000);
    expect(date.toISOString()).toBe('2001-01-01T00:00:00.000Z');
  });

  it('NANOSECOND_DIVISOR is 1 billion', () => {
    expect(NANOSECOND_DIVISOR).toBe(1_000_000_000);
  });

  it('IMESSAGE_POLL_INTERVAL_MS is 2000', () => {
    expect(IMESSAGE_POLL_INTERVAL_MS).toBe(2000);
  });

  it('CHAT_DB_RELATIVE_PATH points to Messages chat.db', () => {
    expect(CHAT_DB_RELATIVE_PATH).toBe('Library/Messages/chat.db');
  });
});
