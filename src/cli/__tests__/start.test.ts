import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables — available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockLoadConfiguredRelay,
  mockGetChannel,
  mockSpawnDaemon,
  mockGetDaemonPid,
  mockSetLogLevel,
} = vi.hoisted(() => ({
  mockLoadConfiguredRelay: vi.fn(),
  mockGetChannel: vi.fn(),
  mockSpawnDaemon: vi.fn(),
  mockGetDaemonPid: vi.fn(),
  mockSetLogLevel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks — intercept every import used by start.ts
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  setLogLevel: (...args: unknown[]) => mockSetLogLevel(...args),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfiguredRelay: () => mockLoadConfiguredRelay(),
}));

vi.mock('../../relay/client.js', () => ({
  RelayClient: vi.fn(),
}));

vi.mock('../../relay/heartbeat.js', () => ({
  startHeartbeatLoop: vi.fn(),
}));

vi.mock('../../relay/outbound-poller.js', () => ({
  startOutboundPoller: vi.fn(),
}));

vi.mock('../../channels/registry.js', () => ({
  getChannel: (...args: unknown[]) => mockGetChannel(...args),
  ensureChannelsLoaded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
}));

vi.mock('../../utils/backoff.js', () => ({
  computeBackoff: vi.fn(),
  isMaxAttemptsReached: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('../daemon.js', () => ({
  spawnDaemon: (...args: unknown[]) => mockSpawnDaemon(...args),
  getDaemonPid: () => mockGetDaemonPid(),
}));

// chalk — passthrough for all style methods
vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<typeof passthrough> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target, _thisArg, args: [string]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(overrides?: Record<string, unknown>) {
  return {
    channel: 'imessage',
    displayName: 'iMessage',
    isSupported: true,
    unsupportedReason: undefined,
    isAuthenticated: vi.fn().mockResolvedValue(true),
    login: vi.fn(),
    start: vi.fn(),
    deliver: vi.fn(),
    getStatus: vi.fn(() => 'connected'),
    ...overrides,
  };
}

function makeConfig() {
  return {
    channel: 'imessage',
    relayId: 'relay-abcdef123456',
    deviceToken: 'tok_abc',
    server: { baseUrl: 'https://api.example.com' },
    logging: { level: 'info' },
    heartbeat: { intervalSeconds: 30 },
    outbound: { pollIntervalSeconds: 5, maxBatchSize: 10 },
    reconnect: { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 30000 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLoadConfiguredRelay.mockReset();
    mockGetChannel.mockReset();
    mockSpawnDaemon.mockReset();
    mockGetDaemonPid.mockReset();
    mockSetLogLevel.mockReset();

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  // =========================================================================
  // DAEMON MODE
  // =========================================================================

  describe('--daemon flag', () => {
    it('spawns daemon and shows success message with PID', async () => {
      const { startCommand } = await import('../start.js');
      mockGetDaemonPid.mockReturnValue(null);
      mockSpawnDaemon.mockReturnValue(42_001);

      await startCommand({ daemon: true });

      expect(mockSpawnDaemon).toHaveBeenCalledOnce();
      expect(mockSpawnDaemon).toHaveBeenCalledWith(undefined);

      // Should show success output containing the PID
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('42001');
      expect(output).toContain('started');

      // Should NOT set exitCode
      expect(process.exitCode).toBeUndefined();
    });

    it('shows "already running" when daemon PID exists', async () => {
      const { startCommand } = await import('../start.js');
      mockGetDaemonPid.mockReturnValue(99_123);

      await startCommand({ daemon: true });

      expect(mockSpawnDaemon).not.toHaveBeenCalled();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('already running');
      expect(output).toContain('99123');
    });

    it('shows error and sets exitCode when spawnDaemon fails', async () => {
      const { startCommand } = await import('../start.js');
      mockGetDaemonPid.mockReturnValue(null);
      mockSpawnDaemon.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await startCommand({ daemon: true });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Failed to start daemon');
      expect(output).toContain('Permission denied');
      expect(process.exitCode).toBe(1);
    });

    it('passes verbose flag to spawnDaemon when --verbose is set', async () => {
      const { startCommand } = await import('../start.js');
      mockGetDaemonPid.mockReturnValue(null);
      mockSpawnDaemon.mockReturnValue(55_555);

      await startCommand({ daemon: true, verbose: true });

      expect(mockSpawnDaemon).toHaveBeenCalledWith(true);
      expect(mockSetLogLevel).toHaveBeenCalledWith('debug');
    });

    it('does NOT run the normal foreground start flow', async () => {
      const { startCommand } = await import('../start.js');
      mockGetDaemonPid.mockReturnValue(null);
      mockSpawnDaemon.mockReturnValue(1234);

      await startCommand({ daemon: true });

      // loadConfiguredRelay and getChannel belong to the foreground path
      expect(mockLoadConfiguredRelay).not.toHaveBeenCalled();
      expect(mockGetChannel).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // FOREGROUND MODE — Pre-flight checks
  // =========================================================================

  describe('foreground pre-flight checks', () => {
    it('shows error when not configured', async () => {
      const { startCommand } = await import('../start.js');
      mockLoadConfiguredRelay.mockReturnValue(null);

      await startCommand({});

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('not configured');
      expect(output).toContain('setup');
      expect(process.exitCode).toBe(1);
    });

    it('shows error when channel plugin not available', async () => {
      const { startCommand } = await import('../start.js');
      mockLoadConfiguredRelay.mockReturnValue(makeConfig());
      mockGetChannel.mockReturnValue(null);

      await startCommand({});

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('not available');
      expect(process.exitCode).toBe(1);
    });

    it('shows error when platform not supported', async () => {
      const { startCommand } = await import('../start.js');
      mockLoadConfiguredRelay.mockReturnValue(makeConfig());
      mockGetChannel.mockReturnValue(
        makePlugin({ isSupported: false, unsupportedReason: 'Requires macOS' }),
      );

      await startCommand({});

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('not supported');
      expect(output).toContain('Requires macOS');
      expect(process.exitCode).toBe(1);
    });

    it('shows error when not authenticated', async () => {
      const { startCommand } = await import('../start.js');
      const plugin = makePlugin({ isAuthenticated: vi.fn().mockResolvedValue(false) });
      mockLoadConfiguredRelay.mockReturnValue(makeConfig());
      mockGetChannel.mockReturnValue(plugin);

      await startCommand({});

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Not authenticated');
      expect(output).toContain('login');
      expect(process.exitCode).toBe(1);
    });
  });
});
