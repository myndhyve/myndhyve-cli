import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock node:fs and node:os BEFORE importing ────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  hasCredentials,
  isExpired,
  getCredentialsPath,
  type Credentials,
} from '../credentials.js';

// ── Cast mocks ───────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;

// ── Test data ────────────────────────────────────────────────────────────────

const validCredentials: Credentials = {
  idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature',
  refreshToken: 'AEu4IL3abc123',
  email: 'test@myndhyve.com',
  uid: 'user-123',
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  savedAt: new Date().toISOString(),
};

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockUnlinkSync.mockReset();
});

// ============================================================================
// getCredentialsPath()
// ============================================================================

describe('getCredentialsPath()', () => {
  it('returns correct path within CLI directory', () => {
    expect(getCredentialsPath()).toBe('/mock-home/.myndhyve-cli/credentials.json');
  });
});

// ============================================================================
// loadCredentials()
// ============================================================================

describe('loadCredentials()', () => {
  it('returns null when credentials file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(loadCredentials()).toBeNull();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('loads and parses valid credentials', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validCredentials));

    const result = loadCredentials();

    expect(result).not.toBeNull();
    expect(result!.email).toBe('test@myndhyve.com');
    expect(result!.uid).toBe('user-123');
    expect(result!.idToken).toBe(validCredentials.idToken);
    expect(result!.refreshToken).toBe(validCredentials.refreshToken);
  });

  it('returns null when credentials file is invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not json {{{');

    expect(loadCredentials()).toBeNull();
  });

  it('returns null when credentials file fails Zod validation', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      idToken: 'valid',
      // Missing required fields
    }));

    expect(loadCredentials()).toBeNull();
  });

  it('returns null when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(loadCredentials()).toBeNull();
  });
});

// ============================================================================
// saveCredentials()
// ============================================================================

describe('saveCredentials()', () => {
  it('writes credentials with restricted permissions (0o600)', () => {
    mockExistsSync.mockReturnValue(true); // CLI dir exists

    saveCredentials(validCredentials);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [path, content, options] = mockWriteFileSync.mock.calls[0];
    expect(path).toBe('/mock-home/.myndhyve-cli/credentials.json');
    expect(options).toEqual({ mode: 0o600 });

    const parsed = JSON.parse(content as string);
    expect(parsed.email).toBe('test@myndhyve.com');
    expect(parsed.uid).toBe('user-123');
  });

  it('validates credentials before saving (rejects invalid)', () => {
    mockExistsSync.mockReturnValue(true);

    const invalid = { ...validCredentials, email: 'not-an-email' };

    expect(() => saveCredentials(invalid)).toThrow();
  });
});

// ============================================================================
// clearCredentials()
// ============================================================================

describe('clearCredentials()', () => {
  it('removes credentials file when it exists', () => {
    mockExistsSync.mockReturnValue(true);

    clearCredentials();

    expect(mockUnlinkSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli/credentials.json'
    );
  });

  it('does nothing when credentials file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    clearCredentials();

    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});

// ============================================================================
// hasCredentials()
// ============================================================================

describe('hasCredentials()', () => {
  it('returns true when credentials file exists', () => {
    mockExistsSync.mockReturnValue(true);

    expect(hasCredentials()).toBe(true);
  });

  it('returns false when credentials file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(hasCredentials()).toBe(false);
  });
});

// ============================================================================
// isExpired()
// ============================================================================

describe('isExpired()', () => {
  it('returns false when token expires in the future', () => {
    const creds: Credentials = {
      ...validCredentials,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };

    expect(isExpired(creds)).toBe(false);
  });

  it('returns true when token has expired', () => {
    const creds: Credentials = {
      ...validCredentials,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    };

    expect(isExpired(creds)).toBe(true);
  });

  it('returns true when token expires within 5 minutes (safety margin)', () => {
    const creds: Credentials = {
      ...validCredentials,
      // Expires in 3 minutes — within the 5-minute safety margin
      expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    };

    expect(isExpired(creds)).toBe(true);
  });

  it('returns false when token expires in exactly 6 minutes', () => {
    const creds: Credentials = {
      ...validCredentials,
      expiresAt: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
    };

    expect(isExpired(creds)).toBe(false);
  });
});
