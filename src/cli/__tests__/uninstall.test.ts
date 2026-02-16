import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockExistsSync,
  mockRmSync,
  mockGetDaemonPid,
  mockStopDaemon,
  mockGetCliDir,
  mockLoadConfig,
  mockGetChannel,
  mockPrompt,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockGetDaemonPid: vi.fn(),
  mockStopDaemon: vi.fn(),
  mockGetCliDir: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockGetChannel: vi.fn(),
  mockPrompt: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
}));

vi.mock('../daemon.js', () => ({
  getDaemonPid: () => mockGetDaemonPid(),
  stopDaemon: () => mockStopDaemon(),
}));

vi.mock('../../config/loader.js', () => ({
  getCliDir: () => mockGetCliDir(),
  loadConfig: () => mockLoadConfig(),
}));

vi.mock('../../channels/registry.js', () => ({
  getChannel: (...args: unknown[]) => mockGetChannel(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('inquirer', () => ({
  default: { prompt: (...args: unknown[]) => mockPrompt(...args) },
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

import { uninstallCommand } from '../uninstall.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDefaultConfig(overrides?: Record<string, unknown>) {
  return {
    server: { baseUrl: 'https://api.test.com' },
    reconnect: { maxAttempts: Infinity, initialDelayMs: 1000, maxDelayMs: 300000 },
    heartbeat: { intervalSeconds: 30 },
    outbound: { pollIntervalSeconds: 5, maxPerPoll: 10 },
    logging: { level: 'info' },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('uninstallCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExistsSync.mockReset();
    mockRmSync.mockReset();
    mockGetDaemonPid.mockReset();
    mockStopDaemon.mockReset();
    mockGetCliDir.mockReset();
    mockLoadConfig.mockReset();
    mockGetChannel.mockReset();
    mockPrompt.mockReset();

    mockGetCliDir.mockReturnValue('/mock-home/.myndhyve-cli');
    mockLoadConfig.mockReturnValue(makeDefaultConfig());

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  // =========================================================================
  // EARLY EXIT
  // =========================================================================

  it('shows "nothing to uninstall" when relay dir does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await uninstallCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Nothing to uninstall');
    expect(output).toContain('/mock-home/.myndhyve-cli');
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('cancels when user says no to confirmation', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: false });

    await uninstallCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Cancelled');
    expect(mockStopDaemon).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  // =========================================================================
  // STEP 1: STOP DAEMON
  // =========================================================================

  it('stops daemon before removing data', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(55555);

    await uninstallCommand();

    expect(mockStopDaemon).toHaveBeenCalledOnce();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Stopping daemon (PID 55555)');
  });

  it('skips daemon stop when no daemon is running', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);

    await uninstallCommand();

    expect(mockStopDaemon).not.toHaveBeenCalled();
    // Should still proceed to remove directory
    expect(mockRmSync).toHaveBeenCalled();
  });

  // =========================================================================
  // STEP 2: LOGOUT FROM PLATFORM
  // =========================================================================

  it('logs out from platform when channel is configured', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);

    const mockPlugin = {
      displayName: 'WhatsApp',
      logout: vi.fn().mockResolvedValue(undefined),
    };
    mockLoadConfig.mockReturnValue(makeDefaultConfig({ channel: 'whatsapp' }));
    mockGetChannel.mockReturnValue(mockPlugin);

    await uninstallCommand();

    expect(mockGetChannel).toHaveBeenCalledWith('whatsapp');
    expect(mockPlugin.logout).toHaveBeenCalledOnce();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Clearing WhatsApp credentials');
  });

  it('skips logout when no channel is configured', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);
    // loadConfig returns config without channel (default)

    await uninstallCommand();

    expect(mockGetChannel).not.toHaveBeenCalled();
  });

  it('skips logout when channel plugin is not found', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);
    mockLoadConfig.mockReturnValue(makeDefaultConfig({ channel: 'signal' }));
    mockGetChannel.mockReturnValue(undefined);

    await uninstallCommand();

    // Should not throw and should proceed to rmSync
    expect(mockRmSync).toHaveBeenCalled();
  });

  it('handles logout failure gracefully', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);

    const mockPlugin = {
      displayName: 'Signal',
      logout: vi.fn().mockRejectedValue(new Error('Signal daemon not running')),
    };
    mockLoadConfig.mockReturnValue(makeDefaultConfig({ channel: 'signal' }));
    mockGetChannel.mockReturnValue(mockPlugin);

    // Should not throw — the error is caught internally
    await uninstallCommand();

    // Should still proceed to remove directory
    expect(mockRmSync).toHaveBeenCalled();
  });

  // =========================================================================
  // STEP 3: REMOVE DIRECTORY
  // =========================================================================

  it('removes relay directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);

    await uninstallCommand();

    expect(mockRmSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli',
      { recursive: true, force: true }
    );

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Uninstalled. All relay data has been removed');
    expect(output).toContain('myndhyve-cli relay setup');
  });

  it('handles rmSync failure gracefully', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(null);
    mockRmSync.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted');
    });

    await uninstallCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Failed to remove /mock-home/.myndhyve-cli');
    expect(output).toContain('rm -rf "/mock-home/.myndhyve-cli"');
    expect(process.exitCode).toBe(1);
  });

  // =========================================================================
  // FULL FLOW ORDER
  // =========================================================================

  it('performs full uninstall flow in correct order', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPrompt.mockResolvedValue({ confirm: true });
    mockGetDaemonPid.mockReturnValue(11111);

    const logoutFn = vi.fn().mockResolvedValue(undefined);
    const mockPlugin = { displayName: 'WhatsApp', logout: logoutFn };
    mockLoadConfig.mockReturnValue(makeDefaultConfig({ channel: 'whatsapp' }));
    mockGetChannel.mockReturnValue(mockPlugin);

    await uninstallCommand();

    // Verify the order: stop daemon -> logout -> rmSync
    const stopOrder = mockStopDaemon.mock.invocationCallOrder[0];
    const logoutOrder = logoutFn.mock.invocationCallOrder[0];
    const rmOrder = mockRmSync.mock.invocationCallOrder[0];

    expect(stopOrder).toBeLessThan(logoutOrder);
    expect(logoutOrder).toBeLessThan(rmOrder);
  });
});
