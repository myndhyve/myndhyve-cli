import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock dependencies BEFORE importing doctor ───────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(),
  isConfigured: vi.fn(),
  getCliDir: vi.fn(),
  getConfigPath: vi.fn(),
}));

vi.mock('../../config/types.js', () => ({
  RelayConfigSchema: { parse: vi.fn() },
}));

vi.mock('../../auth/credentials.js', () => ({
  loadCredentials: vi.fn(),
  isExpired: vi.fn(),
  getCredentialsPath: vi.fn(),
}));

vi.mock('../../auth/index.js', () => ({
  getAuthStatus: vi.fn(),
}));

vi.mock('../../context.js', () => ({
  getActiveContext: vi.fn(),
}));

vi.mock('../../config/defaults.js', () => ({
  CLI_VERSION: '0.1.0-test',
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { existsSync } from 'node:fs';
import { loadConfig, isConfigured, getCliDir, getConfigPath } from '../../config/loader.js';
import { loadCredentials, isExpired, getCredentialsPath } from '../../auth/credentials.js';
import { getAuthStatus } from '../../auth/index.js';
import { getActiveContext } from '../../context.js';
import type { AuthStatus } from '../../auth/index.js';

import {
  checkNodeVersion,
  checkCliDirectory,
  checkConfig,
  checkAuth,
  checkCredentials,
  checkRelayConfig,
  checkActiveContext,
  checkConnectivity,
  runDoctorChecks,
} from '../doctor.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as ReturnType<typeof vi.fn>;
const mockGetCliDir = getCliDir as ReturnType<typeof vi.fn>;
const mockGetConfigPath = getConfigPath as ReturnType<typeof vi.fn>;
const mockLoadCredentials = loadCredentials as ReturnType<typeof vi.fn>;
const mockIsExpired = isExpired as ReturnType<typeof vi.fn>;
const mockGetCredentialsPath = getCredentialsPath as ReturnType<typeof vi.fn>;
const mockGetAuthStatus = getAuthStatus as ReturnType<typeof vi.fn>;
const mockGetActiveContext = getActiveContext as ReturnType<typeof vi.fn>;

// ── Reset between tests ────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockExistsSync.mockReset();
  mockLoadConfig.mockReset();
  mockIsConfigured.mockReset();
  mockGetCliDir.mockReset();
  mockGetConfigPath.mockReset();
  mockLoadCredentials.mockReset();
  mockIsExpired.mockReset();
  mockGetCredentialsPath.mockReset();
  mockGetAuthStatus.mockReset();
  mockGetActiveContext.mockReset();

  // Defaults
  mockGetCliDir.mockReturnValue('/mock-home/.myndhyve-cli');
  mockGetConfigPath.mockReturnValue('/mock-home/.myndhyve-cli/config.json');
  mockGetCredentialsPath.mockReturnValue('/mock-home/.myndhyve-cli/credentials.json');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================================
// checkNodeVersion()
// ============================================================================

describe('checkNodeVersion()', () => {
  it('passes on current Node.js version (>= 18)', () => {
    const result = checkNodeVersion();

    expect(result.name).toBe('Node.js version');
    expect(result.ok).toBe(true);
    expect(result.message).toContain(process.version);
    expect(result.message).toContain('>= 18 required');
    expect(result.fix).toBeUndefined();
  });

  it('returns CheckResult with correct name', () => {
    const result = checkNodeVersion();

    expect(result.name).toBe('Node.js version');
  });

  it('includes the minimum version requirement in message', () => {
    const result = checkNodeVersion();

    // Current Node is always >= 18 in this project
    expect(result.message).toMatch(/18/);
  });
});

// ============================================================================
// checkCliDirectory()
// ============================================================================

describe('checkCliDirectory()', () => {
  it('passes when CLI directory exists', () => {
    mockExistsSync.mockReturnValue(true);

    const result = checkCliDirectory();

    expect(result.name).toBe('CLI directory');
    expect(result.ok).toBe(true);
    expect(result.message).toBe('/mock-home/.myndhyve-cli');
    expect(result.fix).toBeUndefined();
  });

  it('fails when CLI directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkCliDirectory();

    expect(result.name).toBe('CLI directory');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Not found');
    expect(result.fix).toBeDefined();
    expect(result.fix).toContain('auth login');
  });

  it('calls getCliDir() for the directory path', () => {
    mockExistsSync.mockReturnValue(true);

    checkCliDirectory();

    expect(mockGetCliDir).toHaveBeenCalledOnce();
  });

  it('uses existsSync to check directory', () => {
    mockExistsSync.mockReturnValue(true);

    checkCliDirectory();

    expect(mockExistsSync).toHaveBeenCalledWith('/mock-home/.myndhyve-cli');
  });

  it('suggests relay setup as alternative fix', () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkCliDirectory();

    expect(result.fix).toContain('relay setup');
  });
});

// ============================================================================
// checkConfig()
// ============================================================================

describe('checkConfig()', () => {
  it('passes when no config file exists (using defaults)', () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkConfig();

    expect(result.name).toBe('Configuration');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('No config file');
    expect(result.message).toContain('defaults');
    expect(result.fix).toBeUndefined();
  });

  it('passes when config file exists and is valid', () => {
    mockExistsSync.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({
      channel: 'whatsapp',
      relayId: 'relay-123',
      server: { baseUrl: 'https://example.com' },
    });

    const result = checkConfig();

    expect(result.name).toBe('Configuration');
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Valid');
    expect(result.fix).toBeUndefined();
  });

  it('fails when config file is corrupt (loadConfig throws)', () => {
    mockExistsSync.mockReturnValue(true);
    mockLoadConfig.mockImplementation(() => {
      throw new Error('Invalid JSON at position 5');
    });

    const result = checkConfig();

    expect(result.name).toBe('Configuration');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Invalid');
    expect(result.message).toContain('Invalid JSON at position 5');
    expect(result.fix).toBeDefined();
    expect(result.fix).toContain('config file');
  });

  it('handles non-Error throws gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockLoadConfig.mockImplementation(() => {
      throw 'string error';
    });

    const result = checkConfig();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('parse error');
  });

  it('calls getConfigPath() to determine config file location', () => {
    mockExistsSync.mockReturnValue(false);

    checkConfig();

    expect(mockGetConfigPath).toHaveBeenCalledOnce();
  });

  it('only calls loadConfig() when config file exists', () => {
    mockExistsSync.mockReturnValue(false);

    checkConfig();

    expect(mockLoadConfig).not.toHaveBeenCalled();
  });
});

// ============================================================================
// checkAuth()
// ============================================================================

describe('checkAuth()', () => {
  it('passes when using MYNDHYVE_TOKEN env variable', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      source: 'env',
    } satisfies AuthStatus);

    const result = checkAuth();

    expect(result.name).toBe('Authentication');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('MYNDHYVE_TOKEN');
    expect(result.message).toContain('environment variable');
    expect(result.fix).toBeUndefined();
  });

  it('passes when authenticated with stored credentials', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      source: 'credentials',
      email: 'david@myndhyve.com',
      uid: 'user-123',
      expired: false,
    } satisfies AuthStatus);

    const result = checkAuth();

    expect(result.name).toBe('Authentication');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('david@myndhyve.com');
    expect(result.fix).toBeUndefined();
  });

  it('fails when not authenticated', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: false,
      source: 'none',
    } satisfies AuthStatus);

    const result = checkAuth();

    expect(result.name).toBe('Authentication');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Not authenticated');
    expect(result.fix).toContain('auth login');
  });

  it('fails when token is expired', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      source: 'credentials',
      email: 'david@myndhyve.com',
      uid: 'user-123',
      expired: true,
    } satisfies AuthStatus);

    const result = checkAuth();

    expect(result.name).toBe('Authentication');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('expired');
    expect(result.message).toContain('david@myndhyve.com');
    expect(result.fix).toContain('auth login');
  });

  it('handles expired token with unknown user email', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      source: 'credentials',
      expired: true,
    } satisfies AuthStatus);

    const result = checkAuth();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('expired');
    expect(result.message).toContain('unknown');
  });

  it('displays "unknown" when signed in but email is missing', () => {
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      source: 'credentials',
      expired: false,
    } satisfies AuthStatus);

    const result = checkAuth();

    expect(result.ok).toBe(true);
    expect(result.message).toContain('unknown');
  });
});

// ============================================================================
// checkCredentials()
// ============================================================================

describe('checkCredentials()', () => {
  it('passes when credentials file does not exist (OK for env token)', () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkCredentials();

    expect(result.name).toBe('Credentials file');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Not present');
    expect(result.message).toContain('env token');
    expect(result.fix).toBeUndefined();
  });

  it('fails when credentials file exists but is corrupt', () => {
    mockExistsSync.mockReturnValue(true);
    mockLoadCredentials.mockReturnValue(null);

    const result = checkCredentials();

    expect(result.name).toBe('Credentials file');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('corrupt');
    expect(result.fix).toContain('auth logout');
    expect(result.fix).toContain('auth login');
  });

  it('fails when credentials are expired', () => {
    const expiredCreds = {
      idToken: 'tok',
      refreshToken: 'ref',
      email: 'a@b.com',
      uid: 'uid-1',
      expiresAt: '2024-01-01T00:00:00.000Z',
      savedAt: '2024-01-01T00:00:00.000Z',
    };
    mockExistsSync.mockReturnValue(true);
    mockLoadCredentials.mockReturnValue(expiredCreds);
    mockIsExpired.mockReturnValue(true);

    const result = checkCredentials();

    expect(result.name).toBe('Credentials file');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('expired');
    expect(result.message).toContain('2024-01-01');
    expect(result.fix).toContain('auth login');
  });

  it('passes when credentials exist and are valid', () => {
    const validCreds = {
      idToken: 'tok',
      refreshToken: 'ref',
      email: 'user@test.com',
      uid: 'uid-1',
      expiresAt: '2099-12-31T23:59:59.000Z',
      savedAt: '2024-06-01T00:00:00.000Z',
    };
    mockExistsSync.mockReturnValue(true);
    mockLoadCredentials.mockReturnValue(validCreds);
    mockIsExpired.mockReturnValue(false);

    const result = checkCredentials();

    expect(result.name).toBe('Credentials file');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Valid');
    expect(result.message).toContain('2099-12-31');
    expect(result.fix).toBeUndefined();
  });

  it('calls getCredentialsPath() to determine file location', () => {
    mockExistsSync.mockReturnValue(false);

    checkCredentials();

    expect(mockGetCredentialsPath).toHaveBeenCalledOnce();
  });

  it('only calls loadCredentials() when file exists', () => {
    mockExistsSync.mockReturnValue(false);

    checkCredentials();

    expect(mockLoadCredentials).not.toHaveBeenCalled();
  });
});

// ============================================================================
// checkRelayConfig()
// ============================================================================

describe('checkRelayConfig()', () => {
  it('passes with "not configured" when relay is not configured', () => {
    mockIsConfigured.mockReturnValue(false);

    const result = checkRelayConfig();

    expect(result.name).toBe('Relay configuration');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Not configured');
    expect(result.fix).toBeUndefined();
  });

  it('passes with channel and relayId when configured', () => {
    mockIsConfigured.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({
      channel: 'whatsapp',
      relayId: 'relay-abc-123',
      server: { baseUrl: 'https://example.com' },
    });

    const result = checkRelayConfig();

    expect(result.name).toBe('Relay configuration');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('whatsapp');
    expect(result.message).toContain('relay-abc-123');
    expect(result.fix).toBeUndefined();
  });

  it('shows signal channel when configured for signal', () => {
    mockIsConfigured.mockReturnValue(true);
    mockLoadConfig.mockReturnValue({
      channel: 'signal',
      relayId: 'relay-signal-001',
      server: { baseUrl: 'https://example.com' },
    });

    const result = checkRelayConfig();

    expect(result.message).toContain('signal');
    expect(result.message).toContain('relay-signal-001');
  });

  it('does not call loadConfig() when not configured', () => {
    mockIsConfigured.mockReturnValue(false);

    checkRelayConfig();

    expect(mockLoadConfig).not.toHaveBeenCalled();
  });
});

// ============================================================================
// checkActiveContext()
// ============================================================================

describe('checkActiveContext()', () => {
  it('passes with "None set" when no context is active', () => {
    mockGetActiveContext.mockReturnValue(null);

    const result = checkActiveContext();

    expect(result.name).toBe('Active project');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('None set');
    expect(result.message).toContain('myndhyve-cli use');
    expect(result.fix).toBeUndefined();
  });

  it('passes with project details when context is set', () => {
    mockGetActiveContext.mockReturnValue({
      projectId: 'proj-123',
      projectName: 'My Campaign',
      hyveId: 'landing-page',
      hyveName: 'Landing Page',
      setAt: '2024-06-15T10:00:00.000Z',
    });

    const result = checkActiveContext();

    expect(result.name).toBe('Active project');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('My Campaign');
    expect(result.message).toContain('proj-123');
    expect(result.message).toContain('Landing Page');
    expect(result.fix).toBeUndefined();
  });

  it('falls back to hyveId when hyveName is missing', () => {
    mockGetActiveContext.mockReturnValue({
      projectId: 'proj-456',
      projectName: 'No Hyve Name Project',
      hyveId: 'app-builder',
      setAt: '2024-06-15T10:00:00.000Z',
    });

    const result = checkActiveContext();

    expect(result.ok).toBe(true);
    expect(result.message).toContain('app-builder');
    expect(result.message).toContain('No Hyve Name Project');
  });

  it('includes both project name and ID in parentheses', () => {
    mockGetActiveContext.mockReturnValue({
      projectId: 'proj-789',
      projectName: 'Test Project',
      hyveId: 'slides',
      hyveName: 'Slides',
      setAt: '2024-01-01T00:00:00.000Z',
    });

    const result = checkActiveContext();

    // Format: "Test Project (proj-789) in Slides"
    expect(result.message).toMatch(/Test Project.*proj-789.*Slides/);
  });
});

// ============================================================================
// checkConnectivity()
// ============================================================================

describe('checkConnectivity()', () => {
  it('passes when fetch succeeds (server reachable)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await checkConnectivity();

    expect(result.name).toBe('Cloud connectivity');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Reachable');
    expect(result.message).toMatch(/\d+ms/);
    expect(result.fix).toBeUndefined();
  });

  it('passes even with 404 response (server still reachable)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 404 })
    );

    const result = await checkConnectivity();

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Reachable');
  });

  it('passes with 500 response (server reachable despite error)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 500 })
    );

    const result = await checkConnectivity();

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Reachable');
  });

  it('fails when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('getaddrinfo ENOTFOUND us-central1-myndhyve.cloudfunctions.net')
    );

    const result = await checkConnectivity();

    expect(result.name).toBe('Cloud connectivity');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Unreachable');
    expect(result.message).toContain('ENOTFOUND');
    expect(result.fix).toContain('internet connection');
  });

  it('fails when fetch times out', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('The operation was aborted')
    );

    const result = await checkConnectivity();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Unreachable');
    expect(result.message).toContain('aborted');
    expect(result.fix).toContain('firewall');
  });

  it('handles non-Error rejection gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('string error');

    const result = await checkConnectivity();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('unknown error');
  });

  it('sends HEAD request to cloud functions endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );
    globalThis.fetch = mockFetch;

    await checkConnectivity();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://us-central1-myndhyve.cloudfunctions.net',
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('uses AbortSignal with timeout', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );
    globalThis.fetch = mockFetch;

    await checkConnectivity();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeDefined();
  });
});

// ============================================================================
// runDoctorChecks()
// ============================================================================

describe('runDoctorChecks()', () => {
  /** Set up all mocks so every check passes. */
  function setupAllPassing(): void {
    // checkCliDirectory
    mockExistsSync.mockReturnValue(true);

    // checkConfig — config file exists, loadConfig succeeds
    mockGetConfigPath.mockReturnValue('/mock-home/.myndhyve-cli/config.json');
    mockLoadConfig.mockReturnValue({
      channel: 'whatsapp',
      relayId: 'relay-123',
      server: { baseUrl: 'https://example.com' },
    });

    // checkAuth
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      source: 'credentials',
      email: 'user@test.com',
      expired: false,
    });

    // checkCredentials — file exists, valid, not expired
    mockGetCredentialsPath.mockReturnValue('/mock-home/.myndhyve-cli/credentials.json');
    mockLoadCredentials.mockReturnValue({
      idToken: 'tok',
      refreshToken: 'ref',
      email: 'user@test.com',
      uid: 'uid-1',
      expiresAt: '2099-12-31T23:59:59.000Z',
      savedAt: '2024-01-01T00:00:00.000Z',
    });
    mockIsExpired.mockReturnValue(false);

    // checkRelayConfig
    mockIsConfigured.mockReturnValue(true);

    // checkActiveContext
    mockGetActiveContext.mockReturnValue({
      projectId: 'proj-1',
      projectName: 'Test',
      hyveId: 'app-builder',
      hyveName: 'App Builder',
      setAt: '2024-06-15T10:00:00.000Z',
    });

    // checkConnectivity
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );
  }

  it('returns DoctorReport with all 8 checks', async () => {
    setupAllPassing();

    const report = await runDoctorChecks();

    expect(report.checks).toHaveLength(8);
  });

  it('includes CLI_VERSION in report', async () => {
    setupAllPassing();

    const report = await runDoctorChecks();

    expect(report.version).toBe('0.1.0-test');
  });

  it('counts all passing checks correctly', async () => {
    setupAllPassing();

    const report = await runDoctorChecks();

    expect(report.passed).toBe(8);
    expect(report.failed).toBe(0);
    expect(report.passed + report.failed).toBe(report.checks.length);
  });

  it('counts failed checks correctly when some fail', async () => {
    setupAllPassing();
    // Make auth fail
    mockGetAuthStatus.mockReturnValue({
      authenticated: false,
      source: 'none',
    });
    // Make connectivity fail
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const report = await runDoctorChecks();

    expect(report.failed).toBe(2);
    expect(report.passed).toBe(6);
    expect(report.passed + report.failed).toBe(8);
  });

  it('runs checks in correct order', async () => {
    setupAllPassing();

    const report = await runDoctorChecks();

    const names = report.checks.map((c) => c.name);
    expect(names).toEqual([
      'Node.js version',
      'CLI directory',
      'Configuration',
      'Authentication',
      'Credentials file',
      'Relay configuration',
      'Active project',
      'Cloud connectivity',
    ]);
  });

  it('includes fix suggestions for failed checks only', async () => {
    setupAllPassing();
    // Make auth fail
    mockGetAuthStatus.mockReturnValue({
      authenticated: false,
      source: 'none',
    });

    const report = await runDoctorChecks();

    const authCheck = report.checks.find((c) => c.name === 'Authentication');
    expect(authCheck?.ok).toBe(false);
    expect(authCheck?.fix).toBeDefined();

    // Passing checks should not have fix
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js version');
    expect(nodeCheck?.ok).toBe(true);
    expect(nodeCheck?.fix).toBeUndefined();
  });

  it('handles all checks failing', async () => {
    // CLI directory missing
    mockExistsSync.mockReturnValue(false);

    // Config — file "exists" per the config path check but loadConfig throws
    mockGetConfigPath.mockReturnValue('/mock-home/.myndhyve-cli/config.json');
    // checkConfig: existsSync for config path needs to return true to trigger loadConfig
    // But we already set existsSync to return false globally.
    // existsSync is called for: CLI dir (false), config path (false), creds path (false)
    // So checkConfig gets "no file" = ok, checkCliDirectory = fail, checkCredentials = ok (no file)

    // checkAuth fails
    mockGetAuthStatus.mockReturnValue({
      authenticated: false,
      source: 'none',
    });

    // checkRelayConfig — not configured (ok)
    mockIsConfigured.mockReturnValue(false);

    // checkActiveContext — no context (ok)
    mockGetActiveContext.mockReturnValue(null);

    // checkConnectivity fails
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('no network'));

    const report = await runDoctorChecks();

    // Node passes (always), config ok (no file), creds ok (no file),
    // relay ok (not configured), active project ok (none set) = 5 ok
    // CLI dir fail, auth fail, connectivity fail = 3 fail
    expect(report.failed).toBe(3);
    expect(report.passed).toBe(5);
  });

  it('report passed + failed always equals total checks', async () => {
    setupAllPassing();

    const report = await runDoctorChecks();

    expect(report.passed + report.failed).toBe(report.checks.length);
  });
});
