/**
 * MyndHyve CLI — Program Definition
 *
 * Commander-based CLI with subcommand groups.
 * Relay commands are grouped under `myndhyve-cli relay *`.
 */

import { Command } from 'commander';
import { VERSION_STRING } from '../config/defaults.js';
import { setupCommand } from './setup.js';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { loginCommand } from './login.js';
import { logoutCommand } from './logout.js';
import { logsCommand } from './logs.js';
import { uninstallCommand } from './uninstall.js';
import { registerAuthCommands } from './auth.js';
import { registerChatCommand } from './chat.js';
import { registerProjectCommands } from './projects.js';
import { registerHyveCommands, registerContextCommands } from './hyves.js';
import { registerMessagingCommands } from './messaging.js';
import { registerWorkflowCommands } from './workflows.js';
import { registerDevCommands } from './dev.js';
import { registerBridgeCommands } from './bridge.js';
import { registerA2ACommands } from './a2a.js';
import { registerMCPClientCommands } from './mcp-client.js';
import { registerCompletionCommand } from './completion.js';
import { registerUpdateCommand } from './update.js';
import { applyGlobalOptions } from './global-options.js';
import { didYouMean } from './helpers.js';
import { ExitCode } from '../utils/output.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('myndhyve-cli')
    .description('MyndHyve CLI — Connect messaging platforms, manage agents, and automate workflows')
    .version(VERSION_STRING, '-V, --version', 'Show version information');

  // ── Global Options ────────────────────────────────────────────────────

  applyGlobalOptions(program);

  // ── Top-Level Commands ──────────────────────────────────────────────────

  program
    .command('status')
    .description('Show overall MyndHyve CLI status')
    .action(statusCommand);

  // ── Auth Subcommand Group ───────────────────────────────────────────────

  registerAuthCommands(program);

  // ── Chat Command ──────────────────────────────────────────────────────

  registerChatCommand(program);

  // ── Project Management ────────────────────────────────────────────────

  registerProjectCommands(program);

  // ── Hyve Management ───────────────────────────────────────────────────

  registerHyveCommands(program);

  // ── Context Commands (use, unuse, whoami) ─────────────────────────────

  registerContextCommands(program);

  // ── Messaging Operations ────────────────────────────────────────────────

  registerMessagingCommands(program);

  // ── Workflow Automation ─────────────────────────────────────────────────

  registerWorkflowCommands(program);

  // ── Developer Tools ──────────────────────────────────────────────────────

  registerDevCommands(program);

  // ── Shell Completions ─────────────────────────────────────────────────

  registerCompletionCommand(program);

  // ── Self-Update ───────────────────────────────────────────────────────

  registerUpdateCommand(program);

  // ── IDE Bridge ────────────────────────────────────────────────────────

  registerBridgeCommands(program);

  // ── A2A Client ──────────────────────────────────────────────────────

  registerA2ACommands(program);

  // ── MCP Client ──────────────────────────────────────────────────────

  registerMCPClientCommands(program);

  // ── Relay Subcommand Group ──────────────────────────────────────────────

  const relay = program
    .command('relay')
    .description('Bridge WhatsApp, Signal, and iMessage to MyndHyve AI agents');

  relay
    .command('setup')
    .description('Register and activate a new relay device')
    .action(setupCommand);

  relay
    .command('start')
    .description('Start the relay agent (connect to platform and begin relaying)')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-d, --daemon', 'Run as a background daemon')
    .action(startCommand);

  relay
    .command('stop')
    .description('Stop the relay daemon')
    .action(stopCommand);

  relay
    .command('status')
    .description('Show relay device status and connection details')
    .action(statusCommand);

  relay
    .command('login')
    .description('Re-authenticate with the messaging platform')
    .action(loginCommand);

  relay
    .command('logout')
    .description('Clear stored credentials and deactivate the relay')
    .action(logoutCommand);

  relay
    .command('logs')
    .description('View relay daemon logs')
    .option('-f, --follow', 'Follow log output (like tail -f)')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .action(logsCommand);

  relay
    .command('uninstall')
    .description('Remove all relay data, credentials, and daemon')
    .action(uninstallCommand);

  // ── Unknown Command Handler (did you mean?) ─────────────────────────────

  program.on('command:*', (operands: string[]) => {
    const unknown = operands[0];
    const commands = program.commands.map((c) => c.name());
    const suggestion = didYouMean(unknown, commands);

    process.stderr.write(`\n  Error: Unknown command "${unknown}".`);
    if (suggestion) {
      process.stderr.write(` Did you mean "${suggestion}"?`);
    }
    process.stderr.write(`\n  Run \`myndhyve-cli --help\` for available commands.\n\n`);
    process.exitCode = ExitCode.USAGE_ERROR;
  });

  // ── SIGINT Handler ──────────────────────────────────────────────────────

  process.on('SIGINT', () => {
    process.stderr.write('\n');
    process.exit(ExitCode.SIGINT);
  });

  return program;
}
