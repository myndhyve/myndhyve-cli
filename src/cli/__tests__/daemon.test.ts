/**
 * Tests for the Daemon Management module.
 *
 * Covers PID file handling, process lifecycle checks,
 * daemon spawning, and daemon stopping with all edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before any import so vi.mock can reference them
// ---------------------------------------------------------------------------

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
}));

const mockSpawn = vi.hoisted(() => vi.fn());

const mockLoader = vi.hoisted(() => ({
  getCliDir: vi.fn(),
  getLogDir: vi.fn(),
  ensureCliDir: vi.fn(),
  ensureLogDir: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockCreateLogger = vi.hoisted(() => vi.fn(() => mockLogger));

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: mockFs.existsSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
  unlinkSync: mockFs.unlinkSync,
  openSync: mockFs.openSync,
  closeSync: mockFs.closeSync,
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../../config/loader.js', () => ({
  getCliDir: mockLoader.getCliDir,
  getLogDir: mockLoader.getLogDir,
  ensureCliDir: mockLoader.ensureCliDir,
  ensureLogDir: mockLoader.ensureLogDir,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: mockCreateLogger,
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are wired
// ---------------------------------------------------------------------------

import {
  getPidFilePath,
  getLogFilePath,
  ensureLogFile,
  readPidFile,
  writePidFile,
  removePidFile,
  isProcessAlive,
  getDaemonPid,
  spawnDaemon,
  stopDaemon,
} from '../daemon.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const CLI_DIR = '/home/testuser/.myndhyve-cli';
const LOG_DIR = `${CLI_DIR}/logs`;
const PID_PATH = `${CLI_DIR}/relay.pid`;
const LOG_PATH = `${LOG_DIR}/relay.log`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Full reset clears call history, return values, and queued once-values
  mockFs.existsSync.mockReset();
  mockFs.readFileSync.mockReset();
  mockFs.writeFileSync.mockReset();
  mockFs.unlinkSync.mockReset();
  mockFs.openSync.mockReset();
  mockFs.closeSync.mockReset();

  mockSpawn.mockReset();

  mockLoader.getCliDir.mockReset();
  mockLoader.getLogDir.mockReset();
  mockLoader.ensureCliDir.mockReset();
  mockLoader.ensureLogDir.mockReset();

  mockLogger.debug.mockReset();
  mockLogger.info.mockReset();
  mockLogger.warn.mockReset();
  mockLogger.error.mockReset();

  // Defaults
  mockLoader.getCliDir.mockReturnValue(CLI_DIR);
  mockLoader.getLogDir.mockReturnValue(LOG_DIR);
  mockLoader.ensureLogDir.mockReturnValue(LOG_DIR);
});

// ===========================================================================
// getPidFilePath
// ===========================================================================

describe('getPidFilePath', () => {
  it('returns the correct path under the CLI directory', () => {
    const result = getPidFilePath();
    expect(result).toBe(PID_PATH);
    expect(mockLoader.getCliDir).toHaveBeenCalled();
  });
});

// ===========================================================================
// getLogFilePath
// ===========================================================================

describe('getLogFilePath', () => {
  it('returns the correct path without creating directories', () => {
    const result = getLogFilePath();
    expect(result).toBe(LOG_PATH);
    expect(mockLoader.getLogDir).toHaveBeenCalled();
    expect(mockLoader.ensureLogDir).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// ensureLogFile
// ===========================================================================

describe('ensureLogFile', () => {
  it('returns the correct path and ensures directory exists', () => {
    const result = ensureLogFile();
    expect(result).toBe(LOG_PATH);
    expect(mockLoader.ensureLogDir).toHaveBeenCalled();
  });
});

// ===========================================================================
// readPidFile
// ===========================================================================

describe('readPidFile', () => {
  it('returns pid when file exists with valid content', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('12345\n');

    const result = readPidFile();

    expect(result).toBe(12345);
    expect(mockFs.existsSync).toHaveBeenCalledWith(PID_PATH);
    expect(mockFs.readFileSync).toHaveBeenCalledWith(PID_PATH, 'utf-8');
  });

  it('returns null when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = readPidFile();

    expect(result).toBeNull();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
  });

  it('returns null for NaN content', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('not-a-number');

    expect(readPidFile()).toBeNull();
  });

  it('returns null for negative pid', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('-1');

    expect(readPidFile()).toBeNull();
  });

  it('returns null for zero pid', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('0');

    expect(readPidFile()).toBeNull();
  });

  it('returns null for empty file', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('   ');

    expect(readPidFile()).toBeNull();
  });

  it('returns null for Infinity', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('Infinity');

    expect(readPidFile()).toBeNull();
  });

  it('returns null when readFileSync throws', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(readPidFile()).toBeNull();
  });
});

// ===========================================================================
// writePidFile
// ===========================================================================

describe('writePidFile', () => {
  it('writes pid string to file with restrictive permissions', () => {
    writePidFile(42);

    expect(mockLoader.ensureCliDir).toHaveBeenCalled();
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(PID_PATH, '42', {
      mode: 0o600,
    });
  });

  it('calls ensureCliDir before writing', () => {
    const callOrder: string[] = [];
    mockLoader.ensureCliDir.mockImplementation(() => {
      callOrder.push('ensureCliDir');
    });
    mockFs.writeFileSync.mockImplementation(() => {
      callOrder.push('writeFileSync');
    });

    writePidFile(1000);

    expect(callOrder).toEqual(['ensureCliDir', 'writeFileSync']);
  });
});

// ===========================================================================
// removePidFile
// ===========================================================================

describe('removePidFile', () => {
  it('removes file when it exists', () => {
    mockFs.existsSync.mockReturnValue(true);

    removePidFile();

    expect(mockFs.unlinkSync).toHaveBeenCalledWith(PID_PATH);
  });

  it('does nothing when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    removePidFile();

    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it('swallows errors from unlinkSync', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.unlinkSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    // Should not throw
    expect(() => removePidFile()).not.toThrow();
  });
});

// ===========================================================================
// isProcessAlive
// ===========================================================================

describe('isProcessAlive', () => {
  let killSpy: MockInstance;

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('returns true when process.kill(pid, 0) succeeds', () => {
    killSpy.mockReturnValue(true);

    expect(isProcessAlive(9999)).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(9999, 0);
  });

  it('returns false when process.kill throws', () => {
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });

    expect(isProcessAlive(9999)).toBe(false);
  });
});

// ===========================================================================
// getDaemonPid
// ===========================================================================

describe('getDaemonPid', () => {
  let killSpy: MockInstance;

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('returns pid when process is alive', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('5555');
    killSpy.mockReturnValue(true);

    const result = getDaemonPid();

    expect(result).toBe(5555);
  });

  it('returns null and cleans up stale PID file when process is dead', () => {
    // readPidFile returns a pid
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('5555');

    // isProcessAlive returns false
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });

    const result = getDaemonPid();

    expect(result).toBeNull();
    // removePidFile should have been called — which calls unlinkSync
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(PID_PATH);
  });

  it('returns null when no PID file exists', () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = getDaemonPid();

    expect(result).toBeNull();
    // Should not attempt to check process or remove file
    expect(killSpy).not.toHaveBeenCalled();
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// spawnDaemon
// ===========================================================================

describe('spawnDaemon', () => {
  let killSpy: MockInstance;
  const FAKE_FD = 7;
  const CHILD_PID = 12345;

  function makeChildMock(pid?: number) {
    return {
      pid,
      unref: vi.fn(),
      on: vi.fn(),
    };
  }

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockFs.openSync.mockReturnValue(FAKE_FD);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('spawns a detached process with correct args', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    const entryPoint = process.argv[1];
    spawnDaemon();

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [entryPoint, 'relay', 'start'],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', FAKE_FD, FAKE_FD],
      }),
    );
  });

  it('writes PID file and calls unref', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    const pid = spawnDaemon();

    expect(pid).toBe(CHILD_PID);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      PID_PATH,
      String(CHILD_PID),
      { mode: 0o600 },
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('passes --verbose when specified', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    const entryPoint = process.argv[1];
    spawnDaemon(true);

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [entryPoint, 'relay', 'start', '--verbose'],
      expect.any(Object),
    );
  });

  it('does not pass --verbose when verbose is false', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    const entryPoint = process.argv[1];
    spawnDaemon(false);

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [entryPoint, 'relay', 'start'],
      expect.any(Object),
    );
  });

  it('sets MYNDHYVE_CLI_DAEMON env var', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    spawnDaemon();

    const spawnCall = mockSpawn.mock.calls[0];
    const spawnOptions = spawnCall[2];
    expect(spawnOptions.env).toEqual(
      expect.objectContaining({
        MYNDHYVE_CLI_DAEMON: '1',
      }),
    );
  });

  it('opens log file in append mode and closes FD after spawn', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    spawnDaemon();

    expect(mockFs.openSync).toHaveBeenCalledWith(LOG_PATH, 'a');
    expect(mockFs.closeSync).toHaveBeenCalledWith(FAKE_FD);
  });

  it('throws when child has no pid', () => {
    const child = makeChildMock(undefined);
    mockSpawn.mockReturnValue(child);

    expect(() => spawnDaemon()).toThrow('Failed to spawn daemon process');
    // Should not write PID file
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('logs debug message after spawning', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    spawnDaemon();

    expect(mockLogger.debug).toHaveBeenCalledWith('Daemon spawned', {
      pid: CHILD_PID,
      logFile: LOG_PATH,
    });
  });

  it('returns the child pid', () => {
    const child = makeChildMock(CHILD_PID);
    mockSpawn.mockReturnValue(child);

    const result = spawnDaemon();
    expect(result).toBe(CHILD_PID);
  });
});

// ===========================================================================
// stopDaemon
// ===========================================================================

describe('stopDaemon', () => {
  let killSpy: MockInstance;

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('sends SIGTERM and removes PID file', () => {
    // getDaemonPid() reads file and checks alive
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('7777');
    // First kill(pid, 0) for isProcessAlive — success
    // Second kill(pid, 'SIGTERM') for stopDaemon — success
    killSpy.mockReturnValue(true);

    const result = stopDaemon();

    expect(result).toBe(true);
    // Verify SIGTERM was sent (second call)
    expect(killSpy).toHaveBeenCalledWith(7777, 'SIGTERM');
    // PID file removed
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(PID_PATH);
  });

  it('returns false when no daemon is running (no PID file)', () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = stopDaemon();

    expect(result).toBe(false);
    expect(killSpy).not.toHaveBeenCalledWith(expect.any(Number), 'SIGTERM');
  });

  it('returns false when no daemon is running (stale PID file)', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('7777');
    // isProcessAlive check fails — process is dead
    killSpy.mockImplementation(() => {
      throw new Error('ESRCH');
    });

    const result = stopDaemon();

    expect(result).toBe(false);
    // getDaemonPid() already cleaned up the stale PID file
  });

  it('handles ESRCH during SIGTERM gracefully', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('8888');

    // First call: kill(8888, 0) for isProcessAlive — succeeds
    // Second call: kill(8888, 'SIGTERM') — throws ESRCH (died between check and kill)
    let callCount = 0;
    killSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return true; // isProcessAlive
      const err = new Error('No such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    const result = stopDaemon();

    expect(result).toBe(false);
    // PID file should still be cleaned up
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(PID_PATH);
  });

  it('rethrows non-ESRCH errors', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('8888');

    let callCount = 0;
    killSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return true; // isProcessAlive
      const err = new Error('Operation not permitted') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    expect(() => stopDaemon()).toThrow('Operation not permitted');
  });
});
