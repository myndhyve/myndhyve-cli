import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { ChatIngressEnvelope } from '../../../relay/types.js';

// ---------------------------------------------------------------------------
// Mock Baileys utilities
// ---------------------------------------------------------------------------

vi.mock('@whiskeysockets/baileys', () => ({
  getContentType: vi.fn(),
  isJidGroup: vi.fn((jid: string) => jid?.endsWith('@g.us')),
  jidNormalizedUser: vi.fn((jid: string) => jid?.replace(/:.*@/, '@')),
}));

// Mock the logger so it doesn't write to stdout during tests
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { normalizeWhatsAppMessage, bindInboundHandler } from '../inbound.js';

// ---------------------------------------------------------------------------
// Helpers — build mock WAMessage objects
// ---------------------------------------------------------------------------

function makeWAMessage(overrides: {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  participant?: string;
  message?: WAMessage['message'];
  messageTimestamp?: number;
  pushName?: string;
}): WAMessage {
  return {
    key: {
      remoteJid: overrides.remoteJid ?? '5511999999999@s.whatsapp.net',
      fromMe: overrides.fromMe ?? false,
      id: overrides.id ?? `MSG-${Math.random().toString(36).slice(2, 10)}`,
      participant: overrides.participant,
    },
    message: overrides.message === undefined
      ? { conversation: 'Hello' }
      : overrides.message,
    messageTimestamp: overrides.messageTimestamp ?? 1700000000,
    pushName: overrides.pushName ?? 'John',
  } as WAMessage;
}

// ---------------------------------------------------------------------------
// normalizeWhatsAppMessage
// ---------------------------------------------------------------------------

describe('normalizeWhatsAppMessage', () => {
  // --- Skip / null cases ---------------------------------------------------

  describe('skip conditions', () => {
    it('returns null for own messages (fromMe: true)', () => {
      const msg = makeWAMessage({ fromMe: true });
      expect(normalizeWhatsAppMessage(msg)).toBeNull();
    });

    it('returns null for status broadcasts', () => {
      const msg = makeWAMessage({ remoteJid: 'status@broadcast' });
      expect(normalizeWhatsAppMessage(msg)).toBeNull();
    });

    it('returns null for messages with no content (message: undefined)', () => {
      // Explicitly pass null casted to trigger the !msg.message guard
      const msg = makeWAMessage({ message: null as unknown as undefined });
      expect(normalizeWhatsAppMessage(msg)).toBeNull();
    });

    it('returns null for empty messages (no text, no media)', () => {
      const msg = makeWAMessage({ message: {} as WAMessage['message'] });
      expect(normalizeWhatsAppMessage(msg)).toBeNull();
    });
  });

  // --- Text extraction ----------------------------------------------------

  describe('text extraction', () => {
    it('extracts text from conversation field', () => {
      const msg = makeWAMessage({
        message: { conversation: 'Hello world' },
      });
      const env = normalizeWhatsAppMessage(msg);
      expect(env).not.toBeNull();
      expect(env!.text).toContain('Hello world');
    });

    it('extracts text from extendedTextMessage.text field', () => {
      const msg = makeWAMessage({
        message: { extendedTextMessage: { text: 'Extended hello' } } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg);
      expect(env).not.toBeNull();
      expect(env!.text).toContain('Extended hello');
    });

    it('extracts text from image caption', () => {
      const msg = makeWAMessage({
        message: {
          imageMessage: {
            caption: 'Look at this',
            url: 'https://example.com/img.jpg',
            mimetype: 'image/jpeg',
          },
        } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg);
      expect(env).not.toBeNull();
      expect(env!.text).toContain('Look at this');
    });
  });

  // --- Envelope fields -----------------------------------------------------

  describe('envelope fields', () => {
    it('sets channel to whatsapp', () => {
      const msg = makeWAMessage({});
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.channel).toBe('whatsapp');
    });

    it('maps remoteJid to conversationId', () => {
      const jid = '5511888888888@s.whatsapp.net';
      const msg = makeWAMessage({ remoteJid: jid });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.conversationId).toBe(jid);
    });

    it('correctly maps participant JID in groups', () => {
      const groupJid = 'group-abc@g.us';
      const participantJid = '5511777777777:42@s.whatsapp.net';
      const msg = makeWAMessage({
        remoteJid: groupJid,
        participant: participantJid,
      });
      const env = normalizeWhatsAppMessage(msg)!;
      // jidNormalizedUser strips the device part (:42)
      expect(env.peerId).toBe('5511777777777@s.whatsapp.net');
      expect(env.conversationId).toBe(groupJid);
    });

    it('maps pushName to peerDisplay', () => {
      const msg = makeWAMessage({ pushName: 'Alice' });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.peerDisplay).toBe('Alice');
    });

    it('sets peerDisplay to undefined when pushName is empty', () => {
      const msg = makeWAMessage({ pushName: '' });
      const env = normalizeWhatsAppMessage(msg)!;
      // Empty string is falsy, source does `msg.pushName || undefined`
      expect(env.peerDisplay).toBeUndefined();
    });

    it('sets isGroup true for group JIDs (@g.us)', () => {
      const msg = makeWAMessage({ remoteJid: 'mygroup@g.us' });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.isGroup).toBe(true);
    });

    it('sets isGroup false for individual JIDs (@s.whatsapp.net)', () => {
      const msg = makeWAMessage({ remoteJid: '5511999999999@s.whatsapp.net' });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.isGroup).toBe(false);
    });
  });

  // --- Timestamp -----------------------------------------------------------

  describe('timestamp', () => {
    it('converts timestamp from seconds to ISO string', () => {
      const seconds = 1700000000;
      const msg = makeWAMessage({ messageTimestamp: seconds });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.timestamp).toBe(new Date(seconds * 1000).toISOString());
    });

    it('falls back to current time when timestamp is missing', () => {
      const before = Date.now();
      const msg = makeWAMessage({ messageTimestamp: undefined as unknown as number });
      // Remove the messageTimestamp entirely
      delete (msg as unknown as Record<string, unknown>).messageTimestamp;
      const env = normalizeWhatsAppMessage(msg)!;
      const parsed = new Date(env.timestamp).getTime();
      const after = Date.now();
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(after);
    });
  });

  // --- Media extraction ----------------------------------------------------

  describe('media extraction', () => {
    it('extracts image media references', () => {
      const msg = makeWAMessage({
        id: 'img-msg-1',
        message: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/img123',
            mimetype: 'image/png',
            caption: 'My photo',
            fileLength: 54321,
          },
        } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.media).toBeDefined();
      expect(env.media).toHaveLength(1);
      expect(env.media![0]).toEqual({
        kind: 'image',
        ref: 'https://mmg.whatsapp.net/img123',
        mimeType: 'image/png',
        size: 54321,
      });
    });

    it('extracts document media references with fileName', () => {
      const msg = makeWAMessage({
        id: 'doc-msg-1',
        message: {
          documentMessage: {
            url: 'https://mmg.whatsapp.net/doc456',
            mimetype: 'application/pdf',
            fileName: 'report.pdf',
            fileLength: 123456,
          },
        } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.media).toBeDefined();
      expect(env.media).toHaveLength(1);
      expect(env.media![0]).toEqual({
        kind: 'document',
        ref: 'https://mmg.whatsapp.net/doc456',
        mimeType: 'application/pdf',
        fileName: 'report.pdf',
        size: 123456,
      });
    });

    it('uses message key id as ref fallback when url is missing', () => {
      const msg = makeWAMessage({
        id: 'fallback-key-id',
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            caption: 'No URL',
          },
        } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.media![0].ref).toBe('fallback-key-id');
    });

    it('sets media to undefined when no media is present', () => {
      const msg = makeWAMessage({
        message: { conversation: 'plain text' },
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.media).toBeUndefined();
    });
  });

  // --- Reply context -------------------------------------------------------

  describe('reply context', () => {
    it('extracts stanzaId as replyToMessageId', () => {
      const msg = makeWAMessage({
        message: {
          extendedTextMessage: {
            text: 'Replying to you',
            contextInfo: {
              stanzaId: 'original-msg-42',
              participant: '5511111111111@s.whatsapp.net',
            },
          },
        } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.replyToMessageId).toBe('original-msg-42');
    });

    it('sets replyToMessageId to undefined when no context', () => {
      const msg = makeWAMessage({
        message: { conversation: 'No reply context' },
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.replyToMessageId).toBeUndefined();
    });
  });

  // --- Mentions ------------------------------------------------------------

  describe('mentions', () => {
    it('extracts mentions from contextInfo', () => {
      const msg = makeWAMessage({
        message: {
          extendedTextMessage: {
            text: 'Hey @user1 @user2',
            contextInfo: {
              mentionedJid: [
                '5511111111111@s.whatsapp.net',
                '5522222222222@s.whatsapp.net',
              ],
            },
          },
        } as WAMessage['message'],
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.mentions).toBeDefined();
      expect(env.mentions).toHaveLength(2);
      expect(env.mentions).toContain('5511111111111@s.whatsapp.net');
      expect(env.mentions).toContain('5522222222222@s.whatsapp.net');
    });

    it('sets mentions to undefined when none present', () => {
      const msg = makeWAMessage({
        message: { conversation: 'No mentions' },
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.mentions).toBeUndefined();
    });
  });

  // --- WhatsApp → Markdown conversion -------------------------------------

  describe('formatting conversion', () => {
    it('converts WhatsApp formatting to markdown in text', () => {
      const msg = makeWAMessage({
        message: { conversation: '*bold* and _italic_ and ~strike~' },
      });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.text).toContain('**bold**');
      expect(env.text).toContain('*italic*');
      expect(env.text).toContain('~~strike~~');
    });
  });

  // --- platformMessageId ---------------------------------------------------

  describe('platformMessageId', () => {
    it('uses message key id', () => {
      const msg = makeWAMessage({ id: 'MY-MSG-ID-999' });
      const env = normalizeWhatsAppMessage(msg)!;
      expect(env.platformMessageId).toBe('MY-MSG-ID-999');
    });
  });
});

// ---------------------------------------------------------------------------
// bindInboundHandler
// ---------------------------------------------------------------------------

describe('bindInboundHandler', () => {
  /**
   * Minimal mock of a WASocket event emitter.
   * Baileys uses socket.ev.on('messages.upsert', handler).
   */
  type UpsertHandler = (data: { messages: WAMessage[]; type: string }) => Promise<void>;

  function createMockSocket() {
    const handlers = new Map<string, UpsertHandler[]>();
    return {
      ev: {
        on: vi.fn((event: string, handler: UpsertHandler) => {
          const list = handlers.get(event) || [];
          list.push(handler);
          handlers.set(event, list);
        }),
      },
      /** Manually fire the 'messages.upsert' event. */
      _emit: async (data: { messages: WAMessage[]; type: string }) => {
        const list = handlers.get('messages.upsert') || [];
        for (const h of list) {
          await h(data);
        }
      },
    };
  }

  let mockSocket: ReturnType<typeof createMockSocket>;
  let onInbound: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = createMockSocket();
    onInbound = vi.fn().mockResolvedValue(undefined);
  });

  it('registers a listener on messages.upsert', () => {
    bindInboundHandler(mockSocket as unknown as import('@whiskeysockets/baileys').WASocket, onInbound);
    expect(mockSocket.ev.on).toHaveBeenCalledWith('messages.upsert', expect.any(Function));
  });

  it('only processes "notify" type messages', async () => {
    bindInboundHandler(mockSocket as unknown as import('@whiskeysockets/baileys').WASocket, onInbound);

    const validMsg = makeWAMessage({});

    // Type 'append' (history sync) should be ignored
    await mockSocket._emit({ messages: [validMsg], type: 'append' });
    expect(onInbound).not.toHaveBeenCalled();

    // Type 'notify' should be processed
    await mockSocket._emit({ messages: [validMsg], type: 'notify' });
    expect(onInbound).toHaveBeenCalledTimes(1);
  });

  it('calls onInbound for valid messages', async () => {
    bindInboundHandler(mockSocket as unknown as import('@whiskeysockets/baileys').WASocket, onInbound);

    const msg = makeWAMessage({
      remoteJid: '5511999999999@s.whatsapp.net',
      id: 'test-inbound-1',
      message: { conversation: 'hi there' },
    });

    await mockSocket._emit({ messages: [msg], type: 'notify' });

    expect(onInbound).toHaveBeenCalledTimes(1);
    const envelope: ChatIngressEnvelope = onInbound.mock.calls[0][0];
    expect(envelope.channel).toBe('whatsapp');
    expect(envelope.text).toContain('hi there');
    expect(envelope.conversationId).toBe('5511999999999@s.whatsapp.net');
  });

  it('skips own messages (fromMe: true)', async () => {
    bindInboundHandler(mockSocket as unknown as import('@whiskeysockets/baileys').WASocket, onInbound);

    const ownMsg = makeWAMessage({ fromMe: true });
    await mockSocket._emit({ messages: [ownMsg], type: 'notify' });

    expect(onInbound).not.toHaveBeenCalled();
  });

  it('handles onInbound errors without crashing', async () => {
    onInbound.mockRejectedValueOnce(new Error('Server down'));

    bindInboundHandler(mockSocket as unknown as import('@whiskeysockets/baileys').WASocket, onInbound);

    const msg = makeWAMessage({});

    // Should not throw — error is caught internally
    await expect(
      mockSocket._emit({ messages: [msg], type: 'notify' })
    ).resolves.not.toThrow();

    expect(onInbound).toHaveBeenCalledTimes(1);
  });

  it('processes multiple messages in a single upsert batch', async () => {
    bindInboundHandler(mockSocket as unknown as import('@whiskeysockets/baileys').WASocket, onInbound);

    const msg1 = makeWAMessage({ id: 'batch-1', message: { conversation: 'First' } });
    const msg2 = makeWAMessage({ id: 'batch-2', message: { conversation: 'Second' } });
    const ownMsg = makeWAMessage({ id: 'batch-3', fromMe: true });

    await mockSocket._emit({ messages: [msg1, msg2, ownMsg], type: 'notify' });

    // ownMsg should be skipped, so only 2 calls
    expect(onInbound).toHaveBeenCalledTimes(2);
  });
});
