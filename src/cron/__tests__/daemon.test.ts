import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockOpenSync,
  mockCloseSync,
  mockSpawn,
  mockGetCliDir,
  mockEnsureCliDir,
  mockGetCronDir,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockOpenSync: vi.fn(),
  mockCloseSync: vi.fn(),
  mockSpawn: vi.fn(),
  mockGetCliDir: vi.fn(),
  mockEnsureCliDir: vi.fn(),
  mockGetCronDir: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  mkdirSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('../../config/loader.js', () => ({
  getCliDir: () => mockGetCliDir(),
  ensureCliDir: () => mockEnsureCliDir(),
}));

vi.mock('../store.js', () => ({
  getCronDir: () => mockGetCronDir(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Import SUT ────────────────────────────────────────────────────────────────

import {
  readSchedulerPidFile,
  writeSchedulerPidFile,
  removeSchedulerPidFile,
  isSchedulerAlive,
  getSchedulerPid,
  spawnScheduler,
  stopScheduler,
  getSchedulerLogFilePath,
} from '../daemon.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronDaemon', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockUnlinkSync.mockReset();
    mockOpenSync.mockReset();
    mockCloseSync.mockReset();
    mockSpawn.mockReset();
    mockGetCliDir.mockReset();
    mockEnsureCliDir.mockReset();
    mockGetCronDir.mockReset();

    mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
    mockGetCronDir.mockReturnValue('/home/user/.myndhyve-cli/cron');
    mockExistsSync.mockReturnValue(true);
  });

  // ── PID file ──────────────────────────────────────────────────────────

  describe('readSchedulerPidFile', () => {
    it('returns PID from file', () => {
      mockReadFileSync.mockReturnValue('12345\n');
      expect(readSchedulerPidFile()).toBe(12345);
    });

    it('returns null when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(readSchedulerPidFile()).toBeNull();
    });

    it('returns null for invalid content', () => {
      mockReadFileSync.mockReturnValue('not-a-number');
      expect(readSchedulerPidFile()).toBeNull();
    });

    it('returns null for zero PID', () => {
      mockReadFileSync.mockReturnValue('0');
      expect(readSchedulerPidFile()).toBeNull();
    });

    it('returns null for negative PID', () => {
      mockReadFileSync.mockReturnValue('-1');
      expect(readSchedulerPidFile()).toBeNull();
    });
  });

  describe('writeSchedulerPidFile', () => {
    it('writes PID with restricted permissions', () => {
      writeSchedulerPidFile(42);
      expect(mockEnsureCliDir).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/home/user/.myndhyve-cli/scheduler.pid',
        '42',
        { mode: 0o600 },
      );
    });
  });

  describe('removeSchedulerPidFile', () => {
    it('deletes PID file when it exists', () => {
      removeSchedulerPidFile();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('no-ops when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      removeSchedulerPidFile();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });

  // ── Process management ────────────────────────────────────────────────

  describe('isSchedulerAlive', () => {
    it('returns true when process exists', () => {
      const originalKill = process.kill;
      process.kill = vi.fn() as typeof process.kill;
      expect(isSchedulerAlive(12345)).toBe(true);
      process.kill = originalKill;
    });

    it('returns false when process does not exist', () => {
      const originalKill = process.kill;
      process.kill = vi.fn(() => { throw new Error('ESRCH'); }) as unknown as typeof process.kill;
      expect(isSchedulerAlive(99999)).toBe(false);
      process.kill = originalKill;
    });
  });

  describe('getSchedulerPid', () => {
    it('returns PID when process is alive', () => {
      mockReadFileSync.mockReturnValue('12345');
      const originalKill = process.kill;
      process.kill = vi.fn() as typeof process.kill;

      expect(getSchedulerPid()).toBe(12345);

      process.kill = originalKill;
    });

    it('cleans up stale PID file and returns null', () => {
      mockReadFileSync.mockReturnValue('99999');
      const originalKill = process.kill;
      process.kill = vi.fn(() => { throw new Error('ESRCH'); }) as unknown as typeof process.kill;

      expect(getSchedulerPid()).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalled(); // Stale file cleaned up

      process.kill = originalKill;
    });

    it('returns null when no PID file', () => {
      mockExistsSync.mockReturnValue(false);
      expect(getSchedulerPid()).toBeNull();
    });
  });

  // ── spawnScheduler ────────────────────────────────────────────────────

  describe('spawnScheduler', () => {
    it('spawns detached process and writes PID file', () => {
      mockOpenSync.mockReturnValue(3);
      const mockChild = { pid: 42, unref: vi.fn() };
      mockSpawn.mockReturnValue(mockChild);

      const pid = spawnScheduler();

      expect(pid).toBe(42);
      expect(mockSpawn).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining(['cron', 'start', '--foreground']),
        expect.objectContaining({ detached: true }),
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/home/user/.myndhyve-cli/scheduler.pid',
        '42',
        { mode: 0o600 },
      );
      expect(mockChild.unref).toHaveBeenCalled();
      expect(mockCloseSync).toHaveBeenCalledWith(3);
    });

    it('passes --allow-shell when option is set', () => {
      mockOpenSync.mockReturnValue(3);
      mockSpawn.mockReturnValue({ pid: 42, unref: vi.fn() });

      spawnScheduler({ allowShell: true });

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--allow-shell');
    });

    it('throws when spawn returns no PID', () => {
      mockOpenSync.mockReturnValue(3);
      mockSpawn.mockReturnValue({ pid: undefined, unref: vi.fn() });

      expect(() => spawnScheduler()).toThrow('Failed to spawn');
    });
  });

  // ── stopScheduler ─────────────────────────────────────────────────────

  describe('stopScheduler', () => {
    it('sends SIGTERM and cleans up PID file', () => {
      mockReadFileSync.mockReturnValue('12345');
      const originalKill = process.kill;
      process.kill = vi.fn() as typeof process.kill;

      expect(stopScheduler()).toBe(true);
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(mockUnlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });

    it('returns false when not running', () => {
      mockExistsSync.mockReturnValue(false);
      expect(stopScheduler()).toBe(false);
    });
  });

  // ── Paths ─────────────────────────────────────────────────────────────

  describe('getSchedulerLogFilePath', () => {
    it('returns correct path', () => {
      expect(getSchedulerLogFilePath()).toBe('/home/user/.myndhyve-cli/cron/scheduler.log');
    });
  });
});
