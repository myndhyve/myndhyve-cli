import { describe, it, expect } from 'vitest';
import { normalizeInbound, type RawInboundMessage } from '../inbound.js';

/**
 * Helper to build a full RawInboundMessage with sensible defaults.
 */
function makeRawMessage(overrides?: Partial<RawInboundMessage>): RawInboundMessage {
  return {
    channel: 'whatsapp',
    platformMessageId: 'msg-001',
    conversationId: 'conv-123',
    senderId: 'user-456',
    senderName: 'Alice',
    text: 'Hello, world!',
    isGroup: false,
    timestamp: new Date('2025-06-15T12:30:00Z'),
    ...overrides,
  };
}

describe('normalizeInbound', () => {
  it('converts RawInboundMessage to ChatIngressEnvelope', () => {
    const raw = makeRawMessage();
    const result = normalizeInbound(raw);

    expect(result).toEqual({
      channel: 'whatsapp',
      platformMessageId: 'msg-001',
      conversationId: 'conv-123',
      threadId: undefined,
      peerId: 'user-456',
      peerDisplay: 'Alice',
      text: 'Hello, world!',
      media: undefined,
      isGroup: false,
      groupName: undefined,
      timestamp: '2025-06-15T12:30:00.000Z',
      replyToMessageId: undefined,
      mentions: undefined,
    });
  });

  it('maps senderId to peerId', () => {
    const raw = makeRawMessage({ senderId: 'sender-xyz' });
    const result = normalizeInbound(raw);
    expect(result.peerId).toBe('sender-xyz');
  });

  it('maps senderName to peerDisplay', () => {
    const raw = makeRawMessage({ senderName: 'Bob Smith' });
    const result = normalizeInbound(raw);
    expect(result.peerDisplay).toBe('Bob Smith');
  });

  it('converts Date timestamp to ISO string', () => {
    const date = new Date('2024-12-25T00:00:00Z');
    const raw = makeRawMessage({ timestamp: date });
    const result = normalizeInbound(raw);

    expect(result.timestamp).toBe('2024-12-25T00:00:00.000Z');
    expect(typeof result.timestamp).toBe('string');
  });

  it('preserves media array', () => {
    const media = [
      { kind: 'image' as const, ref: 'https://example.com/photo.jpg', mimeType: 'image/jpeg', size: 1024 },
      { kind: 'document' as const, ref: 'https://example.com/doc.pdf', mimeType: 'application/pdf', fileName: 'doc.pdf' },
    ];
    const raw = makeRawMessage({ media });
    const result = normalizeInbound(raw);

    expect(result.media).toEqual(media);
    expect(result.media).toHaveLength(2);
  });

  it('preserves threadId when provided', () => {
    const raw = makeRawMessage({ threadId: 'thread-abc' });
    const result = normalizeInbound(raw);
    expect(result.threadId).toBe('thread-abc');
  });

  it('preserves replyToMessageId when provided', () => {
    const raw = makeRawMessage({ replyToMessageId: 'reply-to-msg-999' });
    const result = normalizeInbound(raw);
    expect(result.replyToMessageId).toBe('reply-to-msg-999');
  });

  it('preserves mentions when provided', () => {
    const raw = makeRawMessage({ mentions: ['user-1', 'user-2', 'user-3'] });
    const result = normalizeInbound(raw);
    expect(result.mentions).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('preserves group info', () => {
    const raw = makeRawMessage({
      isGroup: true,
      groupName: 'Team Chat',
    });
    const result = normalizeInbound(raw);

    expect(result.isGroup).toBe(true);
    expect(result.groupName).toBe('Team Chat');
  });

  it('handles minimal message (no optional fields)', () => {
    const raw: RawInboundMessage = {
      channel: 'signal',
      platformMessageId: 'msg-minimal',
      conversationId: 'conv-minimal',
      senderId: 'sender-min',
      text: 'Just text',
      isGroup: false,
      timestamp: new Date('2025-01-01T00:00:00Z'),
    };

    const result = normalizeInbound(raw);

    expect(result.channel).toBe('signal');
    expect(result.platformMessageId).toBe('msg-minimal');
    expect(result.conversationId).toBe('conv-minimal');
    expect(result.peerId).toBe('sender-min');
    expect(result.text).toBe('Just text');
    expect(result.isGroup).toBe(false);
    expect(result.timestamp).toBe('2025-01-01T00:00:00.000Z');

    // Optional fields should be undefined
    expect(result.peerDisplay).toBeUndefined();
    expect(result.threadId).toBeUndefined();
    expect(result.media).toBeUndefined();
    expect(result.groupName).toBeUndefined();
    expect(result.replyToMessageId).toBeUndefined();
    expect(result.mentions).toBeUndefined();
  });

  it('handles all three channel types', () => {
    for (const channel of ['whatsapp', 'signal', 'imessage'] as const) {
      const raw = makeRawMessage({ channel });
      const result = normalizeInbound(raw);
      expect(result.channel).toBe(channel);
    }
  });
});
