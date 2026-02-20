import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockCliVersion,
  mockVersionString,
  mockGetCliDir,
  mockEnsureCliDir,
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockCliVersion: '0.1.0',
  mockVersionString: '@myndhyve/cli v0.1.0',
  mockGetCliDir: vi.fn(),
  mockEnsureCliDir: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../config/defaults.js', () => ({
  CLI_VERSION: mockCliVersion,
  VERSION_STRING: mockVersionString,
}));

vi.mock('../../config/loader.js', () => ({
  getCliDir: (...args: unknown[]) => mockGetCliDir(...args),
  ensureCliDir: (...args: unknown[]) => mockEnsureCliDir(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// chalk — passthrough for all style methods
vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<typeof passthrough> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target, _thisArg, args: [string]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

// ora — spinner mock
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  }),
}));

import { registerUpdateCommand, maybeNotifyUpdate } from '../update.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const CLI_DIR = '/home/testuser/.myndhyve-cli';

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerUpdateCommand(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerUpdateCommand', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;
  let mockFetch: MockInstance;

  beforeEach(() => {
    mockGetCliDir.mockReset();
    mockEnsureCliDir.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();

    // Defaults
    mockGetCliDir.mockReturnValue(CLI_DIR);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND STRUCTURE
  // ==========================================================================

  describe('command structure', () => {
    it('registers the update command on the program', () => {
      const program = new Command();
      registerUpdateCommand(program);
      const update = program.commands.find((c) => c.name() === 'update');
      expect(update).toBeDefined();
    });
  });

  // ==========================================================================
  // UPDATE COMMAND
  // ==========================================================================

  describe('update command', () => {
    it('shows new version available when update exists', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.0' }),
      });

      await run(['update']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MyndHyve CLI');
      expect(output).toContain('npm install -g @myndhyve/cli');
    });

    it('shows up to date when already on latest', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.1.0' }),
      });

      await run(['update']);

      expect(process.exitCode).toBeUndefined();
    });

    it('shows up to date when remote version is older', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.0.9' }),
      });

      await run(['update']);

      expect(process.exitCode).toBeUndefined();
    });

    it('sets exitCode=1 on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await run(['update']);

      expect(process.exitCode).toBe(1);
      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Network error');
    });

    it('shows manual check instructions on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('ENOTFOUND'));

      await run(['update']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('npm view @myndhyve/cli version');
      expect(process.exitCode).toBe(1);
    });

    it('sets exitCode=1 when registry returns non-ok status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      await run(['update']);

      expect(process.exitCode).toBe(1);
    });

    it('writes update cache after successful check', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.0' }),
      });

      await run(['update']);

      expect(mockEnsureCliDir).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.update-check'),
        expect.stringContaining('1.0.0'),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it('shows current version in the header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.1.0' }),
      });

      await run(['update']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain(mockVersionString);
    });
  });

  // ==========================================================================
  // maybeNotifyUpdate
  // ==========================================================================

  describe('maybeNotifyUpdate', () => {
    let origArgv: string[];

    beforeEach(() => {
      origArgv = process.argv;
    });

    afterEach(() => {
      process.argv = origArgv;
    });

    it('writes notification to stderr when cached newer version exists', () => {
      process.argv = ['node', 'myndhyve-cli', 'status'];

      const cacheData = JSON.stringify({
        checkedAt: new Date(Date.now() - 1000).toISOString(),
        latestVersion: '2.0.0',
      });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(cacheData);

      maybeNotifyUpdate();

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('Update available');
      expect(output).toContain('2.0.0');
    });

    it('does nothing when --quiet flag present', () => {
      process.argv = ['node', 'myndhyve-cli', 'status', '--quiet'];

      maybeNotifyUpdate();

      expect(stderrWriteSpy).not.toHaveBeenCalled();
      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('does nothing when -q flag present', () => {
      process.argv = ['node', 'myndhyve-cli', 'status', '-q'];

      maybeNotifyUpdate();

      expect(stderrWriteSpy).not.toHaveBeenCalled();
      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('does nothing when --json flag present', () => {
      process.argv = ['node', 'myndhyve-cli', 'status', '--json'];

      maybeNotifyUpdate();

      expect(stderrWriteSpy).not.toHaveBeenCalled();
      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('does nothing when cache is fresh (under 24h)', () => {
      process.argv = ['node', 'myndhyve-cli', 'status'];

      const cacheData = JSON.stringify({
        checkedAt: new Date().toISOString(), // Just now
        latestVersion: '0.1.0',
      });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(cacheData);

      maybeNotifyUpdate();

      // The fetch should NOT have been called because the cache is fresh
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not crash when cache file does not exist', () => {
      process.argv = ['node', 'myndhyve-cli', 'status'];
      mockExistsSync.mockReturnValue(false);

      expect(() => maybeNotifyUpdate()).not.toThrow();
    });

    it('does not crash when cache file contains invalid JSON', () => {
      process.argv = ['node', 'myndhyve-cli', 'status'];
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json');

      // maybeNotifyUpdate should swallow parse errors
      expect(() => maybeNotifyUpdate()).not.toThrow();
    });

    it('does not notify when cached version is same as current', () => {
      process.argv = ['node', 'myndhyve-cli', 'status'];

      const cacheData = JSON.stringify({
        checkedAt: new Date(Date.now() - 1000).toISOString(),
        latestVersion: '0.1.0', // same as CLI_VERSION
      });
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(cacheData);

      maybeNotifyUpdate();

      const calls = stderrWriteSpy.mock.calls;
      const output = calls.map((c) => c[0]).join('');
      expect(output).not.toContain('Update available');
    });
  });
});
