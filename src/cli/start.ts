/**
 * MyndHyve CLI — Relay Start Command
 *
 * Connects to the messaging platform and begins the relay loop:
 * heartbeat + outbound poller + inbound forwarding.
 */

import { createLogger, setLogLevel } from '../utils/logger.js';
import { loadConfiguredRelay } from '../config/loader.js';
import { RelayClient, RelayClientError } from '../relay/client.js';
import { startHeartbeatLoop } from '../relay/heartbeat.js';
import { startOutboundPoller } from '../relay/outbound-poller.js';
import { getChannel, ensureChannelsLoaded } from '../channels/registry.js';
import { computeBackoff, isMaxAttemptsReached, sleep } from '../utils/backoff.js';
import { spawnDaemon, getDaemonPid } from './daemon.js';

const log = createLogger('Start');

/** If the try block ran longer than this, reset the reconnection attempt counter. */
const STABLE_CONNECTION_THRESHOLD_MS = 60_000;

export async function startCommand(options: {
  verbose?: boolean;
  daemon?: boolean;
}): Promise<void> {
  const chalk = (await import('chalk')).default;

  if (options.verbose) {
    setLogLevel('debug');
  }

  // Handle daemon mode: spawn a background process and exit
  if (options.daemon) {
    const existingPid = getDaemonPid();
    if (existingPid) {
      console.log(chalk.yellow(`\n  Daemon already running (PID ${existingPid}).`));
      console.log(chalk.gray('  Use `myndhyve-cli relay stop` to stop it first.\n'));
      return;
    }

    try {
      const pid = spawnDaemon(options.verbose);
      console.log(chalk.green(`\n  Relay daemon started (PID ${pid}).`));
      console.log(chalk.gray('  Use `myndhyve-cli relay logs -f` to watch output.'));
      console.log(chalk.gray('  Use `myndhyve-cli relay stop` to stop.\n'));
    } catch (error) {
      console.log(chalk.red(`\n  Failed to start daemon: ${error instanceof Error ? error.message : String(error)}\n`));
      process.exitCode = 1;
    }
    return;
  }

  // Pre-flight checks
  const config = loadConfiguredRelay();
  if (!config) {
    console.log(chalk.red('\n  Relay agent not configured. Run `myndhyve-cli relay setup` first.\n'));
    process.exitCode = 1;
    return;
  }

  setLogLevel(config.logging.level);

  const { channel, relayId, deviceToken } = config;

  // Lazy-load channel plugins (only needed for relay commands)
  await ensureChannelsLoaded();
  const plugin = getChannel(channel);

  if (!plugin) {
    console.log(chalk.red(`\n  Channel plugin "${channel}" not available.`));
    console.log(chalk.gray('  Make sure the channel plugin is installed.\n'));
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

  // Check authentication
  const isAuthed = await plugin.isAuthenticated();
  if (!isAuthed) {
    console.log(chalk.yellow(`\n  Not authenticated with ${plugin.displayName}.`));
    console.log(chalk.gray(`  Run ${chalk.bold('myndhyve-cli relay login')} first.\n`));
    process.exitCode = 1;
    return;
  }

  // Set up graceful shutdown
  const controller = new AbortController();
  const { signal } = controller;

  const shutdown = () => {
    log.info('Shutting down...');
    controller.abort();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const client = new RelayClient(config.server.baseUrl, deviceToken, config.tokenExpiresAt);
  const startTime = Date.now();

  console.log();
  console.log(chalk.bold.cyan(`  MyndHyve CLI — Relay (${plugin.displayName})`));
  console.log(chalk.gray(`  Relay ID: ${relayId.slice(0, 12)}...`));
  console.log(chalk.gray('  Press Ctrl+C to stop\n'));

  // Reconnection loop
  let attempt = 0;

  try {
    while (!signal.aborted) {
      const tryStartedAt = Date.now();
      try {
        log.info('Connecting to platform...', { channel, attempt });

        // Start channel + heartbeat + outbound poller concurrently
        await Promise.all([
          plugin.start(
            async (envelope) => {
              try {
                await client.sendInbound(relayId, envelope);
              } catch (error) {
                log.warn('Failed to forward inbound message', {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            },
            signal
          ),
          startHeartbeatLoop({
            relayClient: client,
            relayId,
            config: config.heartbeat,
            getPlatformStatus: () => plugin.getStatus(),
            getUptimeSeconds: () => Math.floor((Date.now() - startTime) / 1000),
            signal,
          }),
          startOutboundPoller({
            relayClient: client,
            relayId,
            config: config.outbound,
            deliver: (envelope) => plugin.deliver(envelope),
            signal,
          }),
        ]);

        // If we get here cleanly (no error), we're done (abort was called)
        break;
      } catch (error) {
        if (signal.aborted) break;

        // Device token expired — reconnecting won't help, need re-setup
        if (error instanceof RelayClientError && error.code === 'DEVICE_TOKEN_EXPIRED') {
          log.error('Device token expired');
          console.log(chalk.red('\n  Device token has expired.'));
          console.log(chalk.gray('  Run `myndhyve-cli relay setup` to re-register.\n'));
          process.exitCode = 1;
          break;
        }

        // If connection was stable for a while, reset the attempt counter
        // so transient disconnections don't accumulate over weeks of uptime
        if (Date.now() - tryStartedAt > STABLE_CONNECTION_THRESHOLD_MS) {
          attempt = 0;
        }

        attempt++;
        log.error('Connection lost', {
          error: error instanceof Error ? error.message : String(error),
          attempt,
        });

        if (isMaxAttemptsReached(config.reconnect, attempt)) {
          log.error('Max reconnection attempts reached. Giving up.');
          process.exitCode = 1;
          break;
        }

        const delay = computeBackoff(config.reconnect, attempt);
        log.info('Reconnecting...', { delayMs: delay, attempt });
        await sleep(delay);
      }
    }
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }

  log.info('Relay agent stopped');
  console.log(chalk.gray('\n  Relay agent stopped.\n'));
}
