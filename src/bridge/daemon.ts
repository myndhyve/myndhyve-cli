/**
 * MyndHyve CLI — Bridge Daemon Management
 *
 * PID file + log file based daemon control for the bridge process.
 * Separate from the relay daemon — uses bridge.pid and bridge.log.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getCliDir, getLogDir, ensureCliDir, ensureLogDir } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BridgeDaemon');

// ============================================================================
// PATHS
// ============================================================================

export function getBridgePidPath(): string {
  return join(getCliDir(), 'bridge.pid');
}

export function getBridgeLogPath(): string {
  return join(getLogDir(), 'bridge.log');
}

function ensureBridgeLogFile(): string {
  return join(ensureLogDir(), 'bridge.log');
}

// ============================================================================
// PID FILE
// ============================================================================

function readPidFile(): number | null {
  const pidPath = getBridgePidPath();
  if (!existsSync(pidPath)) return null;

  try {
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(pid: number): void {
  ensureCliDir();
  writeFileSync(getBridgePidPath(), String(pid), { mode: 0o600 });
}

function removePidFile(): void {
  const pidPath = getBridgePidPath();
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // File may already be gone
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Check if the bridge daemon is running.
 * Returns the PID if running, null otherwise.
 */
export function getBridgeDaemonPid(): number | null {
  const pid = readPidFile();
  if (pid === null) return null;

  if (isProcessAlive(pid)) return pid;

  // Stale PID file
  removePidFile();
  return null;
}

/**
 * Spawn the bridge daemon as a detached background process.
 */
export function spawnBridgeDaemon(projectRoot: string, verbose?: boolean): number {
  const existing = getBridgeDaemonPid();
  if (existing) {
    throw new Error(`Bridge daemon already running (PID ${existing}). Stop it first with: myndhyve-cli bridge stop`);
  }

  const entryPoint = process.argv[1];
  const args = ['bridge', 'start', projectRoot];
  if (verbose) args.push('--verbose');

  const logFile = ensureBridgeLogFile();
  const outFd = openSync(logFile, 'a');

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [entryPoint, ...args], {
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: {
        ...process.env,
        MYNDHYVE_CLI_BRIDGE_DAEMON: '1',
      },
    });
  } finally {
    closeSync(outFd);
  }

  if (!child.pid) {
    throw new Error('Failed to spawn bridge daemon');
  }

  writePidFile(child.pid);
  child.unref();

  log.debug('Bridge daemon spawned', { pid: child.pid, logFile, projectRoot });
  return child.pid;
}

/**
 * Stop the bridge daemon.
 */
export function stopBridgeDaemon(): boolean {
  const pid = getBridgeDaemonPid();
  if (pid === null) return false;

  try {
    process.kill(pid, 'SIGTERM');
    removePidFile();
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ESRCH') {
      removePidFile();
      return false;
    }
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
