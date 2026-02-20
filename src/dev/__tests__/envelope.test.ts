import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  IngressEnvelopeSchema,
  EgressEnvelopeSchema,
  createTestEnvelope,
  validateEnvelope,
} from '../envelope.js';
import type { ChatIngressEnvelope, ChatEgressEnvelope } from '../../relay/types.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a minimal valid ingress envelope object.
 */
function makeIngressData(overrides?: Partial<ChatIngressEnvelope>): ChatIngressEnvelope {
  return {
    channel: 'whatsapp',
    platformMessageId: 'msg-001',
    conversationId: 'conv-123',
    peerId: 'peer-456',
    peerDisplay: 'Test User',
    text: 'Hello',
    isGroup: false,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a minimal valid egress envelope object.
 */
function makeEgressData(overrides?: Partial<ChatEgressEnvelope>): ChatEgressEnvelope {
  return {
    channel: 'whatsapp',
    conversationId: 'conv-123',
    text: 'Reply text',
    ...overrides,
  };
}

// ============================================================================
// createTestEnvelope
// ============================================================================

describe('createTestEnvelope', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a valid envelope for whatsapp channel', () => {
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Hi' });

    expect(env.channel).toBe('whatsapp');
    expect(env.text).toBe('Hi');
    expect(env.isGroup).toBe(false);
    // Should pass schema validation
    const result = IngressEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('creates a valid envelope for signal channel', () => {
    const env = createTestEnvelope({ channel: 'signal', text: 'Signal msg' });

    expect(env.channel).toBe('signal');
    expect(env.text).toBe('Signal msg');
    expect(env.peerId).toBe('peer-signal-001');
    expect(env.conversationId).toBe('conv-signal-test');
    const result = IngressEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('creates a valid envelope for imessage channel', () => {
    const env = createTestEnvelope({ channel: 'imessage', text: 'iMsg' });

    expect(env.channel).toBe('imessage');
    expect(env.text).toBe('iMsg');
    expect(env.peerId).toBe('peer-imessage-001');
    expect(env.conversationId).toBe('conv-imessage-test');
    const result = IngressEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it('uses custom text', () => {
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Custom message body' });
    expect(env.text).toBe('Custom message body');
  });

  it('uses custom peerId when provided', () => {
    const env = createTestEnvelope({
      channel: 'whatsapp',
      text: 'Hi',
      peerId: 'custom-peer-id',
    });
    expect(env.peerId).toBe('custom-peer-id');
  });

  it('uses custom conversationId when provided', () => {
    const env = createTestEnvelope({
      channel: 'signal',
      text: 'Hi',
      conversationId: 'my-conv-999',
    });
    expect(env.conversationId).toBe('my-conv-999');
  });

  it('defaults peerId to channel-based value when not provided', () => {
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Hi' });
    expect(env.peerId).toBe('peer-whatsapp-001');
  });

  it('defaults conversationId to channel-based value when not provided', () => {
    const env = createTestEnvelope({ channel: 'signal', text: 'test' });
    expect(env.conversationId).toBe('conv-signal-test');
  });

  it('creates a group message with groupName', () => {
    const env = createTestEnvelope({
      channel: 'whatsapp',
      text: 'Group hello',
      isGroup: true,
      groupName: 'My Group',
    });
    expect(env.isGroup).toBe(true);
    expect(env.groupName).toBe('My Group');
  });

  it('uses default groupName "Test Group" for group messages without custom name', () => {
    const env = createTestEnvelope({
      channel: 'signal',
      text: 'Group hi',
      isGroup: true,
    });
    expect(env.isGroup).toBe(true);
    expect(env.groupName).toBe('Test Group');
  });

  it('sets groupName to undefined for non-group messages', () => {
    const env = createTestEnvelope({
      channel: 'whatsapp',
      text: 'DM',
      isGroup: false,
    });
    expect(env.groupName).toBeUndefined();
  });

  it('produces a valid ISO 8601 timestamp', () => {
    const before = new Date().toISOString();
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Hi' });
    const after = new Date().toISOString();

    // Must parse as a valid date
    const parsed = new Date(env.timestamp);
    expect(parsed.toString()).not.toBe('Invalid Date');

    // timestamp should be between before and after
    expect(env.timestamp >= before).toBe(true);
    expect(env.timestamp <= after).toBe(true);
  });

  it('generates a unique platformMessageId each time', () => {
    const env1 = createTestEnvelope({ channel: 'whatsapp', text: 'A' });
    const env2 = createTestEnvelope({ channel: 'whatsapp', text: 'B' });
    expect(env1.platformMessageId).not.toBe(env2.platformMessageId);
  });

  it('platformMessageId starts with "test-"', () => {
    const env = createTestEnvelope({ channel: 'imessage', text: 'Hi' });
    expect(env.platformMessageId).toMatch(/^test-/);
  });

  it('always sets peerDisplay to "Test User"', () => {
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Hi' });
    expect(env.peerDisplay).toBe('Test User');
  });

  it('isGroup defaults to false when omitted', () => {
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Hi' });
    expect(env.isGroup).toBe(false);
  });
});

// ============================================================================
// validateEnvelope
// ============================================================================

describe('validateEnvelope', () => {
  it('returns valid=true and envelopeType="ingress" for a valid ingress envelope', () => {
    const data = makeIngressData();
    const result = validateEnvelope(data);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('ingress');
    expect(result.errors).toEqual([]);
  });

  it('returns valid=true and envelopeType="egress" for a valid egress envelope', () => {
    // A pure egress envelope has no peerId, platformMessageId, or isGroup
    const data = makeEgressData();
    const result = validateEnvelope(data);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('egress');
    expect(result.errors).toEqual([]);
  });

  it('validates an envelope created by createTestEnvelope as ingress', () => {
    const env = createTestEnvelope({ channel: 'whatsapp', text: 'Validate me' });
    const result = validateEnvelope(env);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('ingress');
  });

  it('reports invalid when required fields are missing', () => {
    const result = validateEnvelope({});

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails when channel is invalid', () => {
    const data = makeIngressData({ channel: 'telegram' as any });
    const result = validateEnvelope(data);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('channel'))).toBe(true);
  });

  it('returns envelopeType="ingress" when data has ingress fields but is invalid', () => {
    const data = {
      peerId: 'peer-1',
      platformMessageId: 'msg-1',
      isGroup: false,
      // missing channel, text, conversationId, timestamp
    };
    const result = validateEnvelope(data);

    expect(result.valid).toBe(false);
    expect(result.envelopeType).toBe('ingress');
  });

  it('returns envelopeType="egress" when data lacks ingress fields and is invalid', () => {
    // No peerId, platformMessageId, or isGroup -- looks like egress attempt
    const data = {
      conversationId: 'conv-1',
      // missing channel, text
    };
    const result = validateEnvelope(data);

    expect(result.valid).toBe(false);
    expect(result.envelopeType).toBe('egress');
  });

  it('returns error messages for each invalid field', () => {
    const data = {
      channel: 'invalid-channel',
      platformMessageId: '',
      conversationId: '',
      peerId: '',
      text: 123, // wrong type
      isGroup: 'yes', // wrong type
      timestamp: 'not-a-date',
    };
    const result = validateEnvelope(data);

    expect(result.valid).toBe(false);
    // Should have multiple errors
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('accepts ingress envelope with optional media array', () => {
    const data = makeIngressData({
      media: [
        { kind: 'image', ref: 'file://photo.jpg', mimeType: 'image/jpeg' },
      ],
    });
    const result = validateEnvelope(data);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('ingress');
  });

  it('accepts ingress envelope with optional replyToMessageId', () => {
    const data = makeIngressData({ replyToMessageId: 'orig-msg-42' });
    const result = validateEnvelope(data);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('ingress');
  });

  it('accepts ingress envelope with optional mentions', () => {
    const data = makeIngressData({ mentions: ['user-a', 'user-b'] });
    const result = validateEnvelope(data);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('ingress');
  });

  it('accepts egress envelope with optional media array', () => {
    const data = makeEgressData({
      media: [
        { kind: 'image', url: 'https://example.com/photo.jpg' },
      ],
    });
    const result = validateEnvelope(data);

    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('egress');
  });

  it('fails when null is passed', () => {
    const result = validateEnvelope(null);
    expect(result.valid).toBe(false);
  });

  it('fails when a primitive is passed', () => {
    const result = validateEnvelope('hello');
    expect(result.valid).toBe(false);
  });

  it('prefers ingress validation for data that has both peerId and valid egress shape', () => {
    // If data matches ingress, it always returns ingress
    const data = {
      ...makeEgressData(),
      peerId: 'peer-1',
      platformMessageId: 'msg-1',
      isGroup: false,
      timestamp: new Date().toISOString(),
    };
    const result = validateEnvelope(data);

    // It has all fields to satisfy ingress, so it should pass as ingress
    expect(result.valid).toBe(true);
    expect(result.envelopeType).toBe('ingress');
  });
});

// ============================================================================
// IngressEnvelopeSchema (direct schema tests)
// ============================================================================

describe('IngressEnvelopeSchema', () => {
  it('validates a correct ingress structure', () => {
    const data = makeIngressData();
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects when channel is missing', () => {
    const { channel: _channel, ...rest } = makeIngressData();
    const result = IngressEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects when platformMessageId is empty', () => {
    const data = makeIngressData({ platformMessageId: '' });
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when conversationId is empty', () => {
    const data = makeIngressData({ conversationId: '' });
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when peerId is empty', () => {
    const data = makeIngressData({ peerId: '' });
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when timestamp is not a valid datetime', () => {
    const data = makeIngressData({ timestamp: 'yesterday' });
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('allows text to be an empty string', () => {
    const data = makeIngressData({ text: '' });
    const result = IngressEnvelopeSchema.safeParse(data);
    // text is z.string() with no .min(1), so empty is valid
    expect(result.success).toBe(true);
  });

  it('validates media items with all supported kinds', () => {
    const kinds = ['image', 'video', 'audio', 'document', 'sticker'] as const;
    for (const kind of kinds) {
      const data = makeIngressData({
        media: [{ kind, ref: `file://test.${kind}` }],
      });
      const result = IngressEnvelopeSchema.safeParse(data);
      expect(result.success).toBe(true);
    }
  });

  it('rejects media with invalid kind', () => {
    const data = makeIngressData({
      media: [{ kind: 'gif' as any, ref: 'file://test.gif' }],
    });
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects media with empty ref', () => {
    const data = makeIngressData({
      media: [{ kind: 'image', ref: '' }],
    });
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('allows optional fields to be omitted', () => {
    const data: Record<string, unknown> = {
      channel: 'whatsapp',
      platformMessageId: 'msg-1',
      conversationId: 'conv-1',
      peerId: 'peer-1',
      text: 'Hello',
      isGroup: false,
      timestamp: new Date().toISOString(),
    };
    // No threadId, peerDisplay, media, groupName, replyToMessageId, mentions
    const result = IngressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// EgressEnvelopeSchema (direct schema tests)
// ============================================================================

describe('EgressEnvelopeSchema', () => {
  it('validates a correct egress structure', () => {
    const data = makeEgressData();
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects when channel is missing', () => {
    const { channel: _channel, ...rest } = makeEgressData();
    const result = EgressEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects when conversationId is empty', () => {
    const data = makeEgressData({ conversationId: '' });
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('accepts all three valid channels', () => {
    for (const channel of ['whatsapp', 'signal', 'imessage'] as const) {
      const data = makeEgressData({ channel });
      const result = EgressEnvelopeSchema.safeParse(data);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid channel', () => {
    const data = makeEgressData({ channel: 'slack' as any });
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('validates egress media with url field', () => {
    const data = makeEgressData({
      media: [
        { kind: 'image', url: 'https://cdn.example.com/img.png' },
      ],
    });
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects egress media with invalid url', () => {
    const data = makeEgressData({
      media: [
        { kind: 'image', url: 'not-a-url' },
      ],
    });
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects egress media with empty kind', () => {
    const data = makeEgressData({
      media: [
        { kind: '', url: 'https://cdn.example.com/img.png' },
      ],
    });
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('allows optional threadId and replyToMessageId', () => {
    const data = makeEgressData({
      threadId: 'thread-42',
      replyToMessageId: 'orig-msg',
    });
    const result = EgressEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});
