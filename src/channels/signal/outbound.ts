/**
 * MyndHyve CLI — Signal Outbound Message Delivery
 *
 * Delivers ChatEgressEnvelope messages via the signal-cli JSON-RPC daemon.
 */

import type { ChatEgressEnvelope, DeliveryResult } from '../../relay/types.js';
import { createLogger } from '../../utils/logger.js';
import { sendMessage, SignalRpcError } from './client.js';
import type { SignalSendResult } from './types.js';

const log = createLogger('Signal:Outbound');

/**
 * Deliver a ChatEgressEnvelope via Signal.
 */
export async function deliverSignalMessage(
  baseUrl: string,
  envelope: ChatEgressEnvelope
): Promise<DeliveryResult> {
  try {
    // Determine if this is a group or direct message
    const isGroup = envelope.conversationId.startsWith('group.');
    // signal-cli group IDs are base64-encoded; conversation IDs starting with +
    // are phone numbers (direct messages)

    const results = await sendMessage(baseUrl, {
      recipient: isGroup ? undefined : envelope.conversationId,
      groupId: isGroup ? envelope.conversationId : undefined,
      message: envelope.text,
    });

    // Check send results
    const success = results.some(isSuccessResult);
    const failure = results.find((r) => r.type !== 'SUCCESS');

    if (!success && failure) {
      return {
        success: false,
        error: `Send failed: ${failure.type}`,
        retryable: isRetryableResult(failure.type),
      };
    }

    // Find the timestamp from a successful result (used as message ID in Signal)
    const successResult = results.find(isSuccessResult);
    const platformMessageId = successResult?.timestamp
      ? `sig-${successResult.timestamp}`
      : undefined;

    return {
      success: true,
      platformMessageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Outbound delivery failed', {
      conversationId: envelope.conversationId,
      error: message,
    });

    return {
      success: false,
      error: message,
      retryable: isRetryableError(error),
    };
  }
}

// ============================================================================
// RESULT CLASSIFICATION
// ============================================================================

function isSuccessResult(result: SignalSendResult): boolean {
  return result.type === 'SUCCESS';
}

/**
 * Determine if a failed send result type is retryable.
 */
function isRetryableResult(type: string): boolean {
  switch (type) {
    case 'NETWORK_FAILURE':
      return true;
    case 'UNREGISTERED_FAILURE':
    case 'IDENTITY_FAILURE':
    case 'PROOF_REQUIRED_FAILURE':
      return false;
    default:
      return true;
  }
}

/**
 * Determine if a send error is retryable.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof SignalRpcError) {
    // Server-side RPC errors are generally not retryable
    // Network errors (connection refused, timeout) are retryable
    return error.code === -1; // HTTP-level errors
  }

  if (error instanceof TypeError) {
    // fetch() network errors
    return true;
  }

  return true; // Default to retryable
}
