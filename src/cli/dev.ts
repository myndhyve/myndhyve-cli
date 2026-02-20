/**
 * MyndHyve CLI — Developer Tools Commands
 *
 * Commander subcommand group for debugging, testing, and configuration:
 *   myndhyve-cli dev doctor
 *   myndhyve-cli dev ping
 *   myndhyve-cli dev envelope create --channel=whatsapp --text="Hello"
 *   myndhyve-cli dev envelope validate <file>
 *   myndhyve-cli dev webhook test <channel>
 *   myndhyve-cli dev config export
 *   myndhyve-cli dev config import <file>
 *   myndhyve-cli dev config validate
 */

import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig, getConfigPath, getCliDir } from '../config/loader.js';
import { RelayConfigSchema } from '../config/types.js';
import { loadCredentials, getCredentialsPath } from '../auth/credentials.js';
import { getActiveContext } from '../context.js';
import { runDoctorChecks, } from '../dev/doctor.js';
import { createTestEnvelope, validateEnvelope } from '../dev/envelope.js';
import {
  generateWebhookEvent,
  getAvailableEventTypes,
  type WebhookEventType,
} from '../dev/webhook.js';
import { printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import type { RelayChannel } from '../relay/types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_CHANNELS: RelayChannel[] = ['whatsapp', 'signal', 'imessage'];

// ============================================================================
// REGISTER
// ============================================================================

/**
 * Register the `dev` subcommand group on the root program.
 *
 * Adds developer tools for diagnostics, testing envelopes/webhooks,
 * and managing CLI configuration.
 */
export function registerDevCommands(program: Command): void {
  const dev = program
    .command('dev')
    .description('Developer tools for debugging, testing, and configuration');

  registerDoctorCommand(dev);
  registerPingCommand(dev);
  registerEnvelopeCommands(dev);
  registerWebhookCommands(dev);
  registerConfigCommands(dev);
}

// ============================================================================
// DOCTOR
// ============================================================================

function registerDoctorCommand(dev: Command): void {
  dev
    .command('doctor')
    .description('Check system health and configuration')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      try {
        const report = await runDoctorChecks();

        if (opts.format === 'json') {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        console.log(`\n  MyndHyve CLI Doctor (v${report.version})`);
        console.log('  ' + '\u2500'.repeat(50));

        for (const check of report.checks) {
          const icon = check.ok ? '\u2713' : '\u2717';
          console.log(`  ${icon} ${check.name}: ${check.message}`);

          if (!check.ok && check.fix) {
            console.log(`    \u21b3 Fix: ${check.fix}`);
          }
        }

        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ${report.passed} passed, ${report.failed} failed\n`);

        if (report.failed > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        printError('Doctor check failed', error);
      }
    });
}

// ============================================================================
// PING
// ============================================================================

function registerPingCommand(dev: Command): void {
  dev
    .command('ping')
    .description('Test connectivity to MyndHyve Cloud')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const url = 'https://us-central1-myndhyve.cloudfunctions.net';

      try {
        const start = Date.now();
        const response = await fetch(url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10_000),
        });
        const elapsed = Date.now() - start;

        const result = {
          reachable: true,
          url,
          statusCode: response.status,
          latencyMs: elapsed,
        };

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Ping: ${url}`);
        console.log(`  Status: ${response.status}`);
        console.log(`  Latency: ${elapsed}ms`);
        console.log('  Result: Reachable\n');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (opts.format === 'json') {
          console.log(JSON.stringify({
            reachable: false,
            url,
            error: message,
          }, null, 2));
          process.exitCode = 1;
          return;
        }

        console.error(`\n  Ping: ${url}`);
        console.error(`  Result: Unreachable`);
        console.error(`  Error: ${message}\n`);
        process.exitCode = 1;
      }
    });
}

// ============================================================================
// ENVELOPE COMMANDS
// ============================================================================

function registerEnvelopeCommands(dev: Command): void {
  const envelope = dev
    .command('envelope')
    .description('Create and validate messaging envelopes');

  // ── Create ─────────────────────────────────────────────────────────

  envelope
    .command('create')
    .description('Generate a test ChatIngressEnvelope')
    .requiredOption('--channel <channel>', 'Messaging channel (whatsapp, signal, imessage)')
    .option('--text <text>', 'Message text', 'Hello from CLI test')
    .option('--peer <peerId>', 'Sender peer ID')
    .option('--conversation <id>', 'Conversation ID')
    .option('--group', 'Generate a group message')
    .option('--group-name <name>', 'Group name (implies --group)')
    .option('--format <format>', 'Output format (json, compact)', 'json')
    .action((opts) => {
      if (!validateChannel(opts.channel)) return;

      const isGroup = opts.group || !!opts.groupName;

      const env = createTestEnvelope({
        channel: opts.channel,
        text: opts.text,
        peerId: opts.peer,
        conversationId: opts.conversation,
        isGroup,
        groupName: opts.groupName,
      });

      if (opts.format === 'compact') {
        console.log(JSON.stringify(env));
      } else {
        console.log(JSON.stringify(env, null, 2));
      }
    });

  // ── Validate ───────────────────────────────────────────────────────

  envelope
    .command('validate <file>')
    .description('Validate a JSON file as a messaging envelope')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((file: string, opts) => {
      if (!existsSync(file)) {
        printErrorResult({
          code: 'NOT_FOUND',
          message: `File not found: ${file}`,
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      let data: unknown;
      try {
        const raw = readFileSync(file, 'utf-8');
        data = JSON.parse(raw);
      } catch (error) {
        printErrorResult({
          code: 'INVALID_JSON',
          message: `Invalid JSON in ${file}: ${error instanceof Error ? error.message : 'parse error'}`,
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const result = validateEnvelope(data);

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        if (!result.valid) process.exitCode = 1;
        return;
      }

      if (result.valid) {
        console.log(`\n  \u2713 Valid ${result.envelopeType} envelope\n`);
      } else {
        console.error(`\n  \u2717 Invalid envelope (detected type: ${result.envelopeType})\n`);
        console.error('  Errors:');
        for (const err of result.errors) {
          console.error(`    \u2022 ${err}`);
        }
        console.error('');
        process.exitCode = 1;
      }
    });
}

// ============================================================================
// WEBHOOK COMMANDS
// ============================================================================

function registerWebhookCommands(dev: Command): void {
  const webhook = dev
    .command('webhook')
    .description('Generate and inspect mock webhook events');

  webhook
    .command('test <channel>')
    .description('Generate a mock webhook event for a platform')
    .option('--event <type>', 'Event type (message, typing, etc.)', 'message')
    .option('--text <text>', 'Message text', 'Hello from webhook test')
    .option('--sender <id>', 'Sender identifier')
    .option('--group', 'Generate a group event')
    .option('--group-name <name>', 'Group name (implies --group)')
    .option('--payload <file>', 'Use a custom payload from file (overrides generated)')
    .option('--format <format>', 'Output format (json, compact)', 'json')
    .action((channel: string, opts) => {
      if (!validateChannel(channel)) return;

      const validTypes = getAvailableEventTypes(channel as RelayChannel);
      if (!validTypes.includes(opts.event as WebhookEventType)) {
        printErrorResult({
          code: 'INVALID_EVENT_TYPE',
          message: `Event type "${opts.event}" not available for ${channel}.`,
          suggestion: `Available: ${validTypes.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // If custom payload provided, use that instead
      if (opts.payload) {
        const payloadFile = opts.payload.startsWith('@')
          ? opts.payload.slice(1)
          : opts.payload;

        if (!existsSync(payloadFile)) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Payload file not found: ${payloadFile}`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        try {
          const raw = readFileSync(payloadFile, 'utf-8');
          const payload = JSON.parse(raw);
          console.log(JSON.stringify({ channel, payload, source: payloadFile }, null, 2));
          return;
        } catch (error) {
          printErrorResult({
            code: 'INVALID_JSON',
            message: `Invalid JSON in payload file: ${error instanceof Error ? error.message : 'parse error'}`,
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      }

      const isGroup = opts.group || !!opts.groupName;

      const event = generateWebhookEvent({
        channel: channel as RelayChannel,
        eventType: opts.event as WebhookEventType,
        senderId: opts.sender,
        text: opts.text,
        isGroup,
        groupName: opts.groupName,
      });

      if (opts.format === 'compact') {
        console.log(JSON.stringify(event));
      } else {
        console.log(JSON.stringify(event, null, 2));
      }
    });

  // ── List event types ─────────────────────────────────────────────

  webhook
    .command('events <channel>')
    .description('List available webhook event types for a platform')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((channel: string, opts) => {
      if (!validateChannel(channel)) return;

      const types = getAvailableEventTypes(channel as RelayChannel);

      if (opts.format === 'json') {
        console.log(JSON.stringify({ channel, eventTypes: types }, null, 2));
        return;
      }

      console.log(`\n  Webhook event types for ${channel}:\n`);
      for (const t of types) {
        console.log(`    \u2022 ${t}`);
      }
      console.log('');
    });
}

// ============================================================================
// CONFIG COMMANDS
// ============================================================================

function registerConfigCommands(dev: Command): void {
  const config = dev
    .command('config')
    .description('Export, import, and validate CLI configuration');

  // ── Export ──────────────────────────────────────────────────────────

  config
    .command('export')
    .description('Export CLI configuration to stdout (pipe to file)')
    .option('--include-credentials', 'Include credentials in export (sensitive!)')
    .action((opts) => {
      const exported: Record<string, unknown> = {
        _meta: {
          exportedAt: new Date().toISOString(),
          cliDir: getCliDir(),
        },
        config: loadConfig(),
      };

      // Active context
      const ctx = getActiveContext();
      if (ctx) {
        exported.context = ctx;
      }

      // Credentials (opt-in only)
      if (opts.includeCredentials) {
        console.error('  Warning: Output contains sensitive credentials. Do not share.\n');
        const creds = loadCredentials();
        if (creds) {
          exported.credentials = creds;
        }
      }

      console.log(JSON.stringify(exported, null, 2));
    });

  // ── Import ─────────────────────────────────────────────────────────

  config
    .command('import <file>')
    .description('Import CLI configuration from a file')
    .action((file: string) => {
      if (!existsSync(file)) {
        printErrorResult({
          code: 'NOT_FOUND',
          message: `File not found: ${file}`,
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      let data: Record<string, unknown>;
      try {
        const raw = readFileSync(file, 'utf-8');
        data = JSON.parse(raw);
      } catch (error) {
        printErrorResult({
          code: 'INVALID_JSON',
          message: `Invalid JSON in ${file}: ${error instanceof Error ? error.message : 'parse error'}`,
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      // Validate config section
      if (!data.config) {
        printErrorResult({
          code: 'INVALID_FORMAT',
          message: 'Export file missing "config" section.',
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      try {
        const validConfig = RelayConfigSchema.parse(data.config);
        saveConfig(validConfig);
        console.log('\n  Configuration imported successfully.');

        // Restore context if present
        if (data.context) {
          const contextPath = join(getCliDir(), 'context.json');
          writeFileSync(contextPath, JSON.stringify(data.context, null, 2), { mode: 0o600 });
          console.log('  Active context restored.');
        }

        console.log('');
      } catch (error) {
        printErrorResult({
          code: 'INVALID_CONFIG',
          message: `Invalid configuration in export file: ${error instanceof Error ? error.message : 'validation error'}`,
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Validate ───────────────────────────────────────────────────────

  config
    .command('validate')
    .description('Verify CLI configuration integrity')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((opts) => {
      const checks: ConfigCheck[] = [];

      // Config file
      const configPath = getConfigPath();
      if (existsSync(configPath)) {
        try {
          const raw = readFileSync(configPath, 'utf-8');
          const json = JSON.parse(raw);
          RelayConfigSchema.parse(json);
          checks.push({ file: 'config.json', status: 'valid', message: 'Schema valid' });
        } catch (error) {
          checks.push({
            file: 'config.json',
            status: 'invalid',
            message: error instanceof Error ? error.message : 'parse error',
          });
        }
      } else {
        checks.push({ file: 'config.json', status: 'missing', message: 'Not present (using defaults)' });
      }

      // Credentials file
      const credPath = getCredentialsPath();
      if (existsSync(credPath)) {
        const creds = loadCredentials();
        if (creds) {
          checks.push({ file: 'credentials.json', status: 'valid', message: 'Schema valid' });
        } else {
          checks.push({ file: 'credentials.json', status: 'invalid', message: 'Corrupt or invalid' });
        }
      } else {
        checks.push({ file: 'credentials.json', status: 'missing', message: 'Not present' });
      }

      // Context file
      const ctx = getActiveContext();
      if (ctx) {
        checks.push({ file: 'context.json', status: 'valid', message: `Project: ${ctx.projectName}` });
      } else {
        checks.push({ file: 'context.json', status: 'missing', message: 'No active project' });
      }

      const hasErrors = checks.some((c) => c.status === 'invalid');

      if (opts.format === 'json') {
        console.log(JSON.stringify({ checks, valid: !hasErrors }, null, 2));
        if (hasErrors) process.exitCode = 1;
        return;
      }

      console.log('\n  Configuration Validation\n');
      console.log(
        '  ' +
          'File'.padEnd(24) +
          'Status'.padEnd(12) +
          'Details'
      );
      console.log('  ' + '\u2500'.repeat(60));

      for (const check of checks) {
        const icon = check.status === 'valid' ? '\u2713' : check.status === 'invalid' ? '\u2717' : '\u2014';
        console.log(
          '  ' +
            check.file.padEnd(24) +
            icon + ' ' +
            check.status.padEnd(10) +
            check.message
        );
      }

      console.log('');

      if (hasErrors) {
        console.error('  Some config files are invalid. Fix them and re-validate.\n');
        process.exitCode = 1;
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

interface ConfigCheck {
  file: string;
  status: 'valid' | 'invalid' | 'missing';
  message: string;
}

/**
 * Validate a --channel flag value. Prints error and sets exitCode if invalid.
 */
function validateChannel(channel: string): channel is RelayChannel {
  if (!VALID_CHANNELS.includes(channel as RelayChannel)) {
    printErrorResult({
      code: 'INVALID_CHANNEL',
      message: `Unknown channel "${channel}".`,
      suggestion: `Valid channels: ${VALID_CHANNELS.join(', ')}`,
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return false;
  }
  return true;
}
