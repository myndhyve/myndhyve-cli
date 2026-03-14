import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockPrintError,
  mockSendEmail,
  mockSendSMS,
  mockOraStart,
  mockOraStop,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendSMS: vi.fn(),
  mockOraStart: vi.fn(),
  mockOraStop: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/notifications.js', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  sendSMS: (...args: unknown[]) => mockSendSMS(...args),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: vi.fn(),
}));

vi.mock('ora', () => {
  const spinner = {
    start: (...args: unknown[]) => { mockOraStart(...args); return spinner; },
    stop: (...args: unknown[]) => { mockOraStop(...args); return spinner; },
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  };
  return { default: () => spinner };
});

import { registerNotifyCommands } from '../notify.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let program: Command;
let consoleSpy: MockInstance;

function createProgram(): Command {
  const prog = new Command();
  prog.exitOverride();
  registerNotifyCommands(prog);
  return prog;
}

async function run(...args: string[]): Promise<void> {
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  program = createProgram();
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  mockRequireAuth.mockReturnValue({ uid: 'user-1', email: 'test@example.com' });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ============================================================================
// Tests
// ============================================================================

describe('notify commands', () => {
  describe('notify email', () => {
    it('sends a direct email', async () => {
      mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });

      await run('notify', 'email', '--to', 'user@example.com', '--subject', 'Hello', '--body', 'World');

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'World',
        html: undefined,
        templateType: undefined,
        templateData: undefined,
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Email sent'));
    });

    it('sends a templated email', async () => {
      mockSendEmail.mockResolvedValue({ success: true });

      await run('notify', 'email', '--to', 'user@example.com',
        '--template', 'welcome', '--data', '{"userName":"Alice"}');

      expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
        templateType: 'welcome',
        templateData: { userName: 'Alice' },
      }));
    });

    it('errors when no subject or template', async () => {
      await run('notify', 'email', '--to', 'user@example.com');

      expect(process.exitCode).toBe(2);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('errors on invalid --data JSON', async () => {
      await run('notify', 'email', '--to', 'x@x.com', '--template', 'welcome', '--data', 'bad');

      expect(process.exitCode).toBe(1);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('outputs JSON with --format json', async () => {
      const result = { success: true, messageId: 'msg-1' };
      mockSendEmail.mockResolvedValue(result);

      await run('notify', 'email', '--to', 'x@x.com', '--subject', 'Hi', '--body', 'Hey', '--format', 'json');

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    });
  });

  describe('notify sms', () => {
    it('sends a direct SMS', async () => {
      mockSendSMS.mockResolvedValue({ success: true, messageId: 'sms-1', status: 'queued' });

      await run('notify', 'sms', '--to', '+15551234567', '--body', 'Your code is 123456');

      expect(mockSendSMS).toHaveBeenCalledWith({
        to: '+15551234567',
        body: 'Your code is 123456',
        templateType: undefined,
        templateData: undefined,
      });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SMS sent'));
    });

    it('sends a templated SMS', async () => {
      mockSendSMS.mockResolvedValue({ success: true });

      await run('notify', 'sms', '--to', '+15551234567',
        '--template', 'verification_code', '--data', '{"code":"123456"}');

      expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({
        templateType: 'verification_code',
        templateData: { code: '123456' },
      }));
    });

    it('errors when no body or template', async () => {
      await run('notify', 'sms', '--to', '+15551234567');

      expect(process.exitCode).toBe(2);
      expect(mockSendSMS).not.toHaveBeenCalled();
    });

    it('returns early if not authenticated', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run('notify', 'sms', '--to', '+15551234567', '--body', 'Hello');

      expect(mockSendSMS).not.toHaveBeenCalled();
    });
  });
});
