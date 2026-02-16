import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatEgressEnvelope } from '../../../relay/types.js';
import type { SignalSendResult } from '../types.js';

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

const mockSendMessage = vi.fn<(baseUrl: string, params: Record<string, unknown>) => Promise<SignalSendResult[]>>();

// Mock the client module — provide a real-enough SignalRpcError class
vi.mock('../client.js', () => ({
  sendMessage: (baseUrl: string, params: Record<string, unknown>) => mockSendMessage(baseUrl, params),
  SignalRpcError: class SignalRpcError extends Error {
    code: number;
    method: string;
    constructor(msg: string, code: number, method: string) {
      super(msg);
      this.name = 'SignalRpcError';
      this.code = code;
      this.method = method;
    }
  },
}));

import { deliverSignalMessage } from '../outbound.js';

// Re-import SignalRpcError from the mocked module for instanceof checks
const { SignalRpcError } = await import('../client.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://127.0.0.1:18080';

function createEnvelope(overrides?: Partial<ChatEgressEnvelope>): ChatEgressEnvelope {
  return {
    channel: 'signal',
    conversationId: '+1555000111',
    text: 'Hello from the cloud',
    ...overrides,
  };
}

function makeSuccessResult(timestamp = 1700000001000): SignalSendResult {
  return {
    type: 'SUCCESS',
    recipientAddress: { number: '+1555000111', uuid: 'uuid-recipient' },
    timestamp,
  };
}

function makeFailureResult(
  type: SignalSendResult['type'] = 'NETWORK_FAILURE'
): SignalSendResult {
  return {
    type,
    recipientAddress: { number: '+1555000111', uuid: 'uuid-recipient' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSendMessage.mockReset();
});

describe('deliverSignalMessage', () => {
  // ---------- DIRECT vs GROUP ROUTING ----------------------------------------

  describe('message routing', () => {
    it('sends direct message (non-group conversationId)', async () => {
      mockSendMessage.mockResolvedValue([makeSuccessResult()]);

      const envelope = createEnvelope({ conversationId: '+1555000222' });
      await deliverSignalMessage(BASE_URL, envelope);

      expect(mockSendMessage).toHaveBeenCalledWith(BASE_URL, {
        recipient: '+1555000222',
        groupId: undefined,
        message: 'Hello from the cloud',
      });
    });

    it('sends group message (conversationId starting with "group.")', async () => {
      mockSendMessage.mockResolvedValue([makeSuccessResult()]);

      const envelope = createEnvelope({
        conversationId: 'group.abc123base64==',
      });
      await deliverSignalMessage(BASE_URL, envelope);

      expect(mockSendMessage).toHaveBeenCalledWith(BASE_URL, {
        recipient: undefined,
        groupId: 'group.abc123base64==',
        message: 'Hello from the cloud',
      });
    });
  });

  // ---------- SUCCESS RESULTS ------------------------------------------------

  describe('success results', () => {
    it('returns success=true with platformMessageId on SUCCESS result', async () => {
      mockSendMessage.mockResolvedValue([makeSuccessResult(1700000001000)]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBe('sig-1700000001000');
    });

    it('returns success=true when at least one result is SUCCESS among mixed results', async () => {
      mockSendMessage.mockResolvedValue([
        makeFailureResult('NETWORK_FAILURE'),
        makeSuccessResult(1700000002000),
      ]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBe('sig-1700000002000');
    });

    it('returns success=true with undefined platformMessageId when SUCCESS result has no timestamp', async () => {
      const successNoTimestamp: SignalSendResult = {
        type: 'SUCCESS',
        recipientAddress: { number: '+1555000111' },
        // No timestamp
      };
      mockSendMessage.mockResolvedValue([successNoTimestamp]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBeUndefined();
    });
  });

  // ---------- FAILURE RESULTS ------------------------------------------------

  describe('failure results', () => {
    it('returns success=false with error on NETWORK_FAILURE (retryable=true)', async () => {
      mockSendMessage.mockResolvedValue([makeFailureResult('NETWORK_FAILURE')]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toContain('NETWORK_FAILURE');
      expect(result.retryable).toBe(true);
    });

    it('returns success=false with error on UNREGISTERED_FAILURE (retryable=false)', async () => {
      mockSendMessage.mockResolvedValue([
        makeFailureResult('UNREGISTERED_FAILURE'),
      ]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toContain('UNREGISTERED_FAILURE');
      expect(result.retryable).toBe(false);
    });

    it('returns success=false on IDENTITY_FAILURE (retryable=false)', async () => {
      mockSendMessage.mockResolvedValue([
        makeFailureResult('IDENTITY_FAILURE'),
      ]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });

    it('returns success=false on PROOF_REQUIRED_FAILURE (retryable=false)', async () => {
      mockSendMessage.mockResolvedValue([
        makeFailureResult('PROOF_REQUIRED_FAILURE'),
      ]);

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });
  });

  // ---------- THROW / ERROR HANDLING ----------------------------------------

  describe('error handling (thrown exceptions)', () => {
    it('returns success=false when sendMessage throws SignalRpcError with code=-1 (retryable=true)', async () => {
      mockSendMessage.mockRejectedValue(
        new SignalRpcError('HTTP 502: Bad Gateway', -1, 'send')
      );

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 502: Bad Gateway');
      expect(result.retryable).toBe(true);
    });

    it('returns success=false when sendMessage throws SignalRpcError with other code (retryable=false)', async () => {
      mockSendMessage.mockRejectedValue(
        new SignalRpcError('Invalid parameter', -32602, 'send')
      );

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid parameter');
      expect(result.retryable).toBe(false);
    });

    it('returns success=false when sendMessage throws TypeError (retryable=true)', async () => {
      mockSendMessage.mockRejectedValue(
        new TypeError('fetch failed')
      );

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toBe('fetch failed');
      expect(result.retryable).toBe(true);
    });

    it('returns success=false with retryable=true for generic errors', async () => {
      mockSendMessage.mockRejectedValue(new Error('Unknown failure'));

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown failure');
      expect(result.retryable).toBe(true);
    });

    it('handles non-Error thrown values', async () => {
      mockSendMessage.mockRejectedValue('string error');

      const result = await deliverSignalMessage(BASE_URL, createEnvelope());

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
      expect(result.retryable).toBe(true);
    });
  });

  // ---------- MESSAGE TEXT ---------------------------------------------------

  describe('message text', () => {
    it('passes envelope text to sendMessage', async () => {
      mockSendMessage.mockResolvedValue([makeSuccessResult()]);

      const envelope = createEnvelope({ text: 'Custom message content' });
      await deliverSignalMessage(BASE_URL, envelope);

      expect(mockSendMessage).toHaveBeenCalledWith(
        BASE_URL,
        expect.objectContaining({ message: 'Custom message content' })
      );
    });
  });
});
