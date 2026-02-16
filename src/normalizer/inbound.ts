/**
 * MyndHyve CLI — Inbound Message Normalizer
 *
 * Normalizes platform-specific inbound messages into the standard
 * ChatIngressEnvelope format before forwarding to the relay server.
 *
 * Each channel plugin produces raw platform events. This module
 * transforms them into a consistent shape.
 */

import type { ChatIngressEnvelope, RelayChannel } from '../relay/types.js';

/**
 * Raw inbound message from a channel plugin.
 * Each platform adapter populates what it can; the normalizer
 * fills in defaults for missing fields.
 */
export interface RawInboundMessage {
  channel: RelayChannel;
  platformMessageId: string;
  conversationId: string;
  threadId?: string;
  senderId: string;
  senderName?: string;
  text: string;
  media?: ChatIngressEnvelope['media'];
  isGroup: boolean;
  groupName?: string;
  timestamp: Date;
  replyToMessageId?: string;
  mentions?: string[];
}

/**
 * Normalize a raw inbound message into a ChatIngressEnvelope.
 */
export function normalizeInbound(raw: RawInboundMessage): ChatIngressEnvelope {
  return {
    channel: raw.channel,
    platformMessageId: raw.platformMessageId,
    conversationId: raw.conversationId,
    threadId: raw.threadId,
    peerId: raw.senderId,
    peerDisplay: raw.senderName,
    text: raw.text,
    media: raw.media,
    isGroup: raw.isGroup,
    groupName: raw.groupName,
    timestamp: raw.timestamp.toISOString(),
    replyToMessageId: raw.replyToMessageId,
    mentions: raw.mentions,
  };
}
