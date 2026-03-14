/**
 * MyndHyve CLI — Notification Commands
 *
 * Commander subcommand group for sending notifications:
 *   myndhyve-cli notify email --to <addr> --subject <subj> --body <text>
 *   myndhyve-cli notify email --to <addr> --template <type> --data <json>
 *   myndhyve-cli notify sms --to <phone> --body <text>
 *   myndhyve-cli notify sms --to <phone> --template <type> --data <json>
 */

import type { Command } from 'commander';
import { sendEmail, sendSMS } from '../api/notifications.js';
import { requireAuth, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerNotifyCommands(program: Command): void {
  const notify = program
    .command('notify')
    .description('Send email and SMS notifications')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli notify email --to user@example.com --subject "Hello" --body "World"
  $ myndhyve-cli notify email --to user@example.com --template welcome --data '{"userName":"Alice"}'
  $ myndhyve-cli notify sms --to +15551234567 --body "Your code is 123456"
  $ myndhyve-cli notify sms --to +15551234567 --template verification_code --data '{"code":"123456"}'`);

  // ── Email ───────────────────────────────────────────────────────────

  notify
    .command('email')
    .description('Send an email notification')
    .requiredOption('--to <email>', 'Recipient email address')
    .option('--subject <subject>', 'Email subject line')
    .option('--body <text>', 'Email body (plain text)')
    .option('--html <html>', 'Email body (HTML)')
    .option('--template <type>', 'Email template type (e.g., welcome, notification_digest)')
    .option('--data <json>', 'Template data as JSON')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Validate input: either subject+body or template
      if (!opts.template && !opts.subject) {
        printErrorResult({
          code: 'MISSING_INPUT',
          message: 'Provide either --subject (with --body) or --template.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      let templateData: Record<string, unknown> | undefined;
      if (opts.data) {
        try {
          templateData = JSON.parse(opts.data);
        } catch {
          printErrorResult({
            code: 'INVALID_JSON',
            message: 'Failed to parse --data JSON.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: `Sending email to ${opts.to}...`, stream: process.stderr }).start();

      try {
        const result = await sendEmail({
          to: opts.to,
          subject: opts.subject,
          text: opts.body,
          html: opts.html,
          templateType: opts.template,
          templateData,
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log(`\n  Email sent to ${opts.to}`);
          if (result.messageId) {
            console.log(`  Message ID: ${result.messageId}`);
          }
          console.log('');
        } else {
          printErrorResult({
            code: 'SEND_FAILED',
            message: result.error || 'Failed to send email.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to send email', error);
      }
    });

  // ── SMS ─────────────────────────────────────────────────────────────

  notify
    .command('sms')
    .description('Send an SMS notification')
    .requiredOption('--to <phone>', 'Recipient phone number (E.164 format, e.g., +15551234567)')
    .option('--body <text>', 'SMS body text (max 480 characters)')
    .option('--template <type>', 'SMS template type (e.g., verification_code, workflow_alert)')
    .option('--data <json>', 'Template data as JSON')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Validate input: either body or template
      if (!opts.template && !opts.body) {
        printErrorResult({
          code: 'MISSING_INPUT',
          message: 'Provide either --body or --template.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      let templateData: Record<string, unknown> | undefined;
      if (opts.data) {
        try {
          templateData = JSON.parse(opts.data);
        } catch {
          printErrorResult({
            code: 'INVALID_JSON',
            message: 'Failed to parse --data JSON.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: `Sending SMS to ${opts.to}...`, stream: process.stderr }).start();

      try {
        const result = await sendSMS({
          to: opts.to,
          body: opts.body,
          templateType: opts.template,
          templateData,
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log(`\n  SMS sent to ${opts.to}`);
          if (result.messageId) {
            console.log(`  Message ID: ${result.messageId}`);
          }
          if (result.status) {
            console.log(`  Status: ${result.status}`);
          }
          console.log('');
        } else {
          printErrorResult({
            code: 'SEND_FAILED',
            message: result.error || 'Failed to send SMS.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to send SMS', error);
      }
    });
}
