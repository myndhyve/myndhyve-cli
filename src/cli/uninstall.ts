/**
 * MyndHyve CLI — Relay Uninstall Command
 *
 * Stops the daemon, clears all credentials and config,
 * removes the ~/.myndhyve-cli directory.
 */

import { existsSync, rmSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { getCliDir } from '../config/loader.js';
import { getChannel } from '../channels/registry.js';
import { loadConfig } from '../config/loader.js';
import { stopDaemon, getDaemonPid } from './daemon.js';

const log = createLogger('Uninstall');

export async function uninstallCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const inquirer = (await import('inquirer')).default;

  const relayDir = getCliDir();

  console.log();
  console.log(chalk.bold.yellow('  Uninstall MyndHyve CLI — Relay'));
  console.log();

  if (!existsSync(relayDir)) {
    console.log(chalk.gray('  Nothing to uninstall — no data directory found.'));
    console.log(chalk.gray(`  Expected at: ${relayDir}\n`));
    return;
  }

  console.log(chalk.gray('  This will:'));
  console.log(chalk.gray('    • Stop the relay daemon (if running)'));
  console.log(chalk.gray('    • Clear all messaging credentials'));
  console.log(chalk.gray('    • Remove all configuration and logs'));
  console.log(chalk.gray(`    • Delete ${relayDir}`));
  console.log();

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Are you sure you want to uninstall?',
    default: false,
  }]);

  if (!confirm) {
    console.log(chalk.gray('  Cancelled.\n'));
    return;
  }

  // Step 1: Stop daemon
  const daemonPid = getDaemonPid();
  if (daemonPid) {
    console.log(chalk.gray(`  Stopping daemon (PID ${daemonPid})...`));
    stopDaemon();
  }

  // Step 2: Logout from platform
  const config = loadConfig();
  if (config.channel) {
    const plugin = getChannel(config.channel);
    if (plugin) {
      try {
        console.log(chalk.gray(`  Clearing ${plugin.displayName} credentials...`));
        await plugin.logout();
      } catch (error) {
        log.warn('Failed to clear platform credentials', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Step 3: Remove data directory
  console.log(chalk.gray(`  Removing ${relayDir}...`));
  try {
    rmSync(relayDir, { recursive: true, force: true });
  } catch (error) {
    log.error('Failed to remove data directory', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(chalk.red(`\n  Failed to remove ${relayDir}.`));
    console.log(chalk.gray(`  You can remove it manually: rm -rf "${relayDir}"\n`));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.green('\n  Uninstalled. All relay data has been removed.'));
  console.log(chalk.gray('  To reinstall, run: myndhyve-cli relay setup\n'));
}
