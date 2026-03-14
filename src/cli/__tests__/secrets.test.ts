import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockPrintError,
  mockEncryptSecret,
  mockDecryptSecret,
  mockOraStart,
  mockOraStop,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockOraStart: vi.fn(),
  mockOraStop: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/secrets.js', () => ({
  encryptSecret: (...args: unknown[]) => mockEncryptSecret(...args),
  decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args),
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

vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { registerSecretsCommands } from '../secrets.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let program: Command;
let consoleSpy: MockInstance;

function createProgram(): Command {
  const prog = new Command();
  prog.exitOverride();
  registerSecretsCommands(prog);
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
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  mockRequireAuth.mockReturnValue({ uid: 'user-1', email: 'test@example.com' });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ============================================================================
// Tests
// ============================================================================

describe('secrets commands', () => {
  describe('secrets encrypt', () => {
    it('encrypts with --value and outputs envelope JSON', async () => {
      const envelope = {
        encryptedValue: 'enc',
        encryptedDEK: 'dek',
        kmsKeyVersion: 'v1',
        iv: 'iv',
        authTag: 'tag',
      };
      mockEncryptSecret.mockResolvedValue(envelope);

      await run('secrets', 'encrypt', '--secret-id', 'my-key', '--value', 'sk-123');

      expect(mockEncryptSecret).toHaveBeenCalledWith('my-key', 'user-1', 'sk-123');
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(envelope, null, 2));
    });

    it('returns early if not authenticated', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run('secrets', 'encrypt', '--secret-id', 'key', '--value', 'val');

      expect(mockEncryptSecret).not.toHaveBeenCalled();
    });

    it('errors when neither --value nor --stdin provided', async () => {
      await run('secrets', 'encrypt', '--secret-id', 'key');

      expect(process.exitCode).toBe(2);
      expect(mockEncryptSecret).not.toHaveBeenCalled();
    });
  });

  describe('secrets decrypt', () => {
    it('decrypts with --file', async () => {
      const envelope = {
        encryptedValue: 'enc',
        encryptedDEK: 'dek',
        kmsKeyVersion: 'v1',
        iv: 'iv',
        authTag: 'tag',
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(envelope));
      mockDecryptSecret.mockResolvedValue('sk-secret123');

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await run('secrets', 'decrypt', '--secret-id', 'my-key', '--file', 'envelope.json');

      expect(mockDecryptSecret).toHaveBeenCalledWith('my-key', 'user-1', envelope);
      expect(stdoutSpy).toHaveBeenCalledWith('sk-secret123');
      stdoutSpy.mockRestore();
    });

    it('decrypts with --envelope inline JSON', async () => {
      const envelope = {
        encryptedValue: 'enc',
        encryptedDEK: 'dek',
        kmsKeyVersion: 'v1',
        iv: 'iv',
        authTag: 'tag',
      };
      mockDecryptSecret.mockResolvedValue('sk-secret123');

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      await run('secrets', 'decrypt', '--secret-id', 'my-key', '--envelope', JSON.stringify(envelope));

      expect(mockDecryptSecret).toHaveBeenCalledWith('my-key', 'user-1', envelope);
      stdoutSpy.mockRestore();
    });

    it('errors on invalid envelope JSON', async () => {
      await run('secrets', 'decrypt', '--secret-id', 'key', '--envelope', 'not-json');

      expect(process.exitCode).toBe(1);
      expect(mockDecryptSecret).not.toHaveBeenCalled();
    });

    it('errors when envelope is missing required fields', async () => {
      await run('secrets', 'decrypt', '--secret-id', 'key', '--envelope', '{"encryptedValue":"enc"}');

      expect(process.exitCode).toBe(1);
      expect(mockDecryptSecret).not.toHaveBeenCalled();
    });

    it('errors when neither --envelope nor --file provided', async () => {
      await run('secrets', 'decrypt', '--secret-id', 'key');

      expect(process.exitCode).toBe(2);
      expect(mockDecryptSecret).not.toHaveBeenCalled();
    });
  });
});
