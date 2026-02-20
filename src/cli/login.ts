/**
 * MyndHyve CLI — Relay Login Command
 *
 * Authenticate with the messaging platform (e.g., scan QR for WhatsApp,
 * register phone for Signal).
 */

import { createLogger } from '../utils/logger.js';
import { loadConfiguredRelay } from '../config/loader.js';
import { getChannel, ensureChannelsLoaded } from '../channels/registry.js';

const log = createLogger('Login');

export async function loginCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;

  const config = loadConfiguredRelay();
  if (!config) {
    console.log(chalk.red('\n  Relay agent not configured. Run `myndhyve-cli relay setup` first.\n'));
    process.exitCode = 1;
    return;
  }

  const { channel } = config;
  await ensureChannelsLoaded();
  const plugin = getChannel(channel);

  if (!plugin) {
    console.log(chalk.red(`\n  Channel plugin "${channel}" not available.\n`));
    process.exitCode = 1;
    return;
  }

  if (!plugin.isSupported) {
    console.log(chalk.red(`\n  ${plugin.displayName} is not supported on this platform.`));
    if (plugin.unsupportedReason) {
      console.log(chalk.gray(`  ${plugin.unsupportedReason}`));
    }
    console.log();
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log(chalk.bold.cyan(`  Login to ${plugin.displayName}`));
  console.log();

  try {
    await plugin.login();
    log.info('Login successful', { channel });
    console.log(chalk.green(`\n  Authenticated with ${plugin.displayName}.`));
    console.log(chalk.gray(`  Run ${chalk.bold('myndhyve-cli relay start')} to begin relaying.\n`));
  } catch (error) {
    log.error('Login failed', error instanceof Error ? error : new Error(String(error)));
    console.error(chalk.red(`\n  Login failed: ${error instanceof Error ? error.message : String(error)}\n`));
    process.exitCode = 1;
  }
}
