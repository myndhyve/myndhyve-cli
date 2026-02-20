/**
 * MyndHyve CLI — Outbound Message Poller
 *
 * Polls for outbound messages from MyndHyve and delivers them
 * to the local messaging platform.
 */

import { type RelayClient, RelayClientError } from './client.js';
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
 * Tracks recently delivered message IDs to prevent duplicate delivery.
 *
 * If deliver() succeeds but the subsequent ack() fails (network blip),
 * the server re-queues the message. Without this guard, the next poll
 * would deliver it a second time.
 *
 * Bounded to MAX_DELIVERED_CACHE_SIZE to prevent unbounded memory growth.
 */
const MAX_DELIVERED_CACHE_SIZE = 1000;

/**
 * Start the outbound polling loop. Polls for messages, delivers them,
 * and acknowledges delivery.
 */
export async function startOutboundPoller(options: OutboundPollerOptions): Promise<void> {
  const { relayClient, relayId, config, deliver, signal } = options;
  const intervalMs = config.pollIntervalSeconds * 1000;
  const deliveredIds = new Set<string>();

  log.info('Starting outbound poller', { pollIntervalSeconds: config.pollIntervalSeconds });

  while (!signal?.aborted) {
    try {
      const messages = await relayClient.pollOutbound(relayId);

      for (const msg of messages) {
        if (signal?.aborted) break;

        // Skip messages already delivered (ack may have failed on previous cycle)
        if (deliveredIds.has(msg.id)) {
          log.debug('Skipping already-delivered message', { messageId: msg.id });
          // Re-ack so the server stops re-queuing it
          try {
            await relayClient.ackOutbound({
              outboundMessageId: msg.id,
              success: true,
              durationMs: 0,
            });
          } catch {
            log.debug('Re-ack failed for duplicate message', { messageId: msg.id });
          }
          continue;
        }

        await processOutboundMessage(relayClient, msg, deliver, deliveredIds);
      }
    } catch (error) {
      // Device token expiry is fatal — propagate to trigger re-setup
      if (error instanceof RelayClientError && error.code === 'DEVICE_TOKEN_EXPIRED') {
        throw error;
      }
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
  deliver: DeliverFunction,
  deliveredIds: Set<string>
): Promise<void> {
  const startTime = Date.now();

  try {
    log.info('Delivering outbound message', {
      messageId: msg.id,
      conversationId: msg.envelope.conversationId,
    });

    const result = await deliver(msg.envelope);
    const durationMs = Date.now() - startTime;

    // Record successful delivery BEFORE ack — if ack fails, we still
    // know the message was delivered and can skip it on the next poll.
    if (result.success) {
      trackDeliveredId(deliveredIds, msg.id);
    }

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

/** Add a message ID to the delivered set, evicting oldest entries if at capacity. */
function trackDeliveredId(deliveredIds: Set<string>, id: string): void {
  deliveredIds.add(id);
  if (deliveredIds.size > MAX_DELIVERED_CACHE_SIZE) {
    // Set iteration order is insertion order — delete the oldest entry
    const oldest = deliveredIds.values().next().value;
    if (oldest !== undefined) {
      deliveredIds.delete(oldest);
    }
  }
}
