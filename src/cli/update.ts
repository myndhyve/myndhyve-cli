/**
 * MyndHyve CLI — Self-Update Command
 *
 * Checks npm registry for the latest version and provides update instructions.
 *   myndhyve-cli update
 */

import type { Command } from 'commander';
import { CLI_VERSION, VERSION_STRING } from '../config/defaults.js';
import { getCliDir, ensureCliDir } from '../config/loader.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_NAME = '@myndhyve/cli';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface _UpdateCheckResult {
  latest: string;
  current: string;
  updateAvailable: boolean;
}

// ============================================================================
// VERSION CHECK
// ============================================================================

/**
 * Fetch the latest version from the npm registry.
 */
async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }

  const data = (await response.json()) as { version: string };
  return data.version;
}

/**
 * Parse a semver string into [major, minor, patch], stripping pre-release
 * suffixes (e.g. "1.2.3-beta.1" → [1, 2, 3]).
 */
function parseSemver(version: string): [number, number, number] {
  const [major, minor, patchRaw] = version.split('.');
  // Strip pre-release suffix from patch (e.g. "3-beta.1" → 3)
  const patch = parseInt(patchRaw, 10);
  return [parseInt(major, 10), parseInt(minor, 10), Number.isNaN(patch) ? 0 : patch];
}

/**
 * Compare semver strings. Returns true if latest > current.
 * Pre-release suffixes are stripped — only major.minor.patch is compared.
 */
function isNewer(latest: string, current: string): boolean {
  const [aMajor, aMinor, aPatch] = parseSemver(latest);
  const [bMajor, bMinor, bPatch] = parseSemver(current);

  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch > bPatch;
}

// ============================================================================
// BACKGROUND CHECK (called on every CLI run)
// ============================================================================

function getUpdateCheckPath(): string {
  return join(getCliDir(), '.update-check');
}

interface UpdateCheckCache {
  checkedAt: string;
  latestVersion: string;
}

/**
 * Run a background update check if enough time has passed since the last one.
 * Call this from the main entry point — it never throws or blocks.
 */
export function maybeNotifyUpdate(): void {
  try {
    // Suppress update notification in --json or --quiet modes
    const isQuiet = process.argv.includes('--quiet') ||
      process.argv.includes('-q') ||
      process.argv.includes('--json');
    if (isQuiet) return;

    const checkPath = getUpdateCheckPath();

    if (existsSync(checkPath)) {
      const raw = readFileSync(checkPath, 'utf-8');
      const cache: UpdateCheckCache = JSON.parse(raw);
      const elapsed = Date.now() - new Date(cache.checkedAt).getTime();

      // Notify if there's a cached newer version
      if (cache.latestVersion && isNewer(cache.latestVersion, CLI_VERSION)) {
        process.stderr.write(
          `\n  Update available: ${CLI_VERSION} \u2192 ${cache.latestVersion}\n` +
          `  Run \`myndhyve-cli update\` for details.\n\n`
        );
      }

      // Don't check again if we checked recently
      if (elapsed < UPDATE_CHECK_INTERVAL_MS) return;
    }

    // Fire-and-forget background check
    fetchLatestVersion()
      .then((latestVersion) => {
        try {
          ensureCliDir();
          writeFileSync(
            checkPath,
            JSON.stringify({
              checkedAt: new Date().toISOString(),
              latestVersion,
            }),
            { mode: 0o600 }
          );
        } catch {
          // Ignore write failures
        }
      })
      .catch(() => {
        // Ignore network failures — this is best-effort
      });
  } catch {
    // Never let update checks interfere with the CLI
  }
}

// ============================================================================
// UPDATE COMMAND
// ============================================================================

async function updateCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;

  console.log();
  console.log(chalk.bold.cyan('  MyndHyve CLI — Update Check'));
  console.log(chalk.gray(`  Current: ${VERSION_STRING}`));
  console.log();

  const spinner = ora('Checking for updates...').start();

  try {
    const latest = await fetchLatestVersion();
    const hasUpdate = isNewer(latest, CLI_VERSION);

    if (hasUpdate) {
      spinner.succeed(`New version available: ${chalk.bold(latest)} (current: ${CLI_VERSION})`);
      console.log();
      console.log(chalk.gray('  Update with:'));
      console.log(chalk.bold(`    npm install -g ${PACKAGE_NAME}`));
      console.log();
      console.log(chalk.gray('  Or if installed via npx, just run:'));
      console.log(chalk.bold(`    npx ${PACKAGE_NAME}@latest`));
    } else {
      spinner.succeed(`You're on the latest version (${CLI_VERSION})`);
    }

    // Update the cache
    try {
      ensureCliDir();
      writeFileSync(
        getUpdateCheckPath(),
        JSON.stringify({
          checkedAt: new Date().toISOString(),
          latestVersion: latest,
        }),
        { mode: 0o600 }
      );
    } catch {
      // Ignore
    }
  } catch (error) {
    spinner.fail('Failed to check for updates');
    console.error(
      chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`)
    );
    console.log();
    console.log(chalk.gray('  Check manually:'));
    console.log(chalk.bold(`    npm view ${PACKAGE_NAME} version`));
    process.exitCode = 1;
  }

  console.log();
}

// ============================================================================
// REGISTER
// ============================================================================

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Check for and install CLI updates')
    .action(updateCommand);
}
