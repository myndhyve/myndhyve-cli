/**
 * MyndHyve CLI — Signal Inbound Message Handler
 *
 * Connects to the signal-cli SSE event stream and normalizes
 * incoming Signal messages into ChatIngressEnvelope.
 */

import type { ChatIngressEnvelope } from '../../relay/types.js';
import { createLogger } from '../../utils/logger.js';
import type {
  SignalSSEEvent,
  SignalAttachment,
} from './types.js';

const log = createLogger('Signal:Inbound');

// ============================================================================
// SSE STREAM
// ============================================================================

/**
 * Connect to the signal-cli SSE event stream and forward normalized
 * messages via the onInbound callback.
 *
 * Resolves when the signal is aborted or the stream ends.
 * Throws on connection failure or unexpected stream termination.
 */
export async function connectSignalSSE(
  baseUrl: string,
  onInbound: (envelope: ChatIngressEnvelope) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  const url = `${baseUrl}/api/v1/events`;
  log.info('Connecting to SSE stream...', { url });

  const response = await fetch(url, {
    headers: { 'Accept': 'text/event-stream' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE connection failed: HTTP ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('SSE connection returned no body');
  }

  log.info('SSE stream connected');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (delimited by double newlines)
      const events = parseSSEBuffer(buffer);
      buffer = events.remaining;

      for (const event of events.parsed) {
        if (event.type !== 'receive') continue;

        try {
          const sseEvent = JSON.parse(event.data) as SignalSSEEvent;
          const envelope = normalizeSignalMessage(sseEvent);
          if (!envelope) continue;

          log.debug('Forwarding inbound message', {
            from: envelope.peerId,
            conversationId: envelope.conversationId,
            hasMedia: !!envelope.media,
          });

          await onInbound(envelope);
        } catch (error) {
          log.warn('Failed to process SSE event', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    // AbortError is expected when shutting down
    if (signal.aborted) return;
    throw error;
  } finally {
    reader.releaseLock();
  }
}

// ============================================================================
// SSE PARSER
// ============================================================================

interface SSEEvent {
  type: string;
  data: string;
}

interface SSEParseResult {
  parsed: SSEEvent[];
  remaining: string;
}

/**
 * Parse SSE events from a buffer.
 *
 * SSE format:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 *
 * Keep-alive lines start with `:` and are ignored.
 */
export function parseSSEBuffer(buffer: string): SSEParseResult {
  const parsed: SSEEvent[] = [];
  const blocks = buffer.split('\n\n');

  // The last block may be incomplete
  const remaining = blocks.pop() || '';

  for (const block of blocks) {
    if (!block.trim()) continue;

    let eventType = 'message'; // default SSE event type
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
      // Keep-alive comment
      if (line.startsWith(':')) continue;

      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    // Per SSE spec, multiple data: lines are joined with newlines
    const data = dataLines.join('\n');

    if (data) {
      parsed.push({ type: eventType, data });
    }
  }

  return { parsed, remaining };
}

// ============================================================================
// MESSAGE NORMALIZATION
// ============================================================================

/**
 * Normalize a Signal SSE event into a ChatIngressEnvelope.
 * Returns null if the message should be skipped (receipts, typing, sync, etc.).
 */
export function normalizeSignalMessage(event: SignalSSEEvent): ChatIngressEnvelope | null {
  const { envelope } = event;

  // Only process data messages (text, media, etc.)
  if (!envelope.dataMessage) return null;

  const dataMsg = envelope.dataMessage;

  // Skip reactions (not a chat message)
  if (dataMsg.reaction) return null;

  // Extract text
  const text = dataMsg.message || '';

  // Extract media
  const media = normalizeAttachments(dataMsg.attachments);

  // Skip messages with no text and no media
  if (!text && media.length === 0) return null;

  // Determine conversation ID and group status
  const isGroup = !!dataMsg.groupInfo;
  const conversationId = isGroup
    ? (dataMsg.groupInfo?.groupId ?? '')
    : envelope.sourceNumber || envelope.sourceUuid;

  // Build reply reference from quote
  const replyToMessageId = dataMsg.quote
    ? String(dataMsg.quote.id)
    : undefined;

  // Build mentions list
  const mentions = dataMsg.mentions?.map((m) => m.number || m.uuid) ?? [];

  const normalized: ChatIngressEnvelope = {
    channel: 'signal',
    platformMessageId: `sig-${envelope.timestamp}`,
    conversationId,
    peerId: envelope.sourceNumber || envelope.sourceUuid,
    peerDisplay: envelope.sourceName || undefined,
    text,
    media: media.length > 0 ? media : undefined,
    isGroup,
    groupName: dataMsg.groupInfo?.groupName,
    timestamp: new Date(envelope.timestamp).toISOString(),
    replyToMessageId,
    mentions: mentions.length > 0 ? mentions : undefined,
  };

  return normalized;
}

// ============================================================================
// ATTACHMENT NORMALIZATION
// ============================================================================

/**
 * Convert Signal attachments to ChatIngressEnvelope media format.
 */
function normalizeAttachments(
  attachments?: SignalAttachment[]
): NonNullable<ChatIngressEnvelope['media']> {
  if (!attachments || attachments.length === 0) return [];

  return attachments.map((att) => ({
    kind: classifyAttachment(att),
    ref: att.id,
    mimeType: att.contentType,
    fileName: att.filename,
    size: att.size,
  }));
}

/**
 * Classify an attachment's MIME type into a media kind.
 */
function classifyAttachment(
  att: SignalAttachment
): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
  // Voice notes take priority — they may have non-audio MIME types
  if (att.voiceNote) return 'audio';

  const mime = att.contentType.toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';

  return 'document';
}
