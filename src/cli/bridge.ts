/**
 * MyndHyve CLI — Bridge Commands
 *
 * Commander subcommand group for IDE Bridge:
 *   myndhyve-cli bridge link [path]     # Link local dir to MyndHyve project
 *   myndhyve-cli bridge unlink          # Remove the link
 *   myndhyve-cli bridge start           # Start the bridge daemon
 *   myndhyve-cli bridge stop            # Stop the daemon
 *   myndhyve-cli bridge status          # Show bridge status
 *   myndhyve-cli bridge sync            # Force a manual sync
 *   myndhyve-cli bridge logs            # View daemon logs
 */

import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  requireAuth,
  printError,
  formatRelativeTime,
} from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import { getToken } from '../auth/index.js';
import { createLogger } from '../utils/logger.js';
import type { BridgeLocalConfig, ExportFramework } from '../bridge/types.js';

const log = createLogger('Bridge');

// ============================================================================
// REGISTER
// ============================================================================

export function registerBridgeCommands(program: Command): void {
  const bridge = program
    .command('bridge')
    .description('Bidirectional sync between MyndHyve and your local IDE project')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli bridge link ./my-project --project <id>
  $ myndhyve-cli bridge start --daemon
  $ myndhyve-cli bridge status
  $ myndhyve-cli bridge sync --push`);

  // ── Link ──────────────────────────────────────────────────────────────

  bridge
    .command('link [path]')
    .description('Link a local directory to a MyndHyve project')
    .requiredOption('--project <projectId>', 'MyndHyve project or hyveDocument ID')
    .option('--hyve <hyveId>', 'System hyve ID (e.g. app-builder)', 'app-builder')
    .option('--framework <framework>', 'Target framework (auto-detected from package.json)')
    .option('--force', 'Overwrite existing link')
    .action(async (path: string | undefined, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectRoot = resolve(path || '.');
      if (!existsSync(projectRoot)) {
        printError('link', `Directory not found: ${projectRoot}`);
        return;
      }

      // Check for existing link
      const { isLinked } = await import('../bridge/session.js');
      if (isLinked(projectRoot) && !opts.force) {
        printError(
          'link',
          'This directory is already linked. Use --force to overwrite, or `bridge unlink` first.'
        );
        return;
      }

      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;
      const spinner = ora({ text: 'Linking project...', stream: process.stderr }).start();

      try {
        await getToken();

        // Auto-detect framework
        const framework: ExportFramework = opts.framework
          ? (opts.framework as ExportFramework)
          : await detectFramework(projectRoot);

        spinner.text = 'Creating bridge session...';

        const { createSession } = await import('../bridge/session.js');
        const session = await createSession({
          projectRoot,
          projectId: opts.project,
          hyveId: opts.hyve,
          framework,
        });

        spinner.succeed(`Linked to project ${chalk.cyan(opts.project)}`);

        console.log('');
        console.log(`  ${chalk.bold('Session ID:')}  ${session.id}`);
        console.log(`  ${chalk.bold('Framework:')}   ${framework}`);
        console.log(`  ${chalk.bold('Local path:')} ${projectRoot}`);
        console.log('');
        console.log(`  Next: Run ${chalk.cyan('myndhyve-cli bridge start')} to begin syncing.`);
        console.log('');
      } catch (error) {
        spinner.fail('Failed to link project');
        printError('link', error);
      }
    });

  // ── Unlink ────────────────────────────────────────────────────────────

  bridge
    .command('unlink [path]')
    .description('Remove the bridge link from a local directory')
    .option('--delete-session', 'Also delete the Firestore session')
    .action(async (path: string | undefined, opts) => {
      const projectRoot = resolve(path || '.');

      const { readLocalConfig, removeLocalConfig, deleteSession } = await import('../bridge/session.js');
      const config = await readLocalConfig(projectRoot);

      if (!config) {
        printError('unlink', 'No bridge link found in this directory.');
        return;
      }

      if (opts.deleteSession) {
        try {
          await getToken();
          await deleteSession(config.sessionId);
          console.log('  Firestore session deleted.');
        } catch (error) {
          console.error(`  Warning: Failed to delete session: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      await removeLocalConfig(projectRoot);
      console.log('  Bridge link removed.');
    });

  // ── Start ─────────────────────────────────────────────────────────────

  bridge
    .command('start [path]')
    .description('Start the bridge daemon (sync files with MyndHyve)')
    .option('-d, --daemon', 'Run as a background daemon')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (path: string | undefined, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectRoot = resolve(path || '.');

      const { readLocalConfig } = await import('../bridge/session.js');
      const config = await readLocalConfig(projectRoot);

      if (!config) {
        printError('start', 'Not linked. Run `myndhyve-cli bridge link --project <id>` first.');
        return;
      }

      // Daemon mode: spawn background process and exit
      if (opts.daemon && !process.env.MYNDHYVE_CLI_BRIDGE_DAEMON) {
        const { getBridgeDaemonPid, spawnBridgeDaemon } = await import('../bridge/daemon.js');

        const existingPid = getBridgeDaemonPid();
        if (existingPid) {
          console.log(`  Bridge daemon already running (PID ${existingPid})`);
          return;
        }

        const pid = spawnBridgeDaemon(projectRoot, opts.verbose);
        const chalk = (await import('chalk')).default;
        console.log(`  Bridge daemon started ${chalk.dim(`(PID ${pid})`)}`);
        console.log(`  Logs: myndhyve-cli bridge logs`);
        return;
      }

      // Foreground mode: run the bridge loop
      await getToken();
      const { runBridgeLoop } = await import('../bridge/loop.js');
      await runBridgeLoop(projectRoot, config);
    });

  // ── Stop ──────────────────────────────────────────────────────────────

  bridge
    .command('stop')
    .description('Stop the bridge daemon')
    .action(async () => {
      const { stopBridgeDaemon } = await import('../bridge/daemon.js');
      const stopped = stopBridgeDaemon();
      if (stopped) {
        console.log('  Bridge daemon stopped.');
      } else {
        console.log('  Bridge daemon is not running.');
      }
    });

  // ── Status ────────────────────────────────────────────────────────────

  bridge
    .command('status [path]')
    .description('Show bridge connection and sync status')
    .action(async (path: string | undefined) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectRoot = resolve(path || '.');
      const chalk = (await import('chalk')).default;

      const { readLocalConfig, getSession } = await import('../bridge/session.js');
      const config = await readLocalConfig(projectRoot);

      if (!config) {
        console.log(`\n  Not linked to a MyndHyve project.`);
        console.log(`  Run ${chalk.cyan('myndhyve-cli bridge link --project <id>')} to get started.\n`);
        return;
      }

      await getToken();
      const session = await getSession(config.sessionId);

      if (!session) {
        console.log('\n  Bridge session not found in cloud. Re-link with `bridge link`.\n');
        return;
      }

      const { getBridgeDaemonPid } = await import('../bridge/daemon.js');
      const { HEARTBEAT_STALE_MS } = await import('../bridge/types.js');
      const { getOutputMode } = await import('../utils/output.js');

      const lastHb = new Date(session.lastHeartbeat).getTime();
      const isOnline = session.status === 'online' && Date.now() - lastHb < HEARTBEAT_STALE_MS;
      const daemonPid = getBridgeDaemonPid();

      // --json mode: structured output for VS Code extension and programmatic use
      if (getOutputMode() === 'json') {
        console.log(JSON.stringify({
          status: isOnline ? 'online' : 'offline',
          daemonPid: daemonPid ?? null,
          sessionId: session.id,
          projectId: session.projectId,
          hyveId: session.hyveId,
          framework: session.framework,
          syncDirection: session.syncDirection,
          localPath: session.localPath,
          lastHeartbeat: session.lastHeartbeat,
        }));
        return;
      }

      console.log('');
      console.log(`  ${chalk.bold('IDE Bridge Status')}`);
      console.log('');
      console.log(`  ${chalk.bold('Status:')}      ${isOnline ? chalk.green('● online') : chalk.red('● offline')}`);
      console.log(`  ${chalk.bold('Daemon:')}      ${daemonPid ? chalk.green(`running (PID ${daemonPid})`) : chalk.dim('not running')}`);
      console.log(`  ${chalk.bold('Session:')}     ${session.id}`);
      console.log(`  ${chalk.bold('Project:')}     ${session.projectId}`);
      console.log(`  ${chalk.bold('Hyve:')}        ${session.hyveId}`);
      console.log(`  ${chalk.bold('Framework:')}   ${session.framework}`);
      console.log(`  ${chalk.bold('Direction:')}   ${session.syncDirection}`);
      console.log(`  ${chalk.bold('Path:')}        ${session.localPath}`);
      console.log(`  ${chalk.bold('Last seen:')}   ${formatRelativeTime(session.lastHeartbeat)}`);
      console.log('');
    });

  // ── Sync ──────────────────────────────────────────────────────────────

  bridge
    .command('sync [path]')
    .description('Force a manual sync')
    .option('--push', 'Push local changes only')
    .option('--pull', 'Pull remote changes only')
    .action(async (path: string | undefined, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectRoot = resolve(path || '.');

      const { readLocalConfig } = await import('../bridge/session.js');
      const config = await readLocalConfig(projectRoot);

      if (!config) {
        printError('sync', 'Not linked. Run `myndhyve-cli bridge link` first.');
        return;
      }

      await getToken();
      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Syncing...', stream: process.stderr }).start();

      try {
        const { manualSync } = await import('../bridge/sync.js');

        const direction: 'push' | 'pull' | 'bidirectional' = opts.push
          ? 'push'
          : opts.pull
            ? 'pull'
            : 'bidirectional';

        spinner.text = direction === 'push'
          ? 'Pushing local changes...'
          : direction === 'pull'
            ? 'Pulling remote changes...'
            : 'Syncing bidirectionally...';

        const result = await manualSync(projectRoot, config, direction);

        spinner.succeed(
          `Sync complete (${result.filesChanged} file(s) changed${result.conflicts > 0 ? `, ${result.conflicts} conflict(s)` : ''})`
        );
      } catch (error) {
        spinner.fail('Sync failed');
        printError('sync', error);
      }
    });

  // ── Logs ──────────────────────────────────────────────────────────────

  bridge
    .command('logs')
    .description('View bridge daemon logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .action(async (opts) => {
      const { getBridgeLogPath } = await import('../bridge/daemon.js');
      const logPath = getBridgeLogPath();

      if (!existsSync(logPath)) {
        console.log('  No bridge logs found. Start with: myndhyve-cli bridge start --daemon');
        return;
      }

      const { spawn } = await import('node:child_process');
      const args = opts.follow
        ? ['-f', '-n', opts.lines, logPath]
        : ['-n', opts.lines, logPath];
      const tail = spawn('tail', args, { stdio: 'inherit' });
      tail.on('error', () => printError('logs', 'Failed to read logs'));
    });

  // ── MCP Server ─────────────────────────────────────────────────────────

  bridge
    .command('mcp [path]')
    .description('Start an MCP server for AI coding assistants (stdio transport)')
    .action(async (path: string | undefined) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectRoot = resolve(path || '.');

      const { readLocalConfig } = await import('../bridge/session.js');
      const config = await readLocalConfig(projectRoot);

      if (!config) {
        printError('mcp', 'Not linked. Run `myndhyve-cli bridge link --project <id>` first.');
        return;
      }

      await getToken();

      const { startMCPServer } = await import('../bridge/mcp-server.js');
      await startMCPServer(projectRoot, config);
    });
}

// ============================================================================
// HELPERS
// ============================================================================

async function detectFramework(projectRoot: string): Promise<ExportFramework> {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return 'react-tailwind';

  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.next) return 'nextjs';
    if (deps.nuxt) return 'nuxt';
    if (deps.vue) return 'vue-tailwind';
    if (deps['react-native']) return 'react-native';
    if (deps['styled-components'] || deps['@emotion/react']) return 'react-styled';
    if (deps.react) return 'react-tailwind';

    return 'react-tailwind';
  } catch {
    return 'react-tailwind';
  }
}
