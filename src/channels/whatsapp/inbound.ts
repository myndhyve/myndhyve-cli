/**
 * MyndHyve CLI — WhatsApp Inbound Message Handler
 *
 * Normalizes Baileys WAMessage events into ChatIngressEnvelope
 * for forwarding to the MyndHyve relay server.
 */

import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { isJidGroup, jidNormalizedUser } from '@whiskeysockets/baileys';
import type { ChatIngressEnvelope } from '../../relay/types.js';
import { createLogger } from '../../utils/logger.js';
import { whatsAppToMarkdown } from './format.js';

const log = createLogger('WhatsApp:Inbound');

// ============================================================================
// MESSAGE NORMALIZATION
// ============================================================================

/**
 * Normalize a Baileys WAMessage into a ChatIngressEnvelope.
 * Returns null if the message should be skipped (own messages, status, etc.).
 */
export function normalizeWhatsAppMessage(msg: WAMessage): ChatIngressEnvelope | null {
  // Skip own messages
  if (msg.key.fromMe) return null;

  // Skip status broadcasts
  if (msg.key.remoteJid === 'status@broadcast') return null;

  // Skip messages without content
  if (!msg.message) return null;

  const jid = msg.key.remoteJid!;
  const isGroup = isJidGroup(jid);

  // Extract text content
  const text = extractText(msg);

  // Extract media
  const media = extractMedia(msg);

  // Skip messages with no text and no media
  if (!text && (!media || media.length === 0)) return null;

  // Determine sender
  const senderId = isGroup
    ? jidNormalizedUser(msg.key.participant || '')
    : jidNormalizedUser(jid);

  // Extract reply context
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo;

  const replyToMessageId = contextInfo?.stanzaId;
  const mentions = contextInfo?.mentionedJid?.map(jidNormalizedUser);

  const envelope: ChatIngressEnvelope = {
    channel: 'whatsapp',
    platformMessageId: msg.key.id || `wa-${Date.now()}`,
    conversationId: jid,
    peerId: senderId,
    peerDisplay: msg.pushName || undefined,
    text: whatsAppToMarkdown(text),
    media: media && media.length > 0 ? media : undefined,
    isGroup: isGroup ?? false,
    groupName: undefined,
    timestamp: messageTimestamp(msg),
    replyToMessageId: replyToMessageId ?? undefined,
    mentions: mentions && mentions.length > 0 ? mentions : undefined,
  };

  return envelope;
}

// ============================================================================
// TEXT EXTRACTION
// ============================================================================

/**
 * Extract text content from a WAMessage, checking all possible content types.
 */
function extractText(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return '';

  // Direct text
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;

  // Media captions
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;

  // List/button responses
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;

  return '';
}

// ============================================================================
// MEDIA EXTRACTION
// ============================================================================

/**
 * Extract media references from a WAMessage.
 * Note: We don't download media here — we just capture the reference
 * for the server to process. The actual media download happens on the
 * server side or can be staged via base64 encoding.
 */
function extractMedia(msg: WAMessage): ChatIngressEnvelope['media'] {
  const m = msg.message;
  if (!m) return [];

  const media: NonNullable<ChatIngressEnvelope['media']> = [];

  if (m.imageMessage) {
    media.push({
      kind: 'image',
      ref: m.imageMessage.url || msg.key.id || '',
      mimeType: m.imageMessage.mimetype || 'image/jpeg',
      size: m.imageMessage.fileLength ? Number(m.imageMessage.fileLength) : undefined,
    });
  }

  if (m.videoMessage) {
    media.push({
      kind: 'video',
      ref: m.videoMessage.url || msg.key.id || '',
      mimeType: m.videoMessage.mimetype || 'video/mp4',
      size: m.videoMessage.fileLength ? Number(m.videoMessage.fileLength) : undefined,
    });
  }

  if (m.audioMessage) {
    media.push({
      kind: 'audio',
      ref: m.audioMessage.url || msg.key.id || '',
      mimeType: m.audioMessage.mimetype || 'audio/ogg',
      size: m.audioMessage.fileLength ? Number(m.audioMessage.fileLength) : undefined,
    });
  }

  if (m.documentMessage) {
    media.push({
      kind: 'document',
      ref: m.documentMessage.url || msg.key.id || '',
      mimeType: m.documentMessage.mimetype || 'application/octet-stream',
      fileName: m.documentMessage.fileName || undefined,
      size: m.documentMessage.fileLength ? Number(m.documentMessage.fileLength) : undefined,
    });
  }

  if (m.stickerMessage) {
    media.push({
      kind: 'sticker',
      ref: m.stickerMessage.url || msg.key.id || '',
      mimeType: m.stickerMessage.mimetype || 'image/webp',
      size: m.stickerMessage.fileLength ? Number(m.stickerMessage.fileLength) : undefined,
    });
  }

  return media;
}

// ============================================================================
// TIMESTAMP
// ============================================================================

/**
 * Extract and normalize the message timestamp.
 */
function messageTimestamp(msg: WAMessage): string {
  const ts = msg.messageTimestamp;
  if (!ts) return new Date().toISOString();

  // Baileys timestamps can be number (seconds) or Long
  const seconds = typeof ts === 'number' ? ts : Number(ts);
  return new Date(seconds * 1000).toISOString();
}

// ============================================================================
// EVENT BINDING
// ============================================================================

/**
 * Bind the messages.upsert event to forward normalized messages
 * via the onInbound callback.
 */
export function bindInboundHandler(
  socket: WASocket,
  onInbound: (envelope: ChatIngressEnvelope) => Promise<void>
): void {
  socket.ev.on('messages.upsert', async ({ messages, type }: { messages: WAMessage[]; type: string }) => {
    // Only process real-time messages, not history sync
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        const envelope = normalizeWhatsAppMessage(msg);
        if (!envelope) continue;

        log.debug('Forwarding inbound message', {
          from: envelope.peerId,
          conversationId: envelope.conversationId,
          hasMedia: !!envelope.media,
        });

        await onInbound(envelope);
      } catch (error) {
        log.warn('Failed to process inbound message', {
          messageId: msg.key.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
