import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockExistsSync,
  mockOpenSync,
  mockReadSync,
  mockCloseSync,
  mockStatSync,
  mockGetLogFilePath,
  mockGetDaemonPid,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockOpenSync: vi.fn(),
  mockReadSync: vi.fn(),
  mockCloseSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockGetLogFilePath: vi.fn(),
  mockGetDaemonPid: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  readSync: (...args: unknown[]) => mockReadSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

vi.mock('node:fs/promises', () => ({
  open: vi.fn(),
}));

vi.mock('../daemon.js', () => ({
  getLogFilePath: () => mockGetLogFilePath(),
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

import { logsCommand } from '../logs.js';

// ── Helpers ─────────────────────────────────────────────────────────────────────

const FAKE_FD = 42;

/**
 * Set up mocks so readTail reads the given content from a fake file.
 * Simulates openSync → readSync (populates buffer) → closeSync.
 */
function mockFileContent(content: string): void {
  const bytes = Buffer.from(content, 'utf-8');
  mockStatSync.mockReturnValue({ size: bytes.length });
  mockOpenSync.mockReturnValue(FAKE_FD);
  mockReadSync.mockImplementation((
    _fd: number,
    buf: Buffer,
    _offset: number,
    length: number,
    position: number,
  ) => {
    bytes.copy(buf, 0, position, position + length);
    return length;
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('logsCommand', () => {
  let consoleSpy: MockInstance;
  let stdoutSpy: MockInstance;

  beforeEach(() => {
    mockExistsSync.mockReset();
    mockOpenSync.mockReset();
    mockReadSync.mockReset();
    mockCloseSync.mockReset();
    mockStatSync.mockReset();
    mockGetLogFilePath.mockReset();
    mockGetDaemonPid.mockReset();

    mockGetLogFilePath.mockReturnValue('/mock-home/.myndhyve-cli/logs/relay.log');

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('shows "no log file" when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await logsCommand({});

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No log file found');
    expect(output).toContain('/mock-home/.myndhyve-cli/logs/relay.log');
    expect(output).toContain('Start the daemon first');
  });

  it('shows daemon running status when daemon is active', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(42000);
    mockStatSync.mockReturnValue({ size: 0 });

    await logsCommand({});

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Daemon running (PID 42000)');
  });

  it('shows daemon not running when no daemon pid', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(null);
    mockStatSync.mockReturnValue({ size: 0 });

    await logsCommand({});

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Daemon not running');
  });

  it('shows log file path', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(null);
    mockStatSync.mockReturnValue({ size: 0 });

    await logsCommand({});

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Log file: /mock-home/.myndhyve-cli/logs/relay.log');
  });

  it('reads and outputs tail of log file with specified line count', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(null);

    const logLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    mockFileContent(logLines);

    await logsCommand({ lines: '10' });

    expect(mockOpenSync).toHaveBeenCalledWith(
      '/mock-home/.myndhyve-cli/logs/relay.log',
      'r'
    );
    expect(mockCloseSync).toHaveBeenCalledWith(FAKE_FD);
    expect(stdoutSpy).toHaveBeenCalled();

    // The output should contain the last 10 lines
    const writtenContent = stdoutSpy.mock.calls[0][0] as string;
    expect(writtenContent).toContain('Line 100');
    expect(writtenContent).toContain('Line 91');
    expect(writtenContent).not.toContain('Line 89');
  });

  it('defaults to 50 lines when lines option not specified', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(null);

    const logLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    mockFileContent(logLines);

    await logsCommand({});

    expect(stdoutSpy).toHaveBeenCalled();
    const writtenContent = stdoutSpy.mock.calls[0][0] as string;
    expect(writtenContent).toContain('Line 100');
    expect(writtenContent).toContain('Line 51');
    expect(writtenContent).not.toContain('Line 49');
  });

  it('does not output anything when log file is empty', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(null);
    mockStatSync.mockReturnValue({ size: 0 });

    await logsCommand({});

    // stdout.write should not be called for empty file (readTail returns '')
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('does not follow when follow option is false', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetDaemonPid.mockReturnValue(null);
    mockStatSync.mockReturnValue({ size: 0 });

    // Should resolve immediately without hanging
    await logsCommand({ follow: false });

    // If followLog were called, the function would block on the while loop.
    // The fact that this resolves proves follow is not invoked.
  });
});
