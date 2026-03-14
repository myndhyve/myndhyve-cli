/**
 * MyndHyve CLI — Secrets Commands
 *
 * Commander subcommand group for secret management:
 *   myndhyve-cli secrets encrypt --secret-id <id> --value <plaintext>
 *   myndhyve-cli secrets encrypt --secret-id <id> --stdin
 *   myndhyve-cli secrets decrypt --secret-id <id> --envelope <json>
 *   myndhyve-cli secrets decrypt --secret-id <id> --file <path>
 */

import type { Command } from 'commander';
import {
  encryptSecret,
  decryptSecret,
  type EncryptedEnvelope,
} from '../api/secrets.js';
import { requireAuth, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerSecretsCommands(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Encrypt and decrypt secrets using KMS envelope encryption')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli secrets encrypt --secret-id my-api-key --value "sk-abc123"
  $ echo "sk-abc123" | myndhyve-cli secrets encrypt --secret-id my-api-key --stdin
  $ myndhyve-cli secrets decrypt --secret-id my-api-key --file envelope.json
  $ myndhyve-cli secrets decrypt --secret-id my-api-key --envelope '{"encryptedValue":...}'`);

  // ── Encrypt ─────────────────────────────────────────────────────────

  secrets
    .command('encrypt')
    .description('Encrypt a plaintext secret')
    .requiredOption('--secret-id <id>', 'Identifier for the secret (used for audit logging)')
    .option('--value <plaintext>', 'Plaintext value to encrypt (visible in shell history)')
    .option('--stdin', 'Read plaintext from stdin (recommended for production)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Determine plaintext source
      let plaintext: string;

      if (opts.stdin) {
        plaintext = await readStdin();
        if (!plaintext) {
          printErrorResult({
            code: 'EMPTY_INPUT',
            message: 'No input received from stdin.',
            suggestion: 'Pipe your secret: echo "value" | myndhyve-cli secrets encrypt --secret-id <id> --stdin',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      } else if (opts.value) {
        process.stderr.write(
          '  Warning: Using --value exposes the secret in shell history.\n' +
          '  Consider using --stdin instead: echo "value" | myndhyve-cli secrets encrypt --secret-id <id> --stdin\n\n'
        );
        plaintext = opts.value;
      } else {
        printErrorResult({
          code: 'MISSING_INPUT',
          message: 'Provide either --value or --stdin.',
          suggestion: 'Use --stdin for secure input: echo "value" | myndhyve-cli secrets encrypt --secret-id <id> --stdin',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Encrypting...', stream: process.stderr }).start();

      try {
        const envelope = await encryptSecret(opts.secretId, auth.uid, plaintext);
        spinner.stop();

        if (opts.format === 'json' || opts.format === 'table') {
          // Always output as JSON — the envelope must be machine-readable
          console.log(JSON.stringify(envelope, null, 2));
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to encrypt secret', error);
      }
    });

  // ── Decrypt ─────────────────────────────────────────────────────────

  secrets
    .command('decrypt')
    .description('Decrypt an encrypted envelope')
    .requiredOption('--secret-id <id>', 'Identifier for the secret (must match encryption context)')
    .option('--envelope <json>', 'Encrypted envelope as inline JSON')
    .option('--file <path>', 'Path to JSON file containing the encrypted envelope')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Parse envelope from either --envelope or --file
      let envelope: EncryptedEnvelope;

      if (opts.file) {
        try {
          const fs = await import('node:fs');
          const content = fs.readFileSync(opts.file, 'utf-8');
          envelope = JSON.parse(content) as EncryptedEnvelope;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          printErrorResult({
            code: 'INVALID_FILE',
            message: `Failed to read envelope file: ${message}`,
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      } else if (opts.envelope) {
        try {
          envelope = JSON.parse(opts.envelope) as EncryptedEnvelope;
        } catch {
          printErrorResult({
            code: 'INVALID_JSON',
            message: 'Failed to parse --envelope JSON.',
            suggestion: 'Ensure the value is valid JSON with keys: encryptedValue, encryptedDEK, kmsKeyVersion, iv, authTag.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      } else {
        printErrorResult({
          code: 'MISSING_INPUT',
          message: 'Provide either --envelope or --file.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // Validate envelope shape
      const required = ['encryptedValue', 'encryptedDEK', 'kmsKeyVersion', 'iv', 'authTag'];
      const missing = required.filter((key) => !(key in envelope));
      if (missing.length > 0) {
        printErrorResult({
          code: 'INVALID_ENVELOPE',
          message: `Envelope missing required fields: ${missing.join(', ')}`,
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Decrypting...', stream: process.stderr }).start();

      try {
        const plaintext = await decryptSecret(opts.secretId, auth.uid, envelope);
        spinner.stop();

        // Output plaintext to stdout (no formatting — designed for piping)
        process.stdout.write(plaintext);
        if (process.stdout.isTTY) {
          process.stdout.write('\n');
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to decrypt secret', error);
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

async function readStdin(): Promise<string> {
  // If stdin is a TTY (no pipe), there's nothing to read
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}
