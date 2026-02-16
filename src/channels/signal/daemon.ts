/**
 * MyndHyve CLI — Signal CLI Daemon Manager
 *
 * Spawns and manages the signal-cli JSON-RPC daemon process.
 * Monitors health and provides graceful shutdown.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../utils/logger.js';
import { sleep } from '../../utils/backoff.js';
import { healthCheck } from './client.js';
import type { SignalDaemonConfig } from './types.js';

const log = createLogger('Signal:Daemon');

// ============================================================================
// DAEMON LIFECYCLE
// ============================================================================

export interface SignalDaemon {
  /** The spawned child process */
  process: ChildProcess;
  /** The base URL for HTTP requests (e.g., http://127.0.0.1:18080) */
  baseUrl: string;
  /** Stop the daemon process */
  stop(): void;
}

/**
 * Start the signal-cli daemon in JSON-RPC HTTP mode.
 *
 * Spawns `signal-cli daemon --http HOST:PORT` and waits for it to become
 * responsive. Throws if signal-cli is not installed or fails to start.
 */
export async function startSignalDaemon(config: SignalDaemonConfig): Promise<SignalDaemon> {
  const { dataDir, account, host, port } = config;
  const baseUrl = `http://${host}:${port}`;

  // Check if signal-cli is installed
  const installed = await isSignalCliInstalled();
  if (!installed) {
    throw new SignalDaemonError(
      'signal-cli is not installed. Install it from https://github.com/AsamK/signal-cli',
      'not-installed'
    );
  }

  // Build command args
  const args: string[] = [
    '--config', dataDir,
  ];

  if (account) {
    args.push('-a', account);
  }

  args.push('daemon', '--http', `${host}:${port}`);

  log.info('Starting signal-cli daemon...', { host, port, dataDir });

  const child = spawn('signal-cli', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Collect stderr for error reporting
  let stderrBuffer = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuffer += text;
    // Limit buffer size
    if (stderrBuffer.length > 4096) {
      stderrBuffer = stderrBuffer.slice(-2048);
    }
    log.debug('signal-cli stderr', { text: text.trim() });
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    log.debug('signal-cli stdout', { text: chunk.toString().trim() });
  });

  // Handle premature exit
  const exitPromise = new Promise<never>((_resolve, reject) => {
    child.on('exit', (code, signal) => {
      reject(new SignalDaemonError(
        `signal-cli exited unexpectedly (code=${code}, signal=${signal}): ${stderrBuffer.trim().slice(-500)}`,
        'crashed'
      ));
    });
    child.on('error', (error) => {
      reject(new SignalDaemonError(
        `Failed to spawn signal-cli: ${error.message}`,
        'spawn-failed'
      ));
    });
  });

  // Wait for daemon to become healthy
  try {
    await Promise.race([
      waitForHealthy(baseUrl),
      exitPromise,
    ]);
  } catch (error) {
    // Kill the process if it's still running
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
    throw error;
  }

  log.info('signal-cli daemon is ready', { baseUrl });

  const daemon: SignalDaemon = {
    process: child,
    baseUrl,
    stop: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    },
  };

  return daemon;
}

/**
 * Wait for the signal-cli daemon to become responsive.
 * Polls the health endpoint every 500ms for up to 30 seconds.
 */
async function waitForHealthy(baseUrl: string): Promise<void> {
  const maxWaitMs = 30_000;
  const pollIntervalMs = 500;
  const maxIterations = Math.ceil(maxWaitMs / pollIntervalMs) + 10;
  const startedAt = Date.now();
  let iterations = 0;

  while (Date.now() - startedAt < maxWaitMs && iterations++ < maxIterations) {
    const healthy = await healthCheck(baseUrl);
    if (healthy) return;
    await sleep(pollIntervalMs);
  }

  throw new SignalDaemonError(
    `signal-cli daemon did not become responsive within ${maxWaitMs / 1000}s`,
    'timeout'
  );
}

// ============================================================================
// DETECTION
// ============================================================================

/**
 * Check if signal-cli is installed and accessible on PATH.
 */
export async function isSignalCliInstalled(): Promise<boolean> {
  try {
    const child = spawn('signal-cli', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return new Promise<boolean>((resolve) => {
      child.on('exit', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));

      // Timeout after 5 seconds
      setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        resolve(false);
      }, 5000);
    });
  } catch {
    return false;
  }
}

/**
 * Check if an account is registered (has data directory with account files).
 */
export function hasAccountData(dataDir: string, account?: string): boolean {
  if (!existsSync(dataDir)) return false;

  // If no specific account, just check the data dir exists
  if (!account) return true;

  // Check for account-specific data file
  // signal-cli stores accounts in data/accounts/<number>
  const accountDir = join(dataDir, 'data', 'accounts.d', account);
  return existsSync(accountDir);
}

// ============================================================================
// ERROR
// ============================================================================

export type DaemonErrorType =
  | 'not-installed'
  | 'spawn-failed'
  | 'timeout'
  | 'crashed';

export class SignalDaemonError extends Error {
  constructor(
    message: string,
    public readonly errorType: DaemonErrorType
  ) {
    super(message);
    this.name = 'SignalDaemonError';
  }
}
