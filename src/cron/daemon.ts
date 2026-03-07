/**
 * MyndHyve CLI — Scheduler Daemon Management
 *
 * PID file + log file based daemon control for the cron scheduler.
 * Uses detached child_process.spawn() for cross-platform background execution.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { getCliDir, ensureCliDir } from '../config/loader.js';
import { getCronDir } from './store.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CronDaemon');

// ============================================================================
// PATHS
// ============================================================================

export function getSchedulerPidFilePath(): string {
  return join(getCliDir(), 'scheduler.pid');
}

/** Returns the log file path (read-only — does NOT create directories). */
export function getSchedulerLogFilePath(): string {
  return join(getCronDir(), 'scheduler.log');
}

/** Returns the log file path, creating the cron directory if needed. */
export function ensureSchedulerLogFile(): string {
  return join(getCronDir(), 'scheduler.log');
}

// ============================================================================
// PID FILE
// ============================================================================

/**
 * Read the PID from the scheduler PID file.
 * Returns null if the file doesn't exist or is invalid.
 */
export function readSchedulerPidFile(): number | null {
  const pidPath = getSchedulerPidFilePath();
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
 * Write a PID to the scheduler PID file.
 */
export function writeSchedulerPidFile(pid: number): void {
  ensureCliDir();
  writeFileSync(getSchedulerPidFilePath(), String(pid), { mode: 0o600 });
}

/**
 * Remove the scheduler PID file.
 */
export function removeSchedulerPidFile(): void {
  const pidPath = getSchedulerPidFilePath();
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
export function isSchedulerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the scheduler is currently running.
 * Returns the PID if running, null otherwise.
 * Cleans up stale PID files.
 */
export function getSchedulerPid(): number | null {
  const pid = readSchedulerPidFile();
  if (pid === null) return null;

  if (isSchedulerAlive(pid)) {
    return pid;
  }

  // Stale PID file — process is gone
  removeSchedulerPidFile();
  return null;
}

/**
 * Spawn the scheduler as a detached background process.
 *
 * Redirects stdout/stderr to the log file. The parent process
 * can exit immediately after spawning.
 *
 * @returns The child process PID.
 */
export function spawnScheduler(options?: { allowShell?: boolean }): number {
  const entryPoint = process.argv[1];
  const args = ['cron', 'start', '--foreground'];
  if (options?.allowShell) args.push('--allow-shell');

  const logFile = ensureSchedulerLogFile();
  const outFd = openSync(logFile, 'a');

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [entryPoint, ...args], {
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: {
        ...process.env,
        MYNDHYVE_CLI_SCHEDULER: '1',
      },
    });
  } finally {
    closeSync(outFd); // Parent no longer needs this FD — child has its own copy
  }

  if (!child.pid) {
    throw new Error('Failed to spawn scheduler process');
  }

  writeSchedulerPidFile(child.pid);
  child.unref();

  log.debug('Scheduler spawned', { pid: child.pid, logFile });

  return child.pid;
}

/**
 * Stop the scheduler by sending SIGTERM.
 * Returns true if the process was stopped, false if it wasn't running.
 */
export function stopScheduler(): boolean {
  const pid = getSchedulerPid();
  if (pid === null) return false;

  try {
    process.kill(pid, 'SIGTERM');
    removeSchedulerPidFile();
    return true;
  } catch (error) {
    // ESRCH = no such process (already dead)
    if (isErrnoException(error) && error.code === 'ESRCH') {
      removeSchedulerPidFile();
      return false;
    }
    throw error;
  }
}
