import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  SignalSSEEvent,
  SignalEnvelope,
  SignalDataMessage,
} from '../types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  parseSSEBuffer,
  normalizeSignalMessage,
  connectSignalSSE,
} from '../inbound.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseEnvelope: SignalEnvelope = {
  source: '+1234567890',
  sourceNumber: '+1234567890',
  sourceUuid: 'uuid-abc-123',
  sourceName: 'Alice',
  sourceDevice: 1,
  timestamp: 1700000000000,
};

const baseDataMessage: SignalDataMessage = {
  timestamp: 1700000000000,
  message: 'Hello from Signal',
  expiresInSeconds: 0,
  viewOnce: false,
};

function makeSSEEvent(
  envelopeOverrides?: Partial<SignalEnvelope>,
  dataMessageOverrides?: Partial<SignalDataMessage> | null
): SignalSSEEvent {
  const envelope: SignalEnvelope = {
    ...baseEnvelope,
    ...envelopeOverrides,
  };

  // When dataMessageOverrides is explicitly null, omit dataMessage
  if (dataMessageOverrides === null) {
    delete envelope.dataMessage;
  } else {
    envelope.dataMessage = {
      ...baseDataMessage,
      ...dataMessageOverrides,
    };
  }

  return {
    envelope,
    account: '+1234567890',
  };
}

// ---------------------------------------------------------------------------
// parseSSEBuffer
// ---------------------------------------------------------------------------

describe('parseSSEBuffer', () => {
  it('parses a single complete event (event + data + blank line)', () => {
    const buffer = 'event: receive\ndata: {"test":1}\n\n';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({
      type: 'receive',
      data: '{"test":1}',
    });
    expect(result.remaining).toBe('');
  });

  it('parses multiple events in one buffer', () => {
    const buffer = [
      'event: receive\ndata: {"id":1}\n',
      'event: receive\ndata: {"id":2}\n',
      '', // trailing empty after last double-newline
    ].join('\n');

    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(2);
    expect(result.parsed[0]).toEqual({ type: 'receive', data: '{"id":1}' });
    expect(result.parsed[1]).toEqual({ type: 'receive', data: '{"id":2}' });
  });

  it('returns remaining buffer for incomplete events', () => {
    const buffer = 'event: receive\ndata: {"complete":true}\n\nevent: receive\ndata: {"incomp';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0].data).toBe('{"complete":true}');
    expect(result.remaining).toBe('event: receive\ndata: {"incomp');
  });

  it('ignores keep-alive comment lines (starting with :)', () => {
    const buffer = ':keep-alive\n\nevent: receive\ndata: {"msg":"hi"}\n\n';
    const result = parseSSEBuffer(buffer);

    // The keep-alive block has no data, so it should be skipped
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({
      type: 'receive',
      data: '{"msg":"hi"}',
    });
  });

  it('uses "message" as default event type when no event: line', () => {
    const buffer = 'data: {"default":true}\n\n';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({
      type: 'message',
      data: '{"default":true}',
    });
  });

  it('handles empty blocks gracefully', () => {
    // Multiple double-newlines produce empty blocks
    const buffer = '\n\n\n\n';
    const result = parseSSEBuffer(buffer);

    // Empty blocks should be skipped (no data)
    expect(result.parsed).toHaveLength(0);
  });

  it('skips blocks that have event type but no data', () => {
    const buffer = 'event: heartbeat\n\n';
    const result = parseSSEBuffer(buffer);

    // Block has no data line, so it should not produce a parsed event
    expect(result.parsed).toHaveLength(0);
  });

  it('handles keep-alive comment interleaved with event lines', () => {
    const buffer = ':comment\nevent: receive\n:another comment\ndata: {"val":42}\n\n';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({
      type: 'receive',
      data: '{"val":42}',
    });
  });

  it('concatenates multiple data: lines with newlines (SSE spec)', () => {
    const buffer = 'event: receive\ndata: {"line1":\ndata: "value"}\n\n';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({
      type: 'receive',
      data: '{"line1":\n"value"}',
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeSignalMessage — basic text messages
// ---------------------------------------------------------------------------

describe('normalizeSignalMessage', () => {
  describe('basic text messages', () => {
    it('normalizes a basic text message with correct fields', () => {
      const event = makeSSEEvent();
      const result = normalizeSignalMessage(event);

      expect(result).not.toBeNull();
      expect(result!.channel).toBe('signal');
      expect(result!.peerId).toBe('+1234567890');
      expect(result!.text).toBe('Hello from Signal');
      expect(result!.isGroup).toBe(false);
      expect(result!.conversationId).toBe('+1234567890');
      expect(result!.peerDisplay).toBe('Alice');
    });

    it('formats platformMessageId as sig-{timestamp}', () => {
      const event = makeSSEEvent({ timestamp: 1700000000000 });
      const result = normalizeSignalMessage(event)!;

      expect(result.platformMessageId).toBe('sig-1700000000000');
    });

    it('formats timestamp as ISO string', () => {
      const event = makeSSEEvent({ timestamp: 1700000000000 });
      const result = normalizeSignalMessage(event)!;

      expect(result.timestamp).toBe(new Date(1700000000000).toISOString());
    });

    it('sets peerDisplay from sourceName', () => {
      const event = makeSSEEvent({ sourceName: 'Bob' });
      const result = normalizeSignalMessage(event)!;

      expect(result.peerDisplay).toBe('Bob');
    });

    it('sets peerDisplay to undefined when sourceName is empty', () => {
      const event = makeSSEEvent({ sourceName: '' });
      const result = normalizeSignalMessage(event)!;

      // Empty string is falsy, || undefined
      expect(result.peerDisplay).toBeUndefined();
    });

    it('uses sourceUuid as peerId when sourceNumber is missing', () => {
      const event = makeSSEEvent({
        sourceNumber: '',
        sourceUuid: 'uuid-fallback-456',
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.peerId).toBe('uuid-fallback-456');
    });
  });

  // ---------------------------------------------------------------------------
  // Skip / null cases
  // ---------------------------------------------------------------------------

  describe('skip conditions', () => {
    it('returns null for envelope without dataMessage', () => {
      const event = makeSSEEvent({}, null);
      const result = normalizeSignalMessage(event);

      expect(result).toBeNull();
    });

    it('returns null for reaction messages', () => {
      const event = makeSSEEvent({}, {
        message: null,
        reaction: {
          emoji: '👍',
          targetAuthor: '+9876543210',
          targetAuthorNumber: '+9876543210',
          targetAuthorUuid: 'uuid-target',
          targetSentTimestamp: 1699999999000,
          isRemove: false,
        },
      });
      const result = normalizeSignalMessage(event);

      expect(result).toBeNull();
    });

    it('returns null for messages with no text and no attachments', () => {
      const event = makeSSEEvent({}, {
        message: null,
        attachments: undefined,
      });
      const result = normalizeSignalMessage(event);

      expect(result).toBeNull();
    });

    it('returns null for messages with empty text and empty attachments array', () => {
      const event = makeSSEEvent({}, {
        message: '',
        attachments: [],
      });
      const result = normalizeSignalMessage(event);

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Group vs direct messages
  // ---------------------------------------------------------------------------

  describe('group vs direct messages', () => {
    it('sets isGroup=true and conversationId to groupId for group messages', () => {
      const event = makeSSEEvent({}, {
        groupInfo: {
          groupId: 'group.abc123base64==',
          type: 'DELIVER',
          groupName: 'Team Chat',
        },
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.isGroup).toBe(true);
      expect(result.conversationId).toBe('group.abc123base64==');
      expect(result.groupName).toBe('Team Chat');
    });

    it('sets isGroup=false and conversationId to sourceNumber for direct messages', () => {
      const event = makeSSEEvent({
        sourceNumber: '+1555000111',
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.isGroup).toBe(false);
      expect(result.conversationId).toBe('+1555000111');
    });

    it('falls back to sourceUuid for conversationId when sourceNumber is empty (DM)', () => {
      const event = makeSSEEvent({
        sourceNumber: '',
        sourceUuid: 'uuid-direct-789',
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.isGroup).toBe(false);
      expect(result.conversationId).toBe('uuid-direct-789');
    });
  });

  // ---------------------------------------------------------------------------
  // Quote / reply
  // ---------------------------------------------------------------------------

  describe('reply context', () => {
    it('maps quote to replyToMessageId (stringified quote.id)', () => {
      const event = makeSSEEvent({}, {
        quote: {
          id: 1699999000000,
          author: '+1999888777',
          authorNumber: '+1999888777',
          authorUuid: 'uuid-author',
          text: 'Original message',
        },
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.replyToMessageId).toBe('1699999000000');
    });

    it('sets replyToMessageId to undefined when no quote', () => {
      const event = makeSSEEvent();
      const result = normalizeSignalMessage(event)!;

      expect(result.replyToMessageId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Mentions
  // ---------------------------------------------------------------------------

  describe('mentions', () => {
    it('maps mentions to string array of numbers', () => {
      const event = makeSSEEvent({}, {
        mentions: [
          { start: 0, length: 5, uuid: 'uuid-m1', number: '+1111111111' },
          { start: 6, length: 5, uuid: 'uuid-m2', number: '+2222222222' },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.mentions).toEqual(['+1111111111', '+2222222222']);
    });

    it('falls back to uuid when number is empty', () => {
      const event = makeSSEEvent({}, {
        mentions: [
          { start: 0, length: 5, uuid: 'uuid-only', number: '' },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      // number is '' (falsy), so m.number || m.uuid gives uuid
      expect(result.mentions).toEqual(['uuid-only']);
    });

    it('sets mentions to undefined when none present', () => {
      const event = makeSSEEvent();
      const result = normalizeSignalMessage(event)!;

      expect(result.mentions).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  describe('attachments', () => {
    it('classifies image/* attachments as "image"', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          { id: 'att-1', contentType: 'image/jpeg', size: 12345 },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(1);
      expect(result.media![0].kind).toBe('image');
    });

    it('classifies video/* attachments as "video"', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          { id: 'att-2', contentType: 'video/mp4', size: 999999 },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(1);
      expect(result.media![0].kind).toBe('video');
    });

    it('classifies audio/* attachments as "audio"', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          { id: 'att-3', contentType: 'audio/ogg', size: 5000 },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(1);
      expect(result.media![0].kind).toBe('audio');
    });

    it('classifies voiceNote as "audio" regardless of contentType', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          {
            id: 'att-voice',
            contentType: 'application/octet-stream',
            voiceNote: true,
            size: 3000,
          },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(1);
      expect(result.media![0].kind).toBe('audio');
    });

    it('classifies other content types as "document"', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          { id: 'att-doc', contentType: 'application/pdf', filename: 'report.pdf', size: 50000 },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(1);
      expect(result.media![0].kind).toBe('document');
    });

    it('maps attachment fields correctly (id->ref, contentType->mimeType, etc.)', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          {
            id: 'att-mapped',
            contentType: 'image/png',
            filename: 'screenshot.png',
            size: 23456,
          },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(1);
      expect(result.media![0]).toEqual({
        kind: 'image',
        ref: 'att-mapped',
        mimeType: 'image/png',
        fileName: 'screenshot.png',
        size: 23456,
      });
    });

    it('handles multiple attachments in one message', () => {
      const event = makeSSEEvent({}, {
        attachments: [
          { id: 'att-img', contentType: 'image/jpeg', size: 10000 },
          { id: 'att-doc', contentType: 'application/pdf', filename: 'file.pdf', size: 20000 },
        ],
      });
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toHaveLength(2);
      expect(result.media![0].kind).toBe('image');
      expect(result.media![1].kind).toBe('document');
    });

    it('sets media to undefined when no attachments', () => {
      const event = makeSSEEvent();
      const result = normalizeSignalMessage(event)!;

      expect(result.media).toBeUndefined();
    });

    it('allows message with attachments but no text', () => {
      const event = makeSSEEvent({}, {
        message: null,
        attachments: [
          { id: 'media-only', contentType: 'image/gif', size: 8000 },
        ],
      });
      const result = normalizeSignalMessage(event);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('');
      expect(result!.media).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// connectSignalSSE
// ---------------------------------------------------------------------------

describe('connectSignalSSE', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls fetch with correct URL and headers', async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: true, value: undefined }),
          releaseLock: vi.fn(),
        }),
      },
    });
    globalThis.fetch = mockFetch;

    await connectSignalSSE('http://localhost:18080', vi.fn(), controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/v1/events',
      {
        headers: { 'Accept': 'text/event-stream' },
        signal: controller.signal,
      }
    );
  });

  it('returns cleanly when signal is aborted (no throw)', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted', 'AbortError');

    const mockReader = {
      read: vi.fn().mockRejectedValue(abortError),
      releaseLock: vi.fn(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    // Abort immediately so the catch path sees signal.aborted = true
    controller.abort();

    // Should resolve without throwing
    await expect(
      connectSignalSSE('http://localhost:18080', vi.fn(), controller.signal)
    ).resolves.toBeUndefined();
  });

  it('throws when HTTP response is not ok', async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(
      connectSignalSSE('http://localhost:18080', vi.fn(), controller.signal)
    ).rejects.toThrow('SSE connection failed: HTTP 503 Service Unavailable');
  });

  it('throws when response has no body', async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });

    await expect(
      connectSignalSSE('http://localhost:18080', vi.fn(), controller.signal)
    ).rejects.toThrow('SSE connection returned no body');
  });

  it('forwards normalized messages via onInbound callback', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn().mockResolvedValue(undefined);

    const ssePayload = JSON.stringify(makeSSEEvent());
    const sseChunk = `event: receive\ndata: ${ssePayload}\n\n`;
    const encoder = new TextEncoder();

    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(sseChunk) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock: vi.fn(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    await connectSignalSSE('http://localhost:18080', onInbound, controller.signal);

    expect(onInbound).toHaveBeenCalledTimes(1);
    expect(onInbound.mock.calls[0][0].channel).toBe('signal');
    expect(onInbound.mock.calls[0][0].text).toBe('Hello from Signal');
  });

  it('skips non-receive event types', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn().mockResolvedValue(undefined);

    const sseChunk = 'event: typing\ndata: {"envelope":{}}\n\n';
    const encoder = new TextEncoder();

    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(sseChunk) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock: vi.fn(),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    await connectSignalSSE('http://localhost:18080', onInbound, controller.signal);

    expect(onInbound).not.toHaveBeenCalled();
  });
});
