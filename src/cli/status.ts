/**
 * MyndHyve CLI — Relay Status Command
 *
 * Display current configuration and connection status.
 */

import { loadConfig, isConfigured, getCliDir } from '../config/loader.js';
import { getChannel } from '../channels/registry.js';
import { getDaemonPid, getLogFilePath } from './daemon.js';

export async function statusCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;

  console.log();
  console.log(chalk.bold.cyan('  MyndHyve CLI — Relay Status'));
  console.log();

  if (!isConfigured()) {
    console.log(chalk.yellow('  Not configured.'));
    console.log(chalk.gray(`  Run ${chalk.bold('myndhyve-cli relay setup')} to get started.`));
    console.log();
    return;
  }

  const config = loadConfig();

  // Daemon status
  const daemonPid = getDaemonPid();
  if (daemonPid) {
    console.log(chalk.gray('  Daemon:        ') + chalk.green(`running (PID ${daemonPid})`));
  } else {
    console.log(chalk.gray('  Daemon:        ') + chalk.yellow('not running'));
  }

  // Basic info
  console.log(chalk.gray('  Config dir:    ') + getCliDir());
  console.log(chalk.gray('  Log file:      ') + getLogFilePath());
  console.log(chalk.gray('  Server:        ') + config.server.baseUrl);
  console.log(chalk.gray('  Channel:       ') + chalk.bold(config.channel));
  console.log(chalk.gray('  Relay ID:      ') + (config.relayId ?? 'not set'));
  console.log(chalk.gray('  Device token:  ') + (config.deviceToken ? chalk.green('present') : chalk.red('missing')));
  console.log();

  // Channel plugin info
  const plugin = config.channel ? getChannel(config.channel) : undefined;

  if (plugin) {
    console.log(chalk.gray('  Platform:      ') + plugin.displayName);
    console.log(chalk.gray('  Supported:     ') + (plugin.isSupported ? chalk.green('yes') : chalk.red(`no — ${plugin.unsupportedReason}`)));
    console.log(chalk.gray('  Status:        ') + plugin.getStatus());

    try {
      const authed = await plugin.isAuthenticated();
      console.log(chalk.gray('  Authenticated: ') + (authed ? chalk.green('yes') : chalk.yellow('no')));
    } catch {
      console.log(chalk.gray('  Authenticated: ') + chalk.red('error checking'));
    }
  } else {
    console.log(chalk.yellow(`  Channel plugin "${config.channel}" not loaded.`));
  }

  // Config details
  console.log();
  console.log(chalk.gray('  Heartbeat:     ') + `every ${config.heartbeat.intervalSeconds}s`);
  console.log(chalk.gray('  Outbound poll: ') + `every ${config.outbound.pollIntervalSeconds}s`);
  console.log(chalk.gray('  Log level:     ') + config.logging.level);
  console.log();
}
