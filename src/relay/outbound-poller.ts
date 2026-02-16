/**
 * MyndHyve CLI — Outbound Message Poller
 *
 * Polls for outbound messages from MyndHyve and delivers them
 * to the local messaging platform.
 */

import type { RelayClient } from './client.js';
import type { OutboundMessage, ChatEgressEnvelope, DeliveryResult } from './types.js';
import type { OutboundConfig } from '../config/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OutboundPoller');

export type DeliverFunction = (envelope: ChatEgressEnvelope) => Promise<DeliveryResult>;

export interface OutboundPollerOptions {
  relayClient: RelayClient;
  relayId: string;
  config: OutboundConfig;
  deliver: DeliverFunction;
  signal?: AbortSignal;
}

/**
 * Start the outbound polling loop. Polls for messages, delivers them,
 * and acknowledges delivery.
 */
export async function startOutboundPoller(options: OutboundPollerOptions): Promise<void> {
  const { relayClient, relayId, config, deliver, signal } = options;
  const intervalMs = config.pollIntervalSeconds * 1000;

  log.info('Starting outbound poller', { pollIntervalSeconds: config.pollIntervalSeconds });

  while (!signal?.aborted) {
    try {
      const messages = await relayClient.pollOutbound(relayId);

      for (const msg of messages) {
        if (signal?.aborted) break;
        await processOutboundMessage(relayClient, msg, deliver);
      }
    } catch (error) {
      log.warn('Outbound poll failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Wait for the next poll or abort
    await new Promise<void>((resolve) => {
      const onAbort = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, intervalMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  log.info('Outbound poller stopped');
}

async function processOutboundMessage(
  relayClient: RelayClient,
  msg: OutboundMessage,
  deliver: DeliverFunction
): Promise<void> {
  const startTime = Date.now();

  try {
    log.info('Delivering outbound message', {
      messageId: msg.id,
      conversationId: msg.envelope.conversationId,
    });

    const result = await deliver(msg.envelope);
    const durationMs = Date.now() - startTime;

    await relayClient.ackOutbound({
      outboundMessageId: msg.id,
      success: result.success,
      platformMessageId: result.platformMessageId,
      error: result.error,
      retryable: result.retryable,
      durationMs,
    });

    if (result.success) {
      log.info('Outbound message delivered', { messageId: msg.id, durationMs });
    } else {
      log.warn('Outbound delivery failed', { messageId: msg.id, error: result.error });
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Outbound delivery error', {
      messageId: msg.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Try to ack the failure
    try {
      await relayClient.ackOutbound({
        outboundMessageId: msg.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
        durationMs,
      });
    } catch {
      log.warn('Failed to ack outbound delivery failure', { messageId: msg.id });
    }
  }
}
