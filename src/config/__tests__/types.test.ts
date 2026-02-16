import { describe, it, expect } from 'vitest';
import {
  RelayConfigSchema,
  ReconnectConfigSchema,
  HeartbeatConfigSchema,
  OutboundConfigSchema,
  LoggingConfigSchema,
} from '../types.js';

// ============================================================================
// RelayConfigSchema
// ============================================================================

describe('RelayConfigSchema', () => {
  it('returns full defaults for empty input', () => {
    const config = RelayConfigSchema.parse({});

    expect(config.server.baseUrl).toBe(
      'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway'
    );
    expect(config.channel).toBeUndefined();
    expect(config.relayId).toBeUndefined();
    expect(config.deviceToken).toBeUndefined();
    expect(config.userId).toBeUndefined();
    expect(config.reconnect).toEqual({
      maxAttempts: Infinity,
      initialDelayMs: 1_000,
      maxDelayMs: 300_000,
      watchdogTimeoutMs: 1_800_000,
    });
    expect(config.heartbeat).toEqual({ intervalSeconds: 30 });
    expect(config.outbound).toEqual({ pollIntervalSeconds: 5, maxPerPoll: 10 });
    expect(config.logging).toEqual({ level: 'info' });
  });

  it('accepts valid channel "whatsapp"', () => {
    const config = RelayConfigSchema.parse({ channel: 'whatsapp' });
    expect(config.channel).toBe('whatsapp');
  });

  it('accepts valid channel "signal"', () => {
    const config = RelayConfigSchema.parse({ channel: 'signal' });
    expect(config.channel).toBe('signal');
  });

  it('accepts valid channel "imessage"', () => {
    const config = RelayConfigSchema.parse({ channel: 'imessage' });
    expect(config.channel).toBe('imessage');
  });

  it('rejects invalid channel values', () => {
    expect(() => RelayConfigSchema.parse({ channel: 'telegram' })).toThrow();
    expect(() => RelayConfigSchema.parse({ channel: 'sms' })).toThrow();
    expect(() => RelayConfigSchema.parse({ channel: '' })).toThrow();
    expect(() => RelayConfigSchema.parse({ channel: 123 })).toThrow();
  });

  it('allows channel to be omitted (optional)', () => {
    const config = RelayConfigSchema.parse({});
    expect(config.channel).toBeUndefined();
  });

  it('preserves provided relayId and deviceToken', () => {
    const config = RelayConfigSchema.parse({
      relayId: 'relay-abc',
      deviceToken: 'dt-xyz',
    });
    expect(config.relayId).toBe('relay-abc');
    expect(config.deviceToken).toBe('dt-xyz');
  });

  it('overrides default server baseUrl', () => {
    const config = RelayConfigSchema.parse({
      server: { baseUrl: 'https://custom.api.com/relay' },
    });
    expect(config.server.baseUrl).toBe('https://custom.api.com/relay');
  });

  it('rejects invalid server baseUrl (not a URL)', () => {
    expect(() =>
      RelayConfigSchema.parse({ server: { baseUrl: 'not-a-url' } })
    ).toThrow();
  });

  it('merges partial nested configs with defaults', () => {
    const config = RelayConfigSchema.parse({
      heartbeat: { intervalSeconds: 120 },
      outbound: { pollIntervalSeconds: 15 },
    });
    expect(config.heartbeat.intervalSeconds).toBe(120);
    expect(config.outbound.pollIntervalSeconds).toBe(15);
    expect(config.outbound.maxPerPoll).toBe(10); // default preserved
    expect(config.reconnect.initialDelayMs).toBe(1_000); // untouched section
  });

  it('stores userId when provided', () => {
    const config = RelayConfigSchema.parse({ userId: 'user-42' });
    expect(config.userId).toBe('user-42');
  });
});

// ============================================================================
// ReconnectConfigSchema
// ============================================================================

describe('ReconnectConfigSchema', () => {
  it('returns all defaults for empty input', () => {
    const config = ReconnectConfigSchema.parse({});
    expect(config.maxAttempts).toBe(Infinity);
    expect(config.initialDelayMs).toBe(1_000);
    expect(config.maxDelayMs).toBe(300_000);
    expect(config.watchdogTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('accepts custom numeric values', () => {
    const config = ReconnectConfigSchema.parse({
      maxAttempts: 5,
      initialDelayMs: 500,
      maxDelayMs: 60_000,
      watchdogTimeoutMs: 600_000,
    });
    expect(config.maxAttempts).toBe(5);
    expect(config.initialDelayMs).toBe(500);
    expect(config.maxDelayMs).toBe(60_000);
    expect(config.watchdogTimeoutMs).toBe(600_000);
  });

  it('rejects non-positive numbers', () => {
    expect(() => ReconnectConfigSchema.parse({ maxAttempts: 0 })).toThrow();
    expect(() => ReconnectConfigSchema.parse({ initialDelayMs: -1 })).toThrow();
    expect(() => ReconnectConfigSchema.parse({ maxDelayMs: 0 })).toThrow();
  });

  it('rejects non-integer numbers for int-constrained fields', () => {
    // maxAttempts allows non-integers (to support Infinity default)
    expect(() => ReconnectConfigSchema.parse({ initialDelayMs: 99.9 })).toThrow();
    expect(() => ReconnectConfigSchema.parse({ maxDelayMs: 1.5 })).toThrow();
    expect(() => ReconnectConfigSchema.parse({ watchdogTimeoutMs: 0.5 })).toThrow();
  });

  it('accepts non-integer maxAttempts (e.g. Infinity)', () => {
    const config = ReconnectConfigSchema.parse({ maxAttempts: Infinity });
    expect(config.maxAttempts).toBe(Infinity);
  });

  it('rejects string values', () => {
    expect(() => ReconnectConfigSchema.parse({ maxAttempts: '10' })).toThrow();
  });
});

// ============================================================================
// HeartbeatConfigSchema
// ============================================================================

describe('HeartbeatConfigSchema', () => {
  it('returns default intervalSeconds of 30 for empty input', () => {
    const config = HeartbeatConfigSchema.parse({});
    expect(config.intervalSeconds).toBe(30);
  });

  it('accepts custom intervalSeconds', () => {
    const config = HeartbeatConfigSchema.parse({ intervalSeconds: 60 });
    expect(config.intervalSeconds).toBe(60);
  });

  it('rejects zero or negative intervalSeconds', () => {
    expect(() => HeartbeatConfigSchema.parse({ intervalSeconds: 0 })).toThrow();
    expect(() => HeartbeatConfigSchema.parse({ intervalSeconds: -5 })).toThrow();
  });

  it('rejects non-integer intervalSeconds', () => {
    expect(() => HeartbeatConfigSchema.parse({ intervalSeconds: 10.5 })).toThrow();
  });
});

// ============================================================================
// OutboundConfigSchema
// ============================================================================

describe('OutboundConfigSchema', () => {
  it('returns defaults for empty input', () => {
    const config = OutboundConfigSchema.parse({});
    expect(config.pollIntervalSeconds).toBe(5);
    expect(config.maxPerPoll).toBe(10);
  });

  it('accepts custom pollIntervalSeconds', () => {
    const config = OutboundConfigSchema.parse({ pollIntervalSeconds: 15 });
    expect(config.pollIntervalSeconds).toBe(15);
    expect(config.maxPerPoll).toBe(10); // default
  });

  it('accepts custom maxPerPoll', () => {
    const config = OutboundConfigSchema.parse({ maxPerPoll: 50 });
    expect(config.maxPerPoll).toBe(50);
    expect(config.pollIntervalSeconds).toBe(5); // default
  });

  it('rejects non-positive pollIntervalSeconds', () => {
    expect(() => OutboundConfigSchema.parse({ pollIntervalSeconds: 0 })).toThrow();
    expect(() => OutboundConfigSchema.parse({ pollIntervalSeconds: -1 })).toThrow();
  });

  it('rejects non-integer maxPerPoll', () => {
    expect(() => OutboundConfigSchema.parse({ maxPerPoll: 2.5 })).toThrow();
  });
});

// ============================================================================
// LoggingConfigSchema
// ============================================================================

describe('LoggingConfigSchema', () => {
  it('returns default level "info" for empty input', () => {
    const config = LoggingConfigSchema.parse({});
    expect(config.level).toBe('info');
    expect(config.file).toBeUndefined();
  });

  it('accepts "debug" level', () => {
    const config = LoggingConfigSchema.parse({ level: 'debug' });
    expect(config.level).toBe('debug');
  });

  it('accepts "info" level', () => {
    const config = LoggingConfigSchema.parse({ level: 'info' });
    expect(config.level).toBe('info');
  });

  it('accepts "warn" level', () => {
    const config = LoggingConfigSchema.parse({ level: 'warn' });
    expect(config.level).toBe('warn');
  });

  it('accepts "error" level', () => {
    const config = LoggingConfigSchema.parse({ level: 'error' });
    expect(config.level).toBe('error');
  });

  it('rejects invalid level values', () => {
    expect(() => LoggingConfigSchema.parse({ level: 'trace' })).toThrow();
    expect(() => LoggingConfigSchema.parse({ level: 'fatal' })).toThrow();
    expect(() => LoggingConfigSchema.parse({ level: 'verbose' })).toThrow();
    expect(() => LoggingConfigSchema.parse({ level: '' })).toThrow();
  });

  it('accepts optional file path', () => {
    const config = LoggingConfigSchema.parse({
      level: 'debug',
      file: '/var/log/relay.log',
    });
    expect(config.file).toBe('/var/log/relay.log');
  });

  it('allows file to be omitted', () => {
    const config = LoggingConfigSchema.parse({ level: 'info' });
    expect(config.file).toBeUndefined();
  });
});
