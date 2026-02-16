/**
 * MyndHyve CLI — Relay Stop Command
 *
 * Stops the background relay daemon if running.
 */

import { getDaemonPid, stopDaemon } from './daemon.js';

export async function stopCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;

  const pid = getDaemonPid();

  if (pid === null) {
    console.log(chalk.yellow('\n  Relay daemon is not running.\n'));
    return;
  }

  console.log(chalk.gray(`  Stopping relay daemon (PID ${pid})...`));

  const stopped = stopDaemon();

  if (stopped) {
    console.log(chalk.green('\n  Relay daemon stopped.\n'));
  } else {
    console.log(chalk.yellow('\n  Daemon was not running (stale PID file cleaned up).\n'));
  }
}
