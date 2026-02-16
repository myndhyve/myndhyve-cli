import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WASocket } from '@whiskeysockets/baileys';
import type { ChatEgressEnvelope } from '../../../relay/types.js';

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

const mockMarkdownToWhatsApp = vi.fn((text: string) => text);
vi.mock('../format.js', () => ({
  markdownToWhatsApp: (text: string) => mockMarkdownToWhatsApp(text),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSocket(
  overrides?: Partial<Pick<WASocket, 'sendMessage'>>
): WASocket {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      key: { id: 'sent-msg-123' },
    }),
    ...overrides,
  } as unknown as WASocket;
}

function createEnvelope(overrides?: Partial<ChatEgressEnvelope>): ChatEgressEnvelope {
  return {
    channel: 'whatsapp',
    conversationId: '5511999998888@s.whatsapp.net',
    text: 'Hello from MyndHyve',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let deliverWhatsAppMessage: typeof import('../outbound.js').deliverWhatsAppMessage;

beforeEach(async () => {
  vi.clearAllMocks();
  mockMarkdownToWhatsApp.mockImplementation((text: string) => text);

  // Dynamic import to pick up fresh mocks
  const mod = await import('../outbound.js');
  deliverWhatsAppMessage = mod.deliverWhatsAppMessage;
});

describe('deliverWhatsAppMessage', () => {
  // ---------- TEXT MESSAGES --------------------------------------------------

  it('sends text message via socket.sendMessage()', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope();

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      { text: envelope.text }
    );
  });

  it('returns success with platformMessageId from sent message', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope();

    const result = await deliverWhatsAppMessage(socket, envelope);

    expect(result).toEqual({
      success: true,
      platformMessageId: 'sent-msg-123',
    });
  });

  it('converts markdown formatting to WhatsApp format', async () => {
    mockMarkdownToWhatsApp.mockReturnValue('*formatted*');
    const socket = createMockSocket();
    const envelope = createEnvelope({ text: '**formatted**' });

    await deliverWhatsAppMessage(socket, envelope);

    expect(mockMarkdownToWhatsApp).toHaveBeenCalledWith('**formatted**');
    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      { text: '*formatted*' }
    );
  });

  // ---------- IMAGE MESSAGES -------------------------------------------------

  it('sends image message when media with kind "image" is present', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: 'check this out',
      media: [
        { kind: 'image', url: 'https://cdn.example.com/photo.jpg', mimeType: 'image/jpeg' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        image: { url: 'https://cdn.example.com/photo.jpg' },
        caption: 'check this out',
        mimetype: 'image/jpeg',
      }
    );
  });

  // ---------- VIDEO MESSAGES -------------------------------------------------

  it('sends video message when media with kind "video" is present', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: 'cool video',
      media: [
        { kind: 'video', url: 'https://cdn.example.com/clip.mp4', mimeType: 'video/mp4' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        video: { url: 'https://cdn.example.com/clip.mp4' },
        caption: 'cool video',
        mimetype: 'video/mp4',
      }
    );
  });

  // ---------- AUDIO MESSAGES -------------------------------------------------

  it('sends audio message when media with kind "audio" is present', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: '',
      media: [
        { kind: 'audio', url: 'https://cdn.example.com/voice.ogg', mimeType: 'audio/ogg' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        audio: { url: 'https://cdn.example.com/voice.ogg' },
        mimetype: 'audio/ogg',
      }
    );
  });

  it('uses default audio mimetype when not provided', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: '',
      media: [
        { kind: 'audio', url: 'https://cdn.example.com/voice.mp3' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        audio: { url: 'https://cdn.example.com/voice.mp3' },
        mimetype: 'audio/mpeg',
      }
    );
  });

  // ---------- DOCUMENT MESSAGES ----------------------------------------------

  it('sends document message with fileName', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: 'here is the report',
      media: [
        {
          kind: 'document',
          url: 'https://cdn.example.com/report.pdf',
          mimeType: 'application/pdf',
          fileName: 'Q4-Report.pdf',
        },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        document: { url: 'https://cdn.example.com/report.pdf' },
        fileName: 'Q4-Report.pdf',
        mimetype: 'application/pdf',
        caption: 'here is the report',
      }
    );
  });

  it('uses default fileName and mimetype for documents when not provided', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: '',
      media: [
        { kind: 'document', url: 'https://cdn.example.com/file.bin' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        document: { url: 'https://cdn.example.com/file.bin' },
        fileName: 'document',
        mimetype: 'application/octet-stream',
        caption: undefined,
      }
    );
  });

  // ---------- UNKNOWN MEDIA KIND ---------------------------------------------

  it('falls back to text when media kind is unknown', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: 'fallback text',
      media: [
        { kind: 'sticker', url: 'https://cdn.example.com/sticker.webp' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      { text: 'fallback text' }
    );
  });

  // ---------- CAPTION OMISSION -----------------------------------------------

  it('omits caption when text is empty for image', async () => {
    const socket = createMockSocket();
    const envelope = createEnvelope({
      text: '',
      media: [
        { kind: 'image', url: 'https://cdn.example.com/photo.jpg', mimeType: 'image/png' },
      ],
    });

    await deliverWhatsAppMessage(socket, envelope);

    expect(socket.sendMessage).toHaveBeenCalledWith(
      envelope.conversationId,
      {
        image: { url: 'https://cdn.example.com/photo.jpg' },
        caption: undefined,
        mimetype: 'image/png',
      }
    );
  });

  // ---------- ERROR HANDLING -------------------------------------------------

  it('returns failure result with error message on send error', async () => {
    const socket = createMockSocket({
      sendMessage: vi.fn().mockRejectedValue(new Error('Connection timeout')),
    });
    const envelope = createEnvelope();

    const result = await deliverWhatsAppMessage(socket, envelope);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection timeout');
  });

  it('marks non-found/blocked errors as non-retryable (retryable: false)', async () => {
    const notFoundSocket = createMockSocket({
      sendMessage: vi.fn().mockRejectedValue(new Error('JID not found')),
    });
    const result1 = await deliverWhatsAppMessage(notFoundSocket, createEnvelope());
    expect(result1.success).toBe(false);
    expect(result1.retryable).toBe(false);

    const blockedSocket = createMockSocket({
      sendMessage: vi.fn().mockRejectedValue(new Error('User blocked')),
    });
    const result2 = await deliverWhatsAppMessage(blockedSocket, createEnvelope());
    expect(result2.success).toBe(false);
    expect(result2.retryable).toBe(false);

    const notOnWASocket = createMockSocket({
      sendMessage: vi.fn().mockRejectedValue(new Error('not on whatsapp')),
    });
    const result3 = await deliverWhatsAppMessage(notOnWASocket, createEnvelope());
    expect(result3.success).toBe(false);
    expect(result3.retryable).toBe(false);
  });

  it('marks network errors as retryable (retryable: true)', async () => {
    const socket = createMockSocket({
      sendMessage: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    });
    const envelope = createEnvelope();

    const result = await deliverWhatsAppMessage(socket, envelope);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('marks non-Error thrown values as retryable', async () => {
    const socket = createMockSocket({
      sendMessage: vi.fn().mockRejectedValue('some string error'),
    });
    const envelope = createEnvelope();

    const result = await deliverWhatsAppMessage(socket, envelope);

    expect(result.success).toBe(false);
    expect(result.error).toBe('some string error');
    expect(result.retryable).toBe(true);
  });

  // ---------- NULL KEY -------------------------------------------------------

  it('handles socket.sendMessage returning null key', async () => {
    const socket = createMockSocket({
      sendMessage: vi.fn().mockResolvedValue({ key: { id: null } }),
    });
    const envelope = createEnvelope();

    const result = await deliverWhatsAppMessage(socket, envelope);

    expect(result.success).toBe(true);
    // null is falsy, so `sentMsg?.key?.id || undefined` yields undefined
    expect(result.platformMessageId).toBeUndefined();
  });

  it('handles socket.sendMessage returning undefined', async () => {
    const socket = createMockSocket({
      sendMessage: vi.fn().mockResolvedValue(undefined),
    });
    const envelope = createEnvelope();

    const result = await deliverWhatsAppMessage(socket, envelope);

    expect(result.success).toBe(true);
    expect(result.platformMessageId).toBeUndefined();
  });
});
