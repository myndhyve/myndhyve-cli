import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const { mockGetDaemonPid, mockStopDaemon } = vi.hoisted(() => ({
  mockGetDaemonPid: vi.fn(),
  mockStopDaemon: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../daemon.js', () => ({
  getDaemonPid: (...args: unknown[]) => mockGetDaemonPid(...args),
  stopDaemon: (...args: unknown[]) => mockStopDaemon(...args),
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

import { stopCommand } from '../stop.js';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('stopCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetDaemonPid.mockReset();
    mockStopDaemon.mockReset();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('shows "not running" when daemon is not running', async () => {
    mockGetDaemonPid.mockReturnValue(null);

    await stopCommand();

    expect(mockGetDaemonPid).toHaveBeenCalledOnce();
    expect(mockStopDaemon).not.toHaveBeenCalled();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Relay daemon is not running');
  });

  it('stops daemon and shows success when running', async () => {
    mockGetDaemonPid.mockReturnValue(12345);
    mockStopDaemon.mockReturnValue(true);

    await stopCommand();

    expect(mockGetDaemonPid).toHaveBeenCalledOnce();
    expect(mockStopDaemon).toHaveBeenCalledOnce();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Stopping relay daemon (PID 12345)');
    expect(output).toContain('Relay daemon stopped');
  });

  it('shows "stale PID" message when stopDaemon returns false', async () => {
    mockGetDaemonPid.mockReturnValue(99999);
    mockStopDaemon.mockReturnValue(false);

    await stopCommand();

    expect(mockStopDaemon).toHaveBeenCalledOnce();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('stale PID file cleaned up');
  });
});
