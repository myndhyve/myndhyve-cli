/**
 * MyndHyve CLI — Auth Commands
 *
 * Commander subcommand group for authentication:
 *   myndhyve-cli auth login              — Browser OAuth login
 *   myndhyve-cli auth login --token=X    — Direct token login (CI/CD)
 *   myndhyve-cli auth logout             — Clear stored credentials
 *   myndhyve-cli auth status             — Show auth status
 *   myndhyve-cli auth token              — Print current token to stdout
 */

import type { Command } from 'commander';
import { formatTimeSince, formatTimeUntil } from '../utils/format.js';

// ============================================================================
// AUTH LOGIN
// ============================================================================

async function authLoginCommand(options: { token?: string }): Promise<void> {
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;

  if (options.token) {
    // Direct token login (CI/CD mode)
    const { loginWithToken } = await import('../auth/index.js');

    const spinner = ora('Validating token...').start();
    try {
      const { email } = await loginWithToken(options.token);
      spinner.succeed(chalk.green(`Logged in as ${chalk.bold(email)}`));
      console.log(chalk.gray('\n  Token stored for this session.'));
      console.log(chalk.gray('  Note: Token-based login cannot be auto-refreshed.\n'));
    } catch (error) {
      spinner.fail(chalk.red('Login failed'));
      console.error(
        chalk.red(`  ${error instanceof Error ? error.message : String(error)}\n`)
      );
      process.exitCode = 1;
    }
    return;
  }

  // Interactive browser login
  const { login } = await import('../auth/index.js');

  console.log();
  console.log(chalk.bold.cyan('  MyndHyve — Sign In'));
  console.log(chalk.gray('  Opening browser for authentication...'));
  console.log();

  const spinner = ora('Waiting for browser authentication...').start();

  try {
    const { email } = await login();
    spinner.succeed(chalk.green(`Logged in as ${chalk.bold(email)}`));
    console.log(
      chalk.gray(`\n  Credentials saved. Run ${chalk.bold('myndhyve-cli auth status')} to verify.\n`)
    );
  } catch (error) {
    spinner.fail(chalk.red('Authentication failed'));
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out')) {
      console.error(chalk.yellow('\n  Authentication timed out.'));
      console.error(chalk.gray('  Please try again with `myndhyve-cli auth login`.\n'));
    } else {
      console.error(chalk.red(`\n  ${message}\n`));
    }
    process.exitCode = 1;
  }
}

// ============================================================================
// AUTH LOGOUT
// ============================================================================

async function authLogoutCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const { logout } = await import('../auth/index.js');

  logout();
  console.log(chalk.green('\n  Logged out. Credentials cleared.\n'));
}

// ============================================================================
// AUTH STATUS
// ============================================================================

async function authStatusCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const { getAuthStatus } = await import('../auth/index.js');

  const status = getAuthStatus();

  console.log();
  console.log(chalk.bold.cyan('  MyndHyve — Auth Status'));
  console.log();

  if (!status.authenticated) {
    console.log(chalk.yellow('  Not authenticated.'));
    console.log(
      chalk.gray(`  Run ${chalk.bold('myndhyve-cli auth login')} to sign in.`)
    );
    console.log();
    return;
  }

  // Source
  if (status.source === 'env') {
    console.log(chalk.gray('  Source:       ') + chalk.cyan('MYNDHYVE_TOKEN environment variable'));
    console.log(chalk.gray('  Status:       ') + chalk.green('authenticated'));
    console.log();
    console.log(
      chalk.gray('  Note: Token details unavailable when using env variable.')
    );
    console.log();
    return;
  }

  // Credentials-based auth
  console.log(
    chalk.gray('  Status:       ') +
      (status.expired
        ? chalk.red('expired')
        : chalk.green('authenticated'))
  );
  console.log(chalk.gray('  Email:        ') + chalk.bold(status.email || 'unknown'));
  console.log(chalk.gray('  User ID:      ') + (status.uid || 'unknown'));

  if (status.expiresAt) {
    const expiresDate = new Date(status.expiresAt);

    if (status.expired) {
      const expiredAgo = formatTimeSince(expiresDate);
      console.log(
        chalk.gray('  Token:        ') + chalk.red(`expired ${expiredAgo} ago`)
      );
      console.log();
      console.log(
        chalk.yellow(
          `  Run ${chalk.bold('myndhyve-cli auth login')} to refresh your session.`
        )
      );
    } else {
      const expiresIn = formatTimeUntil(expiresDate);
      console.log(
        chalk.gray('  Token:        ') + chalk.green(`valid (expires in ${expiresIn})`)
      );
    }
  }

  console.log();
}

// ============================================================================
// AUTH TOKEN
// ============================================================================

async function authTokenCommand(): Promise<void> {
  const chalk = (await import('chalk')).default;
  const { getToken, AuthError } = await import('../auth/index.js');

  try {
    const token = await getToken();
    // Write token to stdout — designed for piping (e.g., `auth token | pbcopy`).
    // Add trailing newline when connected to a TTY for readability;
    // omit it when piped so downstream consumers get the raw token.
    process.stdout.write(token);
    if (process.stdout.isTTY) {
      process.stdout.write('\n');
    }
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
    process.exitCode = 1;
  }
}

// ============================================================================
// REGISTER SUBCOMMAND GROUP
// ============================================================================

/**
 * Register the `auth` subcommand group on the Commander program.
 */
export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Authenticate with MyndHyve (login, logout, token management)');

  auth
    .command('login')
    .description('Sign in to MyndHyve (opens browser)')
    .option('-t, --token <token>', 'Use a Firebase ID token directly (for CI/CD)')
    .action(authLoginCommand);

  auth
    .command('logout')
    .description('Sign out and clear stored credentials')
    .action(authLogoutCommand);

  auth
    .command('status')
    .description('Show current authentication status')
    .action(authStatusCommand);

  auth
    .command('token')
    .description('Print current auth token to stdout (for piping)')
    .action(authTokenCommand);
}
