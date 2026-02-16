/**
 * MyndHyve CLI — Relay Logout Command
 *
 * Clear stored credentials and optionally revoke the relay device.
 */

import { createLogger } from '../utils/logger.js';
import { loadConfiguredRelay, saveConfig } from '../config/loader.js';
import { getChannel } from '../channels/registry.js';

const log = createLogger('Logout');

export async function logoutCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const inquirer = (await import('inquirer')).default;

  const config = loadConfiguredRelay();
  if (!config) {
    console.log(chalk.yellow('\n  Not configured. Nothing to log out from.\n'));
    return;
  }

  const { channel } = config;

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `Log out from ${channel} and clear credentials?`,
    default: false,
  }]);

  if (!confirm) {
    console.log(chalk.gray('  Cancelled.\n'));
    return;
  }

  // Clear platform credentials
  const plugin = getChannel(channel);
  if (plugin) {
    try {
      await plugin.logout();
      log.info('Platform credentials cleared', { channel });
    } catch (error) {
      log.warn('Failed to clear platform credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Clear relay config (keep server URL and defaults)
  saveConfig({
    ...config,
    channel: undefined,
    relayId: undefined,
    deviceToken: undefined,
    userId: undefined,
  });

  console.log(chalk.green('\n  Logged out and credentials cleared.\n'));
}
