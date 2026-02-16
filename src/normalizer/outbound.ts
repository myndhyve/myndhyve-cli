/**
 * MyndHyve CLI — Outbound Message Normalizer
 *
 * Transforms a ChatEgressEnvelope from the relay server into
 * platform-specific arguments for each channel plugin's deliver() method.
 *
 * Currently a pass-through since ChatEgressEnvelope is already
 * channel-agnostic. Channel plugins handle platform-specific formatting
 * internally. This module exists as a hook for future transformations
 * (e.g., markdown-to-platform formatting, media URL resolution).
 */

import type { ChatEgressEnvelope } from '../relay/types.js';

/**
 * Platform-specific delivery payload. Currently identical to
 * ChatEgressEnvelope but provides a seam for future per-platform
 * formatting (e.g., WhatsApp bold = *text*, Signal bold = **text**).
 */
export interface NormalizedOutbound {
  conversationId: string;
  threadId?: string;
  text: string;
  media?: ChatEgressEnvelope['media'];
  replyToMessageId?: string;
}

/**
 * Normalize an outbound envelope for delivery.
 */
export function normalizeOutbound(envelope: ChatEgressEnvelope): NormalizedOutbound {
  return {
    conversationId: envelope.conversationId,
    threadId: envelope.threadId,
    text: envelope.text,
    media: envelope.media,
    replyToMessageId: envelope.replyToMessageId,
  };
}
