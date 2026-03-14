import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock auth module ─────────────────────────────────────────────────────────

vi.mock('../../auth/index.js', () => ({
  getToken: vi.fn(),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
    }
  },
}));

import { getToken } from '../../auth/index.js';
import { _resetAPIClientForTests } from '../client.js';
import { encryptSecret, decryptSecret } from '../secrets.js';

const mockGetToken = getToken as ReturnType<typeof vi.fn>;

// ── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetToken.mockReset();
  mockFetch.mockReset();
  mockGetToken.mockResolvedValue('test-id-token');
  _resetAPIClientForTests();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SecretsAPI', () => {
  describe('encryptSecret()', () => {
    it('sends POST with plaintext and context', async () => {
      const envelope = {
        encryptedValue: 'enc-val',
        encryptedDEK: 'enc-dek',
        kmsKeyVersion: 'v1',
        iv: 'iv-123',
        authTag: 'tag-abc',
      };
      mockFetch.mockResolvedValue(jsonResponse(envelope));

      const result = await encryptSecret('api-key', 'user-1', 'sk-secret123');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/secretsEncrypt');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.plaintext).toBe('sk-secret123');
      expect(body.context).toEqual({ secretId: 'api-key', userId: 'user-1' });
      expect(result.encryptedValue).toBe('enc-val');
    });
  });

  describe('decryptSecret()', () => {
    it('sends POST with envelope and context', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ plaintext: 'sk-secret123' }));

      const envelope = {
        encryptedValue: 'enc-val',
        encryptedDEK: 'enc-dek',
        kmsKeyVersion: 'v1',
        iv: 'iv-123',
        authTag: 'tag-abc',
      };

      const result = await decryptSecret('api-key', 'user-1', envelope);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/secretsDecrypt');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.encryptedValue).toBe('enc-val');
      expect(body.context).toEqual({ secretId: 'api-key', userId: 'user-1' });
      expect(result).toBe('sk-secret123');
    });
  });
});
