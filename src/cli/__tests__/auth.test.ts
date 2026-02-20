import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// -- Hoisted mock variables -------------------------------------------------

const {
  mockLogin,
  mockLoginWithToken,
  mockLogout,
  mockGetAuthStatus,
  mockGetToken,
  mockIsAuthenticated,
  mockFormatTimeSince,
  mockFormatTimeUntil,
  mockPrintErrorResult,
} = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockLoginWithToken: vi.fn(),
  mockLogout: vi.fn(),
  mockGetAuthStatus: vi.fn(),
  mockGetToken: vi.fn(),
  mockIsAuthenticated: vi.fn(),
  mockFormatTimeSince: vi.fn(),
  mockFormatTimeUntil: vi.fn(),
  mockPrintErrorResult: vi.fn(),
}));

// -- Mocks ------------------------------------------------------------------

vi.mock('../../auth/index.js', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  loginWithToken: (...args: unknown[]) => mockLoginWithToken(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
  getAuthStatus: (...args: unknown[]) => mockGetAuthStatus(...args),
  getToken: (...args: unknown[]) => mockGetToken(...args),
  isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
  AuthError: class AuthError extends Error {
    constructor(message: string, _code?: string) {
      super(message);
      this.name = 'AuthError';
    }
  },
}));

// chalk -- passthrough for all style methods
vi.mock('chalk', () => {
  const passthrough = (s: string) => s;
  const handler: ProxyHandler<typeof passthrough> = {
    get: () => new Proxy(passthrough, handler),
    apply: (_target, _thisArg, args: [string]) => args[0],
  };
  return { default: new Proxy(passthrough, handler) };
});

// ora -- spinner mock (shared reference for assertions)
const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
};
vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('../../utils/format.js', () => ({
  formatTimeSince: (...args: unknown[]) => mockFormatTimeSince(...args),
  formatTimeUntil: (...args: unknown[]) => mockFormatTimeUntil(...args),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: (...args: unknown[]) => mockPrintErrorResult(...args),
}));

import { registerAuthCommands } from '../auth.js';

// -- Helpers ----------------------------------------------------------------

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerAuthCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// -- Test setup -------------------------------------------------------------

describe('registerAuthCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(() => {
    mockLogin.mockReset();
    mockLoginWithToken.mockReset();
    mockLogout.mockReset();
    mockGetAuthStatus.mockReset();
    mockGetToken.mockReset();
    mockIsAuthenticated.mockReset();
    mockFormatTimeSince.mockReset();
    mockFormatTimeUntil.mockReset();
    mockPrintErrorResult.mockReset();

    // Reset spinner
    mockSpinner.start.mockClear();
    mockSpinner.succeed.mockClear();
    mockSpinner.fail.mockClear();
    mockSpinner.stop.mockClear();

    // Default passthroughs
    mockFormatTimeSince.mockImplementation(() => '5 minutes');
    mockFormatTimeUntil.mockImplementation(() => '55 minutes');

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the auth command group on the program', () => {
      const program = new Command();
      registerAuthCommands(program);
      const auth = program.commands.find((c) => c.name() === 'auth');
      expect(auth).toBeDefined();
    });

    it('registers login, logout, status, and token subcommands', () => {
      const program = new Command();
      registerAuthCommands(program);
      const auth = program.commands.find((c) => c.name() === 'auth')!;
      const subNames = auth.commands.map((c) => c.name());

      expect(subNames).toContain('login');
      expect(subNames).toContain('logout');
      expect(subNames).toContain('status');
      expect(subNames).toContain('token');
    });

    it('login subcommand has --token option', () => {
      const program = new Command();
      registerAuthCommands(program);
      const auth = program.commands.find((c) => c.name() === 'auth')!;
      const login = auth.commands.find((c) => c.name() === 'login')!;
      const tokenOption = login.options.find((o) => o.long === '--token');
      expect(tokenOption).toBeDefined();
    });
  });

  // ==========================================================================
  // AUTH LOGIN (browser)
  // ==========================================================================

  describe('auth login (browser)', () => {
    it('calls login() and shows success message', async () => {
      mockLogin.mockResolvedValue({ email: 'user@example.com' });

      await run(['auth', 'login']);

      expect(mockLogin).toHaveBeenCalledOnce();
      // Email is displayed via spinner.succeed()
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        expect.stringContaining('user@example.com')
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Credentials saved');
    });

    it('shows next steps after successful login', async () => {
      mockLogin.mockResolvedValue({ email: 'test@test.com' });

      await run(['auth', 'login']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Next steps');
      expect(output).toContain('relay setup');
      expect(output).toContain('chat');
      expect(output).toContain('auth status');
    });

    it('shows timeout error when login times out', async () => {
      mockLogin.mockRejectedValue(new Error('Authentication timed out'));

      await run(['auth', 'login']);

      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_TIMEOUT',
          message: 'Authentication timed out.',
          suggestion: expect.stringContaining('try again'),
        })
      );
      expect(process.exitCode).toBe(1);
    });

    it('shows generic error when login fails with non-timeout message', async () => {
      mockLogin.mockRejectedValue(new Error('Network error'));

      await run(['auth', 'login']);

      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_FAILED',
          message: 'Network error',
        })
      );
      expect(process.exitCode).toBe(1);
    });

    it('handles non-Error thrown values', async () => {
      mockLogin.mockRejectedValue('unexpected string error');

      await run(['auth', 'login']);

      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTH_FAILED',
          message: 'unexpected string error',
        })
      );
      expect(process.exitCode).toBe(1);
    });
  });

  // ==========================================================================
  // AUTH LOGIN --token
  // ==========================================================================

  describe('auth login --token', () => {
    it('calls loginWithToken(token) and shows success', async () => {
      mockLoginWithToken.mockResolvedValue({ email: 'ci@example.com' });

      await run(['auth', 'login', '--token', 'eyJabc123']);

      expect(mockLoginWithToken).toHaveBeenCalledWith('eyJabc123');
      expect(mockLogin).not.toHaveBeenCalled();
      // Email is displayed via spinner.succeed()
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        expect.stringContaining('ci@example.com')
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Token stored');
    });

    it('shows note about auto-refresh not available', async () => {
      mockLoginWithToken.mockResolvedValue({ email: 'ci@test.com' });

      await run(['auth', 'login', '--token', 'tok_abc']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('cannot be auto-refreshed');
    });

    it('sets exitCode=1 on token login failure', async () => {
      mockLoginWithToken.mockRejectedValue(new Error('Invalid token format'));

      await run(['auth', 'login', '--token', 'bad_token']);

      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOKEN_LOGIN_FAILED',
          message: 'Invalid token format',
        })
      );
      expect(process.exitCode).toBe(1);
    });

    it('handles non-Error thrown values for token login', async () => {
      mockLoginWithToken.mockRejectedValue('token string error');

      await run(['auth', 'login', '--token', 'bad']);

      expect(mockPrintErrorResult).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOKEN_LOGIN_FAILED',
          message: 'token string error',
        })
      );
      expect(process.exitCode).toBe(1);
    });
  });

  // ==========================================================================
  // AUTH LOGOUT
  // ==========================================================================

  describe('auth logout', () => {
    it('calls logout() and shows success message', async () => {
      await run(['auth', 'logout']);

      expect(mockLogout).toHaveBeenCalledOnce();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Logged out');
      expect(output).toContain('Credentials cleared');
    });
  });

  // ==========================================================================
  // AUTH STATUS
  // ==========================================================================

  describe('auth status', () => {
    it('shows "Not authenticated" when not authenticated', async () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: false,
        source: 'none',
      });

      await run(['auth', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Not authenticated');
      expect(output).toContain('auth login');
    });

    it('shows env source when authenticated via env token', async () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: true,
        source: 'env',
      });

      await run(['auth', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MYNDHYVE_TOKEN');
      expect(output).toContain('authenticated');
      expect(output).toContain('Token details unavailable');
    });

    it('shows credentials info when authenticated and not expired', async () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: true,
        source: 'credentials',
        email: 'user@example.com',
        uid: 'uid_abc123',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        expired: false,
      });

      await run(['auth', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('authenticated');
      expect(output).toContain('user@example.com');
      expect(output).toContain('uid_abc123');
      expect(output).toContain('valid');
      expect(mockFormatTimeUntil).toHaveBeenCalled();
    });

    it('shows expired status when token is expired', async () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: true,
        source: 'credentials',
        email: 'expired@example.com',
        uid: 'uid_expired',
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
        expired: true,
      });

      await run(['auth', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('expired');
      expect(output).toContain('expired@example.com');
      expect(output).toContain('auth login');
      expect(mockFormatTimeSince).toHaveBeenCalled();
    });

    it('shows "unknown" when email or uid is missing', async () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: true,
        source: 'credentials',
        email: undefined,
        uid: undefined,
        expiresAt: undefined,
        expired: false,
      });

      await run(['auth', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('unknown');
    });

    it('shows the MyndHyve Auth Status header', async () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: false,
        source: 'none',
      });

      await run(['auth', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Auth Status');
    });
  });

  // ==========================================================================
  // AUTH TOKEN
  // ==========================================================================

  describe('auth token', () => {
    it('writes token to stdout', async () => {
      mockGetToken.mockResolvedValue('eyJtoken123');

      await run(['auth', 'token']);

      expect(stdoutWriteSpy).toHaveBeenCalledWith('eyJtoken123');
      expect(process.exitCode).toBeUndefined();
    });

    it('sets exitCode=1 when getToken throws AuthError', async () => {
      const { AuthError } = await import('../../auth/index.js');
      mockGetToken.mockRejectedValue(new AuthError('Not logged in', 'NOT_AUTHENTICATED'));

      await run(['auth', 'token']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Not logged in');
      expect(process.exitCode).toBe(1);
    });

    it('sets exitCode=1 when getToken throws a generic Error', async () => {
      mockGetToken.mockRejectedValue(new Error('Token refresh failed'));

      await run(['auth', 'token']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Token refresh failed');
      expect(process.exitCode).toBe(1);
    });

    it('handles non-Error thrown values', async () => {
      mockGetToken.mockRejectedValue('string error');

      await run(['auth', 'token']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('string error');
      expect(process.exitCode).toBe(1);
    });
  });
});
