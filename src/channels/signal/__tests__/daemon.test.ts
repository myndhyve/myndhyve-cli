import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Hoisted mock variables — available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockSpawn,
  mockHealthCheck,
  mockExistsSync,
  mockSleep,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockHealthCheck: vi.fn(),
  mockExistsSync: vi.fn(),
  mockSleep: vi.fn((_ms: number) => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('../client.js', () => ({
  healthCheck: (...args: unknown[]) => mockHealthCheck(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../utils/backoff.js', () => ({
  sleep: (ms: number) => mockSleep(ms),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
  };
  proc.kill = vi.fn();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 12345;
  return proc;
}

/**
 * Mock spawn to return a process that exits with a given code.
 * Used for isSignalCliInstalled tests.
 */
function mockSpawnExitsWith(code: number) {
  const proc = createMockProcess();
  mockSpawn.mockReturnValue(proc);
  // Schedule exit event on next tick so the promise listener is attached first
  process.nextTick(() => proc.emit('exit', code, null));
  return proc;
}

/**
 * Mock spawn to emit an error (e.g. ENOENT when binary not found).
 */
function mockSpawnError(errorMessage: string) {
  const proc = createMockProcess();
  mockSpawn.mockReturnValue(proc);
  process.nextTick(() => proc.emit('error', new Error(errorMessage)));
  return proc;
}

/**
 * Set up spawn mock for startSignalDaemon tests.
 * First spawn call is for isSignalCliInstalled (exits 0).
 * Second call is the actual daemon process (kept alive).
 * Returns a getter for the daemon process reference.
 */
function setupDaemonSpawn(): { getDaemonProc: () => ReturnType<typeof createMockProcess> } {
  let callCount = 0;
  let daemonProc: ReturnType<typeof createMockProcess> | null = null;

  mockSpawn.mockImplementation((..._args: unknown[]) => {
    callCount++;
    const proc = createMockProcess();
    if (callCount === 1) {
      // isSignalCliInstalled check — exit with code 0
      process.nextTick(() => proc.emit('exit', 0, null));
    } else {
      daemonProc = proc;
    }
    return proc;
  });

  return {
    getDaemonProc: () => daemonProc!,
  };
}

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  isSignalCliInstalled,
  hasAccountData,
  startSignalDaemon,
  SignalDaemonError,
} from '../daemon.js';
import type { SignalDaemonConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSpawn.mockReset();
  mockHealthCheck.mockReset();
  mockExistsSync.mockReset();
  mockSleep.mockReset();
  // Use setTimeout(0) to yield to the event loop, preventing tight spin loops
  mockSleep.mockImplementation(() => new Promise<void>((r) => setTimeout(r, 0)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ============================================================================
// SignalDaemonError
// ============================================================================

describe('SignalDaemonError', () => {
  it('has correct name property', () => {
    const error = new SignalDaemonError('test message', 'not-installed');
    expect(error.name).toBe('SignalDaemonError');
  });

  it('has correct errorType property', () => {
    const error = new SignalDaemonError('test message', 'spawn-failed');
    expect(error.errorType).toBe('spawn-failed');
  });

  it('has correct message property', () => {
    const error = new SignalDaemonError('signal-cli is broken', 'crashed');
    expect(error.message).toBe('signal-cli is broken');
  });

  it('is an instance of Error', () => {
    const error = new SignalDaemonError('test', 'timeout');
    expect(error).toBeInstanceOf(Error);
  });

  it('preserves all error type values', () => {
    const types = ['not-installed', 'spawn-failed', 'timeout', 'crashed'] as const;
    for (const type of types) {
      const error = new SignalDaemonError('msg', type);
      expect(error.errorType).toBe(type);
    }
  });
});

// ============================================================================
// isSignalCliInstalled()
// ============================================================================

describe('isSignalCliInstalled()', () => {
  it('returns true when signal-cli --version exits with code 0', async () => {
    mockSpawnExitsWith(0);

    const result = await isSignalCliInstalled();

    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith('signal-cli', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('returns false when signal-cli --version exits with non-zero code', async () => {
    mockSpawnExitsWith(1);

    const result = await isSignalCliInstalled();

    expect(result).toBe(false);
  });

  it('returns false when signal-cli is not found (spawn error)', async () => {
    mockSpawnError('spawn signal-cli ENOENT');

    const result = await isSignalCliInstalled();

    expect(result).toBe(false);
  });

  it('returns false on timeout (process does not exit within 5s)', async () => {
    vi.useFakeTimers();

    // Create a process that never exits and never errors
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = isSignalCliInstalled();

    // Advance past the 5 second timeout
    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(result).toBe(false);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('returns false if spawn itself throws synchronously', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed catastrophically');
    });

    const result = await isSignalCliInstalled();

    expect(result).toBe(false);
  });
});

// ============================================================================
// hasAccountData()
// ============================================================================

describe('hasAccountData()', () => {
  it('returns false when dataDir does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = hasAccountData('/nonexistent/dir');

    expect(result).toBe(false);
    expect(mockExistsSync).toHaveBeenCalledWith('/nonexistent/dir');
  });

  it('returns true when dataDir exists and no specific account requested', () => {
    mockExistsSync.mockReturnValue(true);

    const result = hasAccountData('/existing/dir');

    expect(result).toBe(true);
  });

  it('returns false when account-specific directory does not exist', () => {
    // First call for dataDir returns true, second for account dir returns false
    mockExistsSync
      .mockReturnValueOnce(true)   // dataDir exists
      .mockReturnValueOnce(false); // account dir doesn't exist

    const result = hasAccountData('/data/dir', '+1234567890');

    expect(result).toBe(false);
    expect(mockExistsSync).toHaveBeenCalledTimes(2);
    expect(mockExistsSync).toHaveBeenNthCalledWith(1, '/data/dir');
    // Second call checks the account-specific path
    expect(mockExistsSync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('+1234567890')
    );
  });

  it('returns true when account-specific directory exists', () => {
    mockExistsSync.mockReturnValue(true);

    const result = hasAccountData('/data/dir', '+1234567890');

    expect(result).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// startSignalDaemon()
// ============================================================================

describe('startSignalDaemon()', () => {
  const defaultConfig: SignalDaemonConfig = {
    dataDir: '/tmp/signal-data',
    host: '127.0.0.1',
    port: 18080,
  };

  it('throws SignalDaemonError(not-installed) when signal-cli not installed', async () => {
    // isSignalCliInstalled spawns signal-cli --version, which emits error
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    process.nextTick(() => proc.emit('error', new Error('ENOENT')));

    try {
      await startSignalDaemon(defaultConfig);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SignalDaemonError);
      expect((error as SignalDaemonError).errorType).toBe('not-installed');
    }
  });

  it('spawns signal-cli with correct args including --config and daemon --http', async () => {
    setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const daemon = await startSignalDaemon(defaultConfig);

    // Two spawn calls: isSignalCliInstalled + daemon
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    const secondCallArgs = mockSpawn.mock.calls[1];
    expect(secondCallArgs[0]).toBe('signal-cli');

    const args: string[] = secondCallArgs[1];
    expect(args).toContain('--config');
    expect(args).toContain('/tmp/signal-data');
    expect(args).toContain('daemon');
    expect(args).toContain('--http');
    expect(args).toContain('127.0.0.1:18080');

    // No -a flag when no account specified
    expect(args).not.toContain('-a');

    daemon.stop();
  });

  it('spawns with -a flag when account is specified', async () => {
    setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const configWithAccount: SignalDaemonConfig = {
      ...defaultConfig,
      account: '+1234567890',
    };

    const daemon = await startSignalDaemon(configWithAccount);

    const secondCallArgs = mockSpawn.mock.calls[1];
    const args: string[] = secondCallArgs[1];
    expect(args).toContain('-a');
    expect(args).toContain('+1234567890');

    daemon.stop();
  });

  it('spawns without -a flag when no account specified', async () => {
    setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const daemon = await startSignalDaemon(defaultConfig);

    const secondCallArgs = mockSpawn.mock.calls[1];
    const args: string[] = secondCallArgs[1];
    expect(args).not.toContain('-a');

    daemon.stop();
  });

  it('calls SIGTERM on the process when daemon.stop() is called', async () => {
    const { getDaemonProc } = setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const daemon = await startSignalDaemon(defaultConfig);

    const daemonProc = getDaemonProc();
    expect(daemonProc.kill).not.toHaveBeenCalled();

    daemon.stop();

    expect(daemonProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects with crashed error if daemon process exits prematurely', async () => {
    // Spawns: first for version check (exits 0), second is the daemon
    let _daemonProc: ReturnType<typeof createMockProcess> | null = null;
    let spawnCallCount = 0;
    mockSpawn.mockImplementation(() => {
      spawnCallCount++;
      const proc = createMockProcess();
      if (spawnCallCount === 1) {
        process.nextTick(() => proc.emit('exit', 0, null));
      } else {
        _daemonProc = proc;
        // Emit exit AFTER a setTimeout so the race setup completes
        setTimeout(() => proc.emit('exit', 1, null), 5);
      }
      return proc;
    });

    // healthCheck never returns true (daemon exits before it can)
    mockHealthCheck.mockImplementation(() => new Promise(() => {})); // never resolves

    try {
      await startSignalDaemon(defaultConfig);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SignalDaemonError);
      expect((error as SignalDaemonError).errorType).toBe('crashed');
    }
  });

  it('rejects with spawn-failed if daemon process emits error event', async () => {
    let spawnCallCount = 0;
    mockSpawn.mockImplementation(() => {
      spawnCallCount++;
      const proc = createMockProcess();
      if (spawnCallCount === 1) {
        process.nextTick(() => proc.emit('exit', 0, null));
      } else {
        setTimeout(() => proc.emit('error', new Error('EACCES')), 5);
      }
      return proc;
    });

    mockHealthCheck.mockImplementation(() => new Promise(() => {})); // never resolves

    try {
      await startSignalDaemon(defaultConfig);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SignalDaemonError);
      expect((error as SignalDaemonError).errorType).toBe('spawn-failed');
    }
  });

  it('collects stderr output and includes it in crash error message', async () => {
    let spawnCallCount = 0;
    mockSpawn.mockImplementation(() => {
      spawnCallCount++;
      const proc = createMockProcess();
      if (spawnCallCount === 1) {
        process.nextTick(() => proc.emit('exit', 0, null));
      } else {
        setTimeout(() => {
          proc.stderr.emit('data', Buffer.from('ERROR: config file corrupt'));
          proc.emit('exit', 1, null);
        }, 5);
      }
      return proc;
    });

    mockHealthCheck.mockImplementation(() => new Promise(() => {})); // never resolves

    await expect(startSignalDaemon(defaultConfig)).rejects.toThrow(/config file corrupt/);
  });

  it('returns a daemon object with baseUrl, process, and stop()', async () => {
    setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const daemon = await startSignalDaemon(defaultConfig);

    expect(daemon.baseUrl).toBe('http://127.0.0.1:18080');
    expect(daemon.process).toBeDefined();
    expect(daemon.process.pid).toBe(12345);
    expect(typeof daemon.stop).toBe('function');

    daemon.stop();
  });

  it('waits for health check to pass before resolving', async () => {
    setupDaemonSpawn();

    // Health check fails first 3 times, then succeeds
    let healthCallCount = 0;
    mockHealthCheck.mockImplementation(async () => {
      healthCallCount++;
      return healthCallCount >= 4;
    });

    const daemon = await startSignalDaemon(defaultConfig);

    expect(healthCallCount).toBeGreaterThanOrEqual(4);

    daemon.stop();
  });

  it('throws timeout error when daemon never becomes healthy', async () => {
    setupDaemonSpawn();

    // waitForHealthy uses a `while (Date.now() - startedAt < maxWaitMs)` loop.
    // Since mockSleep resolves near-instantly, we must mock Date.now before the
    // function starts so the loop exits on its very first condition check.
    const baseTime = 1000000;
    const dateNowMock = vi.spyOn(Date, 'now');
    // First call (captures startedAt), second call (while condition) → already past
    dateNowMock
      .mockReturnValueOnce(baseTime)              // startedAt = baseTime
      .mockReturnValue(baseTime + 31_000);         // all subsequent: past 30s

    mockHealthCheck.mockResolvedValue(false);

    try {
      await startSignalDaemon(defaultConfig);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SignalDaemonError);
      expect((error as SignalDaemonError).errorType).toBe('timeout');
    }
  });

  it('stop() does not throw if process is already dead', async () => {
    setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const daemon = await startSignalDaemon(defaultConfig);

    // Make kill throw (simulating already-dead process)
    const daemonProc = daemon.process as unknown as ReturnType<typeof createMockProcess>;
    daemonProc.kill.mockImplementation(() => {
      throw new Error('kill ESRCH');
    });

    // stop() should not throw — it catches the error
    expect(() => daemon.stop()).not.toThrow();
  });

  it('spawns with correct stdio options', async () => {
    setupDaemonSpawn();
    mockHealthCheck.mockResolvedValue(true);

    const daemon = await startSignalDaemon(defaultConfig);

    // The daemon spawn call (second call) should use the correct stdio
    const secondCallArgs = mockSpawn.mock.calls[1];
    expect(secondCallArgs[2]).toEqual({
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    daemon.stop();
  });
});
