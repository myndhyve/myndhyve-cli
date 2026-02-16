/**
 * MyndHyve CLI — Developer Diagnostics (Doctor)
 *
 * Runs a series of health checks to verify the CLI environment is
 * configured correctly: Node version, auth, config, connectivity, etc.
 */

import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { loadConfig, isConfigured, getCliDir, getConfigPath } from '../config/loader.js';
import { RelayConfigSchema as _RelayConfigSchema } from '../config/types.js';
import { loadCredentials, isExpired, getCredentialsPath } from '../auth/credentials.js';
import { getAuthStatus } from '../auth/index.js';
import { getActiveContext } from '../context.js';
import { CLI_VERSION } from '../config/defaults.js';

const log = createLogger('Doctor');

// ============================================================================
// TYPES
// ============================================================================

/** Result of a single diagnostic check. */
export interface CheckResult {
  /** Check name. */
  name: string;
  /** Whether the check passed. */
  ok: boolean;
  /** Short status message. */
  message: string;
  /** Actionable fix if the check failed. */
  fix?: string;
}

/** Aggregate result of all checks. */
export interface DoctorReport {
  /** CLI version. */
  version: string;
  /** All check results in order. */
  checks: CheckResult[];
  /** Number of checks that passed. */
  passed: number;
  /** Number of checks that failed. */
  failed: number;
}

// ============================================================================
// CHECKS
// ============================================================================

/** Minimum supported Node.js version. */
const MIN_NODE_MAJOR = 18;

/** Check Node.js version meets minimum. */
export function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= MIN_NODE_MAJOR) {
    return {
      name: 'Node.js version',
      ok: true,
      message: `${version} (>= ${MIN_NODE_MAJOR} required)`,
    };
  }

  return {
    name: 'Node.js version',
    ok: false,
    message: `${version} (>= v${MIN_NODE_MAJOR}.0.0 required)`,
    fix: `Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org`,
  };
}

/** Check that the CLI config directory exists. */
export function checkCliDirectory(): CheckResult {
  const dir = getCliDir();
  const exists = existsSync(dir);

  return {
    name: 'CLI directory',
    ok: exists,
    message: exists ? dir : 'Not found',
    fix: exists ? undefined : 'Run `myndhyve-cli auth login` or `myndhyve-cli relay setup` to create it.',
  };
}

/** Check config file validity. */
export function checkConfig(): CheckResult {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {
      name: 'Configuration',
      ok: true,
      message: 'No config file (using defaults)',
    };
  }

  try {
    loadConfig();
    return {
      name: 'Configuration',
      ok: true,
      message: 'Valid',
    };
  } catch (error) {
    return {
      name: 'Configuration',
      ok: false,
      message: `Invalid: ${error instanceof Error ? error.message : 'parse error'}`,
      fix: 'Fix or delete the config file, then re-run setup.',
    };
  }
}

/** Check authentication status. */
export function checkAuth(): CheckResult {
  const status = getAuthStatus();

  if (status.source === 'env') {
    return {
      name: 'Authentication',
      ok: true,
      message: 'Using MYNDHYVE_TOKEN environment variable',
    };
  }

  if (!status.authenticated) {
    return {
      name: 'Authentication',
      ok: false,
      message: 'Not authenticated',
      fix: 'Run `myndhyve-cli auth login` to sign in.',
    };
  }

  if (status.expired) {
    return {
      name: 'Authentication',
      ok: false,
      message: `Token expired (${status.email || 'unknown user'})`,
      fix: 'Run `myndhyve-cli auth login` to refresh your token.',
    };
  }

  return {
    name: 'Authentication',
    ok: true,
    message: `Signed in as ${status.email || 'unknown'}`,
  };
}

/** Check stored credentials file integrity. */
export function checkCredentials(): CheckResult {
  const credPath = getCredentialsPath();

  if (!existsSync(credPath)) {
    return {
      name: 'Credentials file',
      ok: true,
      message: 'Not present (OK if using env token or not yet logged in)',
    };
  }

  const creds = loadCredentials();
  if (!creds) {
    return {
      name: 'Credentials file',
      ok: false,
      message: 'File exists but is corrupt or invalid',
      fix: 'Run `myndhyve-cli auth logout` then `auth login` to reset credentials.',
    };
  }

  if (isExpired(creds)) {
    return {
      name: 'Credentials file',
      ok: false,
      message: `Token expired at ${creds.expiresAt}`,
      fix: 'Run `myndhyve-cli auth login` to refresh.',
    };
  }

  return {
    name: 'Credentials file',
    ok: true,
    message: `Valid, expires ${creds.expiresAt}`,
  };
}

/** Check relay agent configuration. */
export function checkRelayConfig(): CheckResult {
  if (!isConfigured()) {
    return {
      name: 'Relay configuration',
      ok: true,
      message: 'Not configured (OK if not using relay)',
    };
  }

  const config = loadConfig();
  return {
    name: 'Relay configuration',
    ok: true,
    message: `Channel: ${config.channel}, Relay ID: ${config.relayId}`,
  };
}

/** Check active project context. */
export function checkActiveContext(): CheckResult {
  const ctx = getActiveContext();

  if (!ctx) {
    return {
      name: 'Active project',
      ok: true,
      message: 'None set (use `myndhyve-cli use <project-id>` to set one)',
    };
  }

  return {
    name: 'Active project',
    ok: true,
    message: `${ctx.projectName} (${ctx.projectId}) in ${ctx.hyveName || ctx.hyveId}`,
  };
}

/** Check cloud connectivity by pinging the Cloud Functions endpoint. */
export async function checkConnectivity(): Promise<CheckResult> {
  const url = 'https://us-central1-myndhyve.cloudfunctions.net';

  try {
    const start = Date.now();
    const _response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - start;

    // Any response (even 404) means the server is reachable
    return {
      name: 'Cloud connectivity',
      ok: true,
      message: `Reachable (${elapsed}ms)`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    log.debug('Connectivity check failed', { error: message });

    return {
      name: 'Cloud connectivity',
      ok: false,
      message: `Unreachable: ${message}`,
      fix: 'Check your internet connection and firewall settings.',
    };
  }
}

// ============================================================================
// RUN ALL CHECKS
// ============================================================================

/**
 * Run all diagnostic checks and produce a report.
 *
 * Synchronous checks run first, then async checks (connectivity).
 */
export async function runDoctorChecks(): Promise<DoctorReport> {
  const checks: CheckResult[] = [];

  // Synchronous checks
  checks.push(checkNodeVersion());
  checks.push(checkCliDirectory());
  checks.push(checkConfig());
  checks.push(checkAuth());
  checks.push(checkCredentials());
  checks.push(checkRelayConfig());
  checks.push(checkActiveContext());

  // Async checks
  checks.push(await checkConnectivity());

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;

  return {
    version: CLI_VERSION,
    checks,
    passed,
    failed,
  };
}
