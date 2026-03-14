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
import { sendEmail, sendSMS } from '../notifications.js';

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

describe('NotificationsAPI', () => {
  describe('sendEmail()', () => {
    it('sends POST with email fields', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, messageId: 'msg-1' }));

      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'World',
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/notificationSendEmail');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.to).toBe('user@example.com');
      expect(body.subject).toBe('Hello');
      expect(body.text).toBe('World');
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-1');
    });

    it('sends POST with template', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      await sendEmail({
        to: 'user@example.com',
        templateType: 'welcome',
        templateData: { userName: 'Alice', loginUrl: 'https://example.com' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.templateType).toBe('welcome');
      expect(body.templateData.userName).toBe('Alice');
    });
  });

  describe('sendSMS()', () => {
    it('sends POST with SMS fields', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true, messageId: 'sms-1', status: 'queued' }));

      const result = await sendSMS({
        to: '+15551234567',
        body: 'Your code is 123456',
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/notificationSendSMS');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.to).toBe('+15551234567');
      expect(body.body).toBe('Your code is 123456');
      expect(result.success).toBe(true);
      expect(result.status).toBe('queued');
    });

    it('sends POST with template', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ success: true }));

      await sendSMS({
        to: '+15551234567',
        templateType: 'verification_code',
        templateData: { code: '123456', expiresIn: '10 minutes' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.templateType).toBe('verification_code');
      expect(body.templateData.code).toBe('123456');
    });
  });
});
