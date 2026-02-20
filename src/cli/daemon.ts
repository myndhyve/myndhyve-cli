/**
 * MyndHyve CLI — Daemon Management
 *
 * PID file + log file based daemon control.
 * Uses detached child_process.spawn() for cross-platform background execution.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getCliDir, getLogDir, ensureCliDir, ensureLogDir } from '../config/loader.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Daemon');

// ============================================================================
// PATHS
// ============================================================================

export function getPidFilePath(): string {
  return join(getCliDir(), 'relay.pid');
}

/** Returns the log file path (read-only — does NOT create directories). */
export function getLogFilePath(): string {
  return join(getLogDir(), 'relay.log');
}

/** Returns the log file path, creating the log directory if needed. */
export function ensureLogFile(): string {
  return join(ensureLogDir(), 'relay.log');
}

// ============================================================================
// PID FILE
// ============================================================================

/**
 * Read the PID from the PID file.
 * Returns null if the file doesn't exist or is invalid.
 */
export function readPidFile(): number | null {
  const pidPath = getPidFilePath();
  if (!existsSync(pidPath)) return null;

  try {
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Write a PID to the PID file.
 */
export function writePidFile(pid: number): void {
  ensureCliDir();
  writeFileSync(getPidFilePath(), String(pid), { mode: 0o600 });
}

/**
 * Remove the PID file.
 */
export function removePidFile(): void {
  const pidPath = getPidFilePath();
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // Ignore — file may already be gone
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

// ============================================================================
// PROCESS MANAGEMENT
// ============================================================================

/**
 * Check if a process with the given PID is alive.
 * Uses `process.kill(pid, 0)` — sends no signal, just checks existence.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the daemon is currently running.
 * Returns the PID if running, null otherwise.
 * Cleans up stale PID files.
 */
export function getDaemonPid(): number | null {
  const pid = readPidFile();
  if (pid === null) return null;

  if (isProcessAlive(pid)) {
    return pid;
  }

  // Stale PID file — process is gone
  removePidFile();
  return null;
}

/**
 * Spawn the relay agent as a detached background process.
 *
 * Redirects stdout/stderr to the log file. The parent process
 * can exit immediately after spawning.
 *
 * @returns The child process PID.
 */
export function spawnDaemon(verbose?: boolean): number {
  // Resolve the entry point — walk up from this file to find bin/myndhyve-cli.js
  // In production: the binary is invoked directly
  // In development: node runs src/index.ts or dist/index.js
  const entryPoint = process.argv[1];
  const args = ['relay', 'start']; // Run the relay start command in foreground mode
  if (verbose) args.push('--verbose');

  const logFile = ensureLogFile();
  const outFd = openSync(logFile, 'a');

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [entryPoint, ...args], {
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: {
        ...process.env,
        MYNDHYVE_CLI_DAEMON: '1', // Signal to start.ts that we're in daemon mode
      },
    });
  } finally {
    closeSync(outFd); // Parent no longer needs this FD — child has its own copy
  }

  if (!child.pid) {
    throw new Error('Failed to spawn daemon process');
  }

  writePidFile(child.pid);
  child.unref();

  log.debug('Daemon spawned', { pid: child.pid, logFile });

  return child.pid;
}

/**
 * Stop the daemon by sending SIGTERM.
 * Returns true if the process was stopped, false if it wasn't running.
 */
export function stopDaemon(): boolean {
  const pid = getDaemonPid();
  if (pid === null) return false;

  try {
    process.kill(pid, 'SIGTERM');
    removePidFile();
    return true;
  } catch (error) {
    // ESRCH = no such process (already dead)
    if (isErrnoException(error) && error.code === 'ESRCH') {
      removePidFile();
      return false;
    }
    throw error;
  }
}
