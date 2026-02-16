import { describe, it, expect } from 'vitest';
import { normalizeOutbound } from '../outbound.js';
import type { ChatEgressEnvelope } from '../../relay/types.js';

/**
 * Helper to build a full ChatEgressEnvelope with sensible defaults.
 */
function makeEnvelope(overrides?: Partial<ChatEgressEnvelope>): ChatEgressEnvelope {
  return {
    channel: 'whatsapp',
    conversationId: 'conv-123',
    text: 'Hello from MyndHyve!',
    ...overrides,
  };
}

describe('normalizeOutbound', () => {
  it('extracts conversationId and text from envelope', () => {
    const envelope = makeEnvelope({
      conversationId: 'conv-abc',
      text: 'Reply text',
    });
    const result = normalizeOutbound(envelope);

    expect(result.conversationId).toBe('conv-abc');
    expect(result.text).toBe('Reply text');
  });

  it('preserves threadId when provided', () => {
    const envelope = makeEnvelope({ threadId: 'thread-xyz' });
    const result = normalizeOutbound(envelope);
    expect(result.threadId).toBe('thread-xyz');
  });

  it('preserves media array when provided', () => {
    const media = [
      { kind: 'image', url: 'https://example.com/img.png', mimeType: 'image/png' },
      { kind: 'document', url: 'https://example.com/doc.pdf', mimeType: 'application/pdf', fileName: 'report.pdf' },
    ];
    const envelope = makeEnvelope({ media });
    const result = normalizeOutbound(envelope);

    expect(result.media).toEqual(media);
    expect(result.media).toHaveLength(2);
  });

  it('preserves replyToMessageId when provided', () => {
    const envelope = makeEnvelope({ replyToMessageId: 'msg-original' });
    const result = normalizeOutbound(envelope);
    expect(result.replyToMessageId).toBe('msg-original');
  });

  it('strips channel field (not present in NormalizedOutbound)', () => {
    const envelope = makeEnvelope({ channel: 'signal' });
    const result = normalizeOutbound(envelope);

    // NormalizedOutbound should not have `channel`
    expect(result).not.toHaveProperty('channel');
  });

  it('handles minimal envelope (no optional fields)', () => {
    const envelope: ChatEgressEnvelope = {
      channel: 'imessage',
      conversationId: 'conv-minimal',
      text: 'Just text',
    };
    const result = normalizeOutbound(envelope);

    expect(result.conversationId).toBe('conv-minimal');
    expect(result.text).toBe('Just text');
    expect(result.threadId).toBeUndefined();
    expect(result.media).toBeUndefined();
    expect(result.replyToMessageId).toBeUndefined();
    expect(result).not.toHaveProperty('channel');
  });

  it('handles envelope with all optional fields populated', () => {
    const envelope = makeEnvelope({
      channel: 'whatsapp',
      conversationId: 'conv-full',
      threadId: 'thread-full',
      text: 'Full message',
      media: [{ kind: 'audio', url: 'https://example.com/audio.mp3', mimeType: 'audio/mpeg' }],
      replyToMessageId: 'msg-reply-target',
    });
    const result = normalizeOutbound(envelope);

    expect(result).toEqual({
      conversationId: 'conv-full',
      threadId: 'thread-full',
      text: 'Full message',
      media: [{ kind: 'audio', url: 'https://example.com/audio.mp3', mimeType: 'audio/mpeg' }],
      replyToMessageId: 'msg-reply-target',
    });
  });
});
