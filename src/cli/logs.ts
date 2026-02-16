/**
 * MyndHyve CLI — Relay Logs Command
 *
 * Tail the relay daemon log file.
 */

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { getLogFilePath, getDaemonPid } from './daemon.js';

/** Number of bytes to read from the tail of the file on first load. */
const INITIAL_TAIL_BYTES = 8192;

export async function logsCommand(options: {
  follow?: boolean;
  lines?: string;
}): Promise<void> {
  const chalk = (await import('chalk')).default;
  const logFile = getLogFilePath();

  if (!existsSync(logFile)) {
    console.log(chalk.yellow('\n  No log file found.'));
    console.log(chalk.gray(`  Expected at: ${logFile}`));
    console.log(chalk.gray('  Start the daemon first: myndhyve-cli relay start --daemon\n'));
    return;
  }

  // Show daemon status
  const daemonPid = getDaemonPid();
  if (daemonPid) {
    console.log(chalk.gray(`  Daemon running (PID ${daemonPid})`));
  } else {
    console.log(chalk.gray('  Daemon not running'));
  }
  console.log(chalk.gray(`  Log file: ${logFile}\n`));

  // Read initial tail
  const numLines = parseInt(options.lines ?? '50', 10) || 50;
  const tailContent = readTail(logFile, numLines);
  if (tailContent) {
    process.stdout.write(tailContent);
  }

  // Follow mode — watch for new content
  if (options.follow) {
    await followLog(logFile);
  }
}

/**
 * Read the last N lines from a file.
 * Only reads the tail of the file (up to INITIAL_TAIL_BYTES) to avoid
 * loading large log files entirely into memory.
 */
function readTail(filePath: string, lines: number): string {
  const stat = statSync(filePath);
  if (stat.size === 0) return '';

  // Read only the tail of the file
  const readBytes = Math.min(stat.size, INITIAL_TAIL_BYTES);
  const startOffset = stat.size - readBytes;
  const buf = Buffer.alloc(readBytes);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buf, 0, readBytes, startOffset);
  } finally {
    closeSync(fd);
  }
  const content = buf.toString('utf-8');

  const allLines = content.split('\n');
  // If we started mid-file, the first line is likely partial — drop it
  if (startOffset > 0 && allLines.length > 1) {
    allLines.shift();
  }
  const lastLines = allLines.slice(-lines - 1); // -1 to account for trailing newline
  return lastLines.join('\n');
}

/**
 * Follow a log file for new content (like `tail -f`).
 * Blocks until SIGINT/SIGTERM.
 */
async function followLog(filePath: string): Promise<void> {
  const controller = new AbortController();

  const shutdown = () => {
    controller.abort();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    const handle = await open(filePath, 'r');
    let offset = statSync(filePath).size;

    while (!controller.signal.aborted) {
      // Wait a bit between checks
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });

      if (controller.signal.aborted) break;

      // Check for new content
      const currentSize = statSync(filePath).size;
      if (currentSize > offset) {
        const buf = Buffer.alloc(currentSize - offset);
        await handle.read(buf, 0, buf.length, offset);
        process.stdout.write(buf.toString('utf-8'));
        offset = currentSize;
      } else if (currentSize < offset) {
        // File was truncated/rotated — start from beginning
        offset = 0;
      }
    }

    await handle.close();
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}
