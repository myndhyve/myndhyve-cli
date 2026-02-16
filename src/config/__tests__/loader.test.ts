import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock node:fs and node:os BEFORE importing loader ─────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  getCliDir,
  getConfigPath,
  getAuthDir,
  getLogDir,
  ensureCliDir,
  ensureAuthDir,
  ensureLogDir,
  loadConfig,
  saveConfig,
  updateConfig,
  isConfigured,
} from '../loader.js';
import type { RelayConfig } from '../types.js';

// ── Cast mocks ───────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockExistsSync.mockReset();
  mockMkdirSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  (homedir as ReturnType<typeof vi.fn>).mockReturnValue('/mock-home');
});

// ============================================================================
// PATH HELPERS
// ============================================================================

describe('getCliDir()', () => {
  it('returns correct path based on homedir', () => {
    expect(getCliDir()).toBe('/mock-home/.myndhyve-cli');
  });

  it('reflects changed homedir', () => {
    (homedir as ReturnType<typeof vi.fn>).mockReturnValue('/other-home');
    expect(getCliDir()).toBe('/other-home/.myndhyve-cli');
  });
});

describe('getConfigPath()', () => {
  it('returns config.json within relay dir', () => {
    expect(getConfigPath()).toBe('/mock-home/.myndhyve-cli/config.json');
  });
});

describe('getAuthDir()', () => {
  it('returns channel subdirectory', () => {
    expect(getAuthDir('whatsapp')).toBe('/mock-home/.myndhyve-cli/whatsapp');
    expect(getAuthDir('signal')).toBe('/mock-home/.myndhyve-cli/signal');
  });
});

describe('getLogDir()', () => {
  it('returns logs subdirectory', () => {
    expect(getLogDir()).toBe('/mock-home/.myndhyve-cli/logs');
  });
});

// ============================================================================
// ENSURE DIRECTORIES
// ============================================================================

describe('ensureCliDir()', () => {
  it('creates directory with 0o700 permissions when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    ensureCliDir();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli',
      { recursive: true, mode: 0o700 }
    );
  });

  it('does not create directory when it already exists', () => {
    mockExistsSync.mockReturnValue(true);

    ensureCliDir();

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe('ensureAuthDir()', () => {
  it('creates channel subdirectory when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = ensureAuthDir('signal');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli/signal',
      { recursive: true, mode: 0o700 }
    );
    expect(result).toBe('/mock-home/.myndhyve-cli/signal');
  });

  it('returns existing directory path without creating', () => {
    mockExistsSync.mockReturnValue(true);

    const result = ensureAuthDir('whatsapp');

    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(result).toBe('/mock-home/.myndhyve-cli/whatsapp');
  });
});

describe('ensureLogDir()', () => {
  it('creates logs directory when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = ensureLogDir();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli/logs',
      { recursive: true, mode: 0o700 }
    );
    expect(result).toBe('/mock-home/.myndhyve-cli/logs');
  });
});

// ============================================================================
// loadConfig()
// ============================================================================

describe('loadConfig()', () => {
  it('returns defaults when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const config = loadConfig();

    expect(config.server.baseUrl).toBe(
      'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway'
    );
    expect(config.channel).toBeUndefined();
    expect(config.relayId).toBeUndefined();
    expect(config.deviceToken).toBeUndefined();
    expect(config.reconnect.maxAttempts).toBe(Infinity);
    expect(config.reconnect.initialDelayMs).toBe(1_000);
    expect(config.reconnect.maxDelayMs).toBe(300_000);
    expect(config.heartbeat.intervalSeconds).toBe(30);
    expect(config.outbound.pollIntervalSeconds).toBe(5);
    expect(config.outbound.maxPerPoll).toBe(10);
    expect(config.logging.level).toBe('info');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('parses valid config file and returns full config', () => {
    mockExistsSync.mockReturnValue(true);
    const onDisk = {
      channel: 'whatsapp',
      relayId: 'relay-abc',
      deviceToken: 'dt-xyz',
      userId: 'user-123',
      server: { baseUrl: 'https://custom.api.com/relay' },
      heartbeat: { intervalSeconds: 60 },
      logging: { level: 'debug' },
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(onDisk));

    const config = loadConfig();

    expect(config.channel).toBe('whatsapp');
    expect(config.relayId).toBe('relay-abc');
    expect(config.deviceToken).toBe('dt-xyz');
    expect(config.userId).toBe('user-123');
    expect(config.server.baseUrl).toBe('https://custom.api.com/relay');
    expect(config.heartbeat.intervalSeconds).toBe(60);
    expect(config.logging.level).toBe('debug');
    // Defaults should still apply for unspecified fields
    expect(config.reconnect.initialDelayMs).toBe(1_000);
    expect(config.outbound.pollIntervalSeconds).toBe(5);
  });

  it('returns defaults when config file is corrupted JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const config = loadConfig();

    // Should not throw, returns defaults
    expect(config.server.baseUrl).toBe(
      'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway'
    );
    expect(config.heartbeat.intervalSeconds).toBe(30);
  });

  it('returns defaults when readFileSync throws (permission denied)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const config = loadConfig();

    expect(config.server.baseUrl).toBe(
      'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway'
    );
  });

  it('applies defaults for partial config files', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ channel: 'signal' }));

    const config = loadConfig();

    expect(config.channel).toBe('signal');
    // All nested defaults should be populated
    expect(config.server.baseUrl).toContain('myndhyve');
    expect(config.reconnect.maxDelayMs).toBe(300_000);
    expect(config.outbound.maxPerPoll).toBe(10);
  });
});

// ============================================================================
// saveConfig()
// ============================================================================

describe('saveConfig()', () => {
  it('writes JSON with correct file permissions (0o600)', () => {
    // ensureCliDir will check existsSync for the dir
    mockExistsSync.mockReturnValue(true);

    const config = {
      server: { baseUrl: 'https://api.test.com' },
      channel: 'whatsapp' as const,
      relayId: 'relay-123',
      deviceToken: 'dt-secret',
      reconnect: {
        maxAttempts: Infinity,
        initialDelayMs: 1000,
        maxDelayMs: 300000,
        watchdogTimeoutMs: 1800000,
      },
      heartbeat: { intervalSeconds: 30 },
      outbound: { pollIntervalSeconds: 5, maxPerPoll: 10 },
      logging: { level: 'info' as const },
    } satisfies RelayConfig;

    saveConfig(config);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [path, content, options] = mockWriteFileSync.mock.calls[0];
    expect(path).toBe('/mock-home/.myndhyve-cli/config.json');
    expect(options).toEqual({ mode: 0o600 });

    // Verify written JSON parses back correctly
    const parsed = JSON.parse(content as string);
    expect(parsed.relayId).toBe('relay-123');
    expect(parsed.deviceToken).toBe('dt-secret');
    expect(parsed.channel).toBe('whatsapp');
  });

  it('creates directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const config = {
      server: { baseUrl: 'https://api.test.com' },
      reconnect: {
        maxAttempts: Infinity,
        initialDelayMs: 1000,
        maxDelayMs: 300000,
        watchdogTimeoutMs: 1800000,
      },
      heartbeat: { intervalSeconds: 30 },
      outbound: { pollIntervalSeconds: 5, maxPerPoll: 10 },
      logging: { level: 'info' as const },
    } satisfies RelayConfig;

    saveConfig(config);

    // ensureCliDir should have been called and created the dir
    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli',
      { recursive: true, mode: 0o700 }
    );
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('writes pretty-printed JSON (2-space indent)', () => {
    mockExistsSync.mockReturnValue(true);

    const config = {
      server: { baseUrl: 'https://api.test.com' },
      reconnect: {
        maxAttempts: Infinity,
        initialDelayMs: 1000,
        maxDelayMs: 300000,
        watchdogTimeoutMs: 1800000,
      },
      heartbeat: { intervalSeconds: 30 },
      outbound: { pollIntervalSeconds: 5, maxPerPoll: 10 },
      logging: { level: 'info' as const },
    } satisfies RelayConfig;

    saveConfig(config);

    const [, content] = mockWriteFileSync.mock.calls[0];
    expect(content).toBe(JSON.stringify(config, null, 2));
  });
});

// ============================================================================
// updateConfig()
// ============================================================================

describe('updateConfig()', () => {
  it('merges patch with existing config and saves', () => {
    // loadConfig will read existing
    mockExistsSync.mockReturnValue(true);
    const existing = {
      channel: 'whatsapp',
      relayId: 'relay-old',
      server: { baseUrl: 'https://old.api.com' },
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const updated = updateConfig({ relayId: 'relay-new', deviceToken: 'dt-fresh' });

    expect(updated.relayId).toBe('relay-new');
    expect(updated.deviceToken).toBe('dt-fresh');
    expect(updated.channel).toBe('whatsapp');
    expect(updated.server.baseUrl).toBe('https://old.api.com');
    // Verify it was saved
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('creates config from defaults when no existing file', () => {
    mockExistsSync.mockImplementation((path: string) => {
      // Config file does not exist, but relay dir may or may not
      if ((path as string).endsWith('config.json')) return false;
      return false; // dir also does not exist
    });

    const updated = updateConfig({ channel: 'signal' });

    expect(updated.channel).toBe('signal');
    expect(updated.server.baseUrl).toContain('myndhyve');
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('returns validated config (rejects invalid patch values)', () => {
    mockExistsSync.mockReturnValue(false);

    // Invalid channel should throw during Zod parse
    expect(() => {
      updateConfig({ channel: 'telegram' as unknown as Parameters<typeof updateConfig>[0]['channel'] });
    }).toThrow();
  });
});

// ============================================================================
// isConfigured()
// ============================================================================

describe('isConfigured()', () => {
  it('returns true when relayId, deviceToken, and channel are all present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        relayId: 'relay-123',
        deviceToken: 'dt-abc',
        channel: 'whatsapp',
      })
    );

    expect(isConfigured()).toBe(true);
  });

  it('returns false when relayId is missing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        deviceToken: 'dt-abc',
        channel: 'whatsapp',
      })
    );

    expect(isConfigured()).toBe(false);
  });

  it('returns false when deviceToken is missing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        relayId: 'relay-123',
        channel: 'whatsapp',
      })
    );

    expect(isConfigured()).toBe(false);
  });

  it('returns false when channel is missing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        relayId: 'relay-123',
        deviceToken: 'dt-abc',
      })
    );

    expect(isConfigured()).toBe(false);
  });

  it('returns false when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(isConfigured()).toBe(false);
  });

  it('returns false when all three fields are empty strings', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        relayId: '',
        deviceToken: '',
        channel: 'whatsapp',
      })
    );

    // Empty strings are falsy
    expect(isConfigured()).toBe(false);
  });
});
