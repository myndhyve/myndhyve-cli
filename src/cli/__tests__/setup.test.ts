import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockLoadConfig,
  mockSaveConfig,
  mockIsConfigured,
  mockEnsureCliDir,
  mockRegister,
  mockActivate,
  mockCliVersion,
  mockLogger,
  mockPrintErrorResult,
  mockPrompt,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockIsConfigured: vi.fn(),
  mockEnsureCliDir: vi.fn(),
  mockRegister: vi.fn(),
  mockActivate: vi.fn(),
  mockCliVersion: '0.1.0',
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockPrintErrorResult: vi.fn(),
  mockPrompt: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../config/loader.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  isConfigured: (...args: unknown[]) => mockIsConfigured(...args),
  ensureCliDir: (...args: unknown[]) => mockEnsureCliDir(...args),
}));

vi.mock('../../relay/client.js', () => ({
  RelayClient: class {
    constructor() {}
    register = (...args: unknown[]) => mockRegister(...args);
    activate = (...args: unknown[]) => mockActivate(...args);
  },
}));

vi.mock('../../config/defaults.js', () => ({
  CLI_VERSION: mockCliVersion,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: {
    SUCCESS: 0,
    GENERAL_ERROR: 1,
    USAGE_ERROR: 2,
    NOT_FOUND: 3,
    UNAUTHORIZED: 4,
    SIGINT: 130,
  },
  printErrorResult: (...args: unknown[]) => mockPrintErrorResult(...args),
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

// inquirer mock
vi.mock('inquirer', () => ({
  default: { prompt: (...args: unknown[]) => mockPrompt(...args) },
}));

// ora — spinner mock
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  }),
}));

import { setupCommand } from '../setup.js';

// ── Mock data ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  channel: undefined,
  relayId: undefined,
  deviceToken: undefined,
  server: { baseUrl: 'https://example.com' },
  heartbeat: { intervalSeconds: 30 },
  outbound: { pollIntervalSeconds: 5, maxPerPoll: 10 },
  reconnect: { maxAttempts: Infinity, initialDelayMs: 1000, maxDelayMs: 300000 },
  logging: { level: 'info' },
};

const CONFIGURED_CONFIG = {
  ...DEFAULT_CONFIG,
  channel: 'signal',
  relayId: 'relay-abc12345-full-id',
  deviceToken: 'token-xyz',
};

const MOCK_REGISTRATION = {
  relayId: 'relay-newdevice-123456-full',
  activationCode: 'act-code-789',
};

const MOCK_ACTIVATION = {
  deviceToken: 'new-device-token',
  heartbeatIntervalSeconds: 60,
  outboundPollIntervalSeconds: 10,
};

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('setupCommand', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;
  let origPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    mockLoadConfig.mockReset();
    mockSaveConfig.mockReset();
    mockIsConfigured.mockReset();
    mockEnsureCliDir.mockReset();
    mockRegister.mockReset();
    mockActivate.mockReset();
    mockPrintErrorResult.mockReset();
    mockPrompt.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();

    // Defaults
    mockIsConfigured.mockReturnValue(false);
    mockLoadConfig.mockReturnValue({ ...DEFAULT_CONFIG });

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    process.exitCode = undefined;
    // Restore platform if we overrode it
    if (origPlatform) {
      Object.defineProperty(process, 'platform', origPlatform);
      origPlatform = undefined;
    }
  });

  // ==========================================================================
  // HEADER / BANNER
  // ==========================================================================

  describe('header', () => {
    it('shows header banner', async () => {
      // Set up prompts to select signal and provide all inputs
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MyndHyve CLI');
      expect(output).toContain('Relay Setup');
    });
  });

  // ==========================================================================
  // ALREADY CONFIGURED
  // ==========================================================================

  describe('already configured', () => {
    it('exits when user declines reconfigure', async () => {
      mockIsConfigured.mockReturnValue(true);
      mockLoadConfig.mockReturnValue({ ...CONFIGURED_CONFIG });

      mockPrompt.mockResolvedValueOnce({ overwrite: false });

      await setupCommand();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Setup cancelled');
      // Should not proceed to channel selection
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('continues when user accepts reconfigure', async () => {
      mockIsConfigured.mockReturnValue(true);
      mockLoadConfig
        .mockReturnValueOnce({ ...CONFIGURED_CONFIG })  // isConfigured check
        .mockReturnValueOnce({ ...DEFAULT_CONFIG });     // loadConfig for registration

      mockPrompt
        .mockResolvedValueOnce({ overwrite: true })
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      expect(mockRegister).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CHANNEL SELECTION
  // ==========================================================================

  describe('channel selection', () => {
    it('selects signal channel with no warnings', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Warning');
      expect(mockRegister).toHaveBeenCalledWith(
        'signal',
        'test-device',
        'valid-auth-token-1234567890',
      );
    });

    it('shows whatsapp warning and exits when user declines', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'whatsapp' })
        .mockResolvedValueOnce({ proceed: false });

      await setupCommand();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('WhatsApp');
      expect(output).toContain('Baileys');
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('proceeds with whatsapp when user accepts warning', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'whatsapp' })
        .mockResolvedValueOnce({ proceed: true })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      expect(mockRegister).toHaveBeenCalledWith(
        'whatsapp',
        'test-device',
        'valid-auth-token-1234567890',
      );
    });

    it('shows unsupported error for iMessage on non-darwin', async () => {
      origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockPrompt.mockResolvedValueOnce({ channel: 'imessage' });

      await setupCommand();

      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNSUPPORTED_PLATFORM',
          message: 'iMessage is only available on macOS.',
        }),
      );
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // REGISTRATION
  // ==========================================================================

  describe('registration', () => {
    it('shows relay ID on success', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      expect(mockRegister).toHaveBeenCalledWith(
        'signal',
        'test-device',
        'valid-auth-token-1234567890',
      );
      // The spinner succeed message contains the relay ID prefix
      // And the overall output should show success
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Setup complete');
    });

    it('shows error and sets exitCode=1 on registration failure', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockRejectedValue(new Error('Server unavailable'));

      await setupCommand();

      expect(process.exitCode).toBe(1);
      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'REGISTRATION_FAILED',
          message: 'Server unavailable',
        }),
      );
      expect(mockActivate).not.toHaveBeenCalled();
    });

    it('logs error on registration failure', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockRejectedValue(new Error('Bad request'));

      await setupCommand();

      expect(mockLogger.error).toHaveBeenCalledWith('Setup failed', expect.any(Error));
    });
  });

  // ==========================================================================
  // ACTIVATION
  // ==========================================================================

  describe('activation', () => {
    it('shows error and sets exitCode=1 on activation failure', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockRejectedValue(new Error('Activation timeout'));

      await setupCommand();

      expect(process.exitCode).toBe(1);
      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ACTIVATION_FAILED',
          message: 'Activation timeout',
        }),
      );
    });

    it('saves config after successful activation', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      expect(mockEnsureCliDir).toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'signal',
          relayId: MOCK_REGISTRATION.relayId,
          deviceToken: MOCK_ACTIVATION.deviceToken,
          heartbeat: expect.objectContaining({
            intervalSeconds: MOCK_ACTIVATION.heartbeatIntervalSeconds,
          }),
          outbound: expect.objectContaining({
            pollIntervalSeconds: MOCK_ACTIVATION.outboundPollIntervalSeconds,
          }),
        }),
      );
    });

    it('shows next steps after successful setup', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Setup complete');
      expect(output).toContain('myndhyve-cli relay login');
      expect(output).toContain('myndhyve-cli relay start');
    });

    it('logs info on successful setup', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      expect(mockLogger.info).toHaveBeenCalledWith('Setup complete', {
        channel: 'signal',
        relayId: MOCK_REGISTRATION.relayId,
      });
    });

    it('passes correct arguments to activate', async () => {
      mockPrompt
        .mockResolvedValueOnce({ channel: 'signal' })
        .mockResolvedValueOnce({ idToken: 'valid-auth-token-1234567890' })
        .mockResolvedValueOnce({ label: 'test-device' });

      mockRegister.mockResolvedValue(MOCK_REGISTRATION);
      mockActivate.mockResolvedValue(MOCK_ACTIVATION);

      await setupCommand();

      expect(mockActivate).toHaveBeenCalledWith(
        MOCK_REGISTRATION.relayId,
        MOCK_REGISTRATION.activationCode,
        mockCliVersion,
        expect.objectContaining({
          os: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          bridgeVersion: mockCliVersion,
        }),
      );
    });
  });
});
