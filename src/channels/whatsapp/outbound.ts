/**
 * MyndHyve CLI — WhatsApp Outbound Message Delivery
 *
 * Delivers ChatEgressEnvelope messages via the Baileys socket.
 */

import type { WASocket, AnyMessageContent } from '@whiskeysockets/baileys';
import type { ChatEgressEnvelope, DeliveryResult } from '../../relay/types.js';
import { createLogger } from '../../utils/logger.js';
import { markdownToWhatsApp } from './format.js';

const log = createLogger('WhatsApp:Outbound');

/**
 * Deliver a ChatEgressEnvelope via the Baileys WhatsApp socket.
 */
export async function deliverWhatsAppMessage(
  socket: WASocket,
  envelope: ChatEgressEnvelope
): Promise<DeliveryResult> {
  const jid = envelope.conversationId;

  try {
    // Build message content
    const content = buildMessageContent(envelope);

    log.debug('Sending outbound message', {
      conversationId: jid,
      hasMedia: !!envelope.media,
    });

    const sentMsg = await socket.sendMessage(jid, content);

    return {
      success: true,
      platformMessageId: sentMsg?.key?.id || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Outbound delivery failed', { conversationId: jid, error: message });

    return {
      success: false,
      error: message,
      retryable: isRetryableError(error),
    };
  }
}

// ============================================================================
// MESSAGE BUILDING
// ============================================================================

/**
 * Build Baileys message content from a ChatEgressEnvelope.
 */
function buildMessageContent(envelope: ChatEgressEnvelope): AnyMessageContent {
  const text = markdownToWhatsApp(envelope.text);

  // If there's media, send as media message with caption
  if (envelope.media && envelope.media.length > 0) {
    const media = envelope.media[0]; // Baileys sends one media per message
    if (envelope.media.length > 1) {
      log.warn('Multiple media items in outbound; only first will be sent', {
        count: envelope.media.length,
      });
    }

    switch (media.kind) {
      case 'image':
        return {
          image: { url: media.url },
          caption: text || undefined,
          mimetype: media.mimeType,
        };
      case 'video':
        return {
          video: { url: media.url },
          caption: text || undefined,
          mimetype: media.mimeType,
        };
      case 'audio':
        return {
          audio: { url: media.url },
          mimetype: media.mimeType || 'audio/mpeg',
        };
      case 'document':
        return {
          document: { url: media.url },
          fileName: media.fileName || 'document',
          mimetype: media.mimeType || 'application/octet-stream',
          caption: text || undefined,
        };
      default:
        // Fall through to text
        break;
    }
  }

  // Plain text message
  return { text };
}

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

/**
 * Determine if a send error is retryable.
 * Non-retryable: JID not found, blocked, etc.
 * Retryable: network issues, rate limits, server errors.
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;

  const message = error.message.toLowerCase();

  // Non-retryable errors
  if (message.includes('not found')) return false;
  if (message.includes('blocked')) return false;
  if (message.includes('not on whatsapp')) return false;

  // Everything else is retryable (network, timeout, server errors)
  return true;
}
