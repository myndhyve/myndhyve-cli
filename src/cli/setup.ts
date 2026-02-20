/**
 * MyndHyve CLI — Relay Setup Command
 *
 * Interactive setup wizard: pick channel, sign in, register, activate.
 */

import { createLogger } from '../utils/logger.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import {
  loadConfig,
  saveConfig,
  isConfigured,
  ensureCliDir,
} from '../config/loader.js';
import { RelayClient } from '../relay/client.js';
import { CLI_VERSION } from '../config/defaults.js';
import type { RelayChannel } from '../relay/types.js';

const log = createLogger('Setup');

export async function setupCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const inquirer = (await import('inquirer')).default;
  const ora = (await import('ora')).default;

  console.log();
  console.log(chalk.bold.cyan('  MyndHyve CLI — Relay Setup'));
  console.log(chalk.gray('  Bridge your messaging platforms to MyndHyve AI agents'));
  console.log();

  // Check if already configured
  if (isConfigured()) {
    const config = loadConfig();
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: `Already configured for ${chalk.bold(config.channel)} (relay: ${config.relayId?.slice(0, 8)}...). Reconfigure?`,
      default: false,
    }]);

    if (!overwrite) {
      console.log(chalk.gray('  Setup cancelled. Use `myndhyve-cli relay start` to begin relaying.'));
      return;
    }
  }

  // Step 1: Choose channel
  const { channel } = await inquirer.prompt([{
    type: 'list',
    name: 'channel',
    message: 'Which messaging platform do you want to bridge?',
    choices: [
      { name: 'Signal  (recommended — no ban risk)', value: 'signal' },
      { name: 'WhatsApp (uses unofficial API — use at own risk)', value: 'whatsapp' },
      { name: 'iMessage (macOS only)', value: 'imessage' },
    ],
  }]);

  // Platform-specific warnings
  if (channel === 'whatsapp') {
    console.log();
    console.log(chalk.yellow('  Warning: WhatsApp uses the unofficial Baileys library.'));
    console.log(chalk.yellow('  Meta may ban your number. Use a secondary number.'));
    console.log();
    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: 'Continue with WhatsApp?',
      default: false,
    }]);
    if (!proceed) return;
  }

  if (channel === 'imessage' && process.platform !== 'darwin') {
    printErrorResult({
      code: 'UNSUPPORTED_PLATFORM',
      message: 'iMessage is only available on macOS.',
    });
    return;
  }

  // Step 2: Get Firebase auth token
  console.log();
  console.log(chalk.gray('  To connect your MyndHyve account, paste your auth token below.'));
  console.log(chalk.gray('  Get it from: MyndHyve > Settings > Messaging > Copy Auth Token'));
  console.log();

  const { idToken } = await inquirer.prompt([{
    type: 'password',
    name: 'idToken',
    message: 'Auth token:',
    mask: '*',
    validate: (input: string) => input.length > 10 || 'Please paste a valid auth token',
  }]);

  // Step 3: Label
  const { label } = await inquirer.prompt([{
    type: 'input',
    name: 'label',
    message: 'Device label (e.g., "MacBook Pro"):',
    default: `${process.platform}-${process.arch}`,
  }]);

  // Step 4: Register
  const config = loadConfig();
  const client = new RelayClient(config.server.baseUrl);

  const registerSpinner = ora('Registering relay device...').start();

  let registration: Awaited<ReturnType<typeof client.register>>;
  try {
    registration = await client.register(channel, label, idToken);
    registerSpinner.succeed(
      `Registered! Relay ID: ${chalk.bold(registration.relayId.slice(0, 12))}...`
    );
  } catch (error) {
    registerSpinner.fail('Registration failed');
    log.error('Setup failed', error instanceof Error ? error : new Error(String(error)));
    printErrorResult({
      code: 'REGISTRATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = ExitCode.GENERAL_ERROR;
    return;
  }

  // Step 5: Activate
  const activateSpinner = ora('Activating...').start();

  try {
    const activation = await client.activate(
      registration.relayId,
      registration.activationCode,
      CLI_VERSION,
      {
        os: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        bridgeVersion: CLI_VERSION,
      }
    );

    activateSpinner.succeed('Device activated');

    // Step 6: Save config
    ensureCliDir();
    saveConfig({
      ...config,
      channel: channel as RelayChannel,
      relayId: registration.relayId,
      deviceToken: activation.deviceToken,
      tokenExpiresAt: activation.tokenExpiresAt,
      heartbeat: {
        ...config.heartbeat,
        intervalSeconds: activation.heartbeatIntervalSeconds,
      },
      outbound: {
        ...config.outbound,
        pollIntervalSeconds: activation.outboundPollIntervalSeconds,
      },
    });

    log.info('Setup complete', { channel, relayId: registration.relayId });

    console.log();
    console.log(chalk.green.bold('  Setup complete!'));
    console.log();
    console.log(chalk.gray('  Next steps:'));
    console.log(chalk.gray(`    1. Run ${chalk.bold('myndhyve-cli relay login')} to authenticate with ${channel}`));
    console.log(chalk.gray(`    2. Run ${chalk.bold('myndhyve-cli relay start')} to begin relaying messages`));
    console.log();
  } catch (error) {
    activateSpinner.fail('Activation failed');
    log.error('Setup failed', error instanceof Error ? error : new Error(String(error)));
    printErrorResult({
      code: 'ACTIVATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}
