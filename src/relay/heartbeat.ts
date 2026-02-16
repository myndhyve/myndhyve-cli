/**
 * MyndHyve CLI — Heartbeat Loop
 *
 * Sends periodic heartbeats to keep the relay device active.
 * Server marks device as 'disconnected' if heartbeats stop.
 */

import type { RelayClient } from './client.js';
import type { HeartbeatConfig } from '../config/types.js';
import { createLogger } from '../utils/logger.js';
import { CLI_VERSION } from '../config/defaults.js';

const log = createLogger('Heartbeat');

export interface HeartbeatLoopOptions {
  relayClient: RelayClient;
  relayId: string;
  config: HeartbeatConfig;
  getPlatformStatus: () => string;
  getUptimeSeconds: () => number;
  signal?: AbortSignal;
}

/**
 * Start the heartbeat loop. Runs until the signal is aborted.
 */
export async function startHeartbeatLoop(options: HeartbeatLoopOptions): Promise<void> {
  const { relayClient, relayId, config, getPlatformStatus, getUptimeSeconds, signal } = options;
  const intervalMs = config.intervalSeconds * 1000;

  log.info('Starting heartbeat loop', { intervalSeconds: config.intervalSeconds });

  while (!signal?.aborted) {
    try {
      const response = await relayClient.heartbeat(relayId, {
        version: CLI_VERSION,
        platformStatus: getPlatformStatus(),
        uptimeSeconds: getUptimeSeconds(),
      });

      if (response.hasPendingOutbound) {
        log.debug('Server indicates pending outbound messages');
      }
    } catch (error) {
      log.warn('Heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw — heartbeat failures are non-fatal
    }

    // Wait for the next interval or abort
    await new Promise<void>((resolve) => {
      const onAbort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, intervalMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  log.info('Heartbeat loop stopped');
}
