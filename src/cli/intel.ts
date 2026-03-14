/**
 * MyndHyve CLI — Market Intelligence Commands
 *
 * Commander subcommand group for market intelligence:
 *   myndhyve-cli intel runs
 *   myndhyve-cli intel run <run-id>
 *   myndhyve-cli intel run create --file <config.json>
 *   myndhyve-cli intel run cancel <run-id>
 *   myndhyve-cli intel voc <run-id>
 *   myndhyve-cli intel angles <run-id>
 *   myndhyve-cli intel targeting <run-id>
 *   myndhyve-cli intel templates
 *   myndhyve-cli intel template <id>
 *   myndhyve-cli intel template create --file <path>
 */

import type { Command } from 'commander';
import {
  createIntelRun,
  listIntelRuns,
  getIntelRun,
  getVoCRecords,
  getAdAngles,
  getTargetingPack,
  cancelIntelRun,
  listTemplates,
  getTemplate,
  createTemplate,
  type CreateRunRequest,
  type CreateTemplateRequest,
} from '../api/marketIntel.js';
import {
  requireAuth,
  formatRelativeTime,
  formatTableRow,
  printError,
} from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerIntelCommands(program: Command): void {
  const intel = program
    .command('intel')
    .description('Market intelligence research — VoC extraction, ad angles, targeting')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli intel runs
  $ myndhyve-cli intel run create --file research-config.json
  $ myndhyve-cli intel run <run-id>
  $ myndhyve-cli intel voc <run-id>
  $ myndhyve-cli intel angles <run-id>
  $ myndhyve-cli intel templates`);

  // ── Runs List ───────────────────────────────────────────────────────

  intel
    .command('runs')
    .description('List all market intelligence runs')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading runs...', stream: process.stderr }).start();

      try {
        const runs = await listIntelRuns();
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(runs, null, 2));
          return;
        }

        if (runs.length === 0) {
          console.log('\n  No intel runs found.');
          console.log('  Start one with: myndhyve-cli intel run create --file config.json\n');
          return;
        }

        console.log(`\n  Intel Runs (${runs.length})\n`);

        const cols: Array<[string, number]> = [
          ['Run ID', 24],
          ['Status', 12],
          ['Progress', 10],
          ['VoC', 8],
          ['Angles', 8],
          ['Created', 14],
        ];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(76, (process.stdout.columns || 76) - 4)));

        for (const run of runs) {
          const voc = run.resultsSummary?.vocRecordsExtracted?.toString() || '\u2014';
          const angles = run.resultsSummary?.anglesGenerated?.toString() || '\u2014';

          console.log(formatTableRow([
            [run.runId, 24],
            [run.status, 12],
            [`${run.progress}%`, 10],
            [voc, 8],
            [angles, 8],
            [formatRelativeTime(run.createdAt), 14],
          ]));
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to list runs', error);
      }
    });

  // ── Run subcommand group ────────────────────────────────────────────

  const run = intel
    .command('run')
    .description('Manage individual intel runs');

  // ── Run Create ──────────────────────────────────────────────────────

  run
    .command('create')
    .description('Start a new market intelligence run')
    .requiredOption('--file <path>', 'Path to JSON config file with {icp, product, options?, sourceUrls?}')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      let request: CreateRunRequest;
      try {
        const fs = await import('node:fs');
        const content = fs.readFileSync(opts.file, 'utf-8');
        request = JSON.parse(content) as CreateRunRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printErrorResult({
          code: 'INVALID_FILE',
          message: `Failed to read config file: ${message}`,
          suggestion: 'Ensure the file contains valid JSON with at least {icp, product} fields.',
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Starting intel run...', stream: process.stderr }).start();

      try {
        const result = await createIntelRun(request);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Intel run started!`);
        console.log(`  Run ID:    ${result.runId}`);
        console.log(`  Status:    ${result.status}`);
        console.log(`  Progress:  ${result.progress}%`);
        console.log(`\n  Track progress: myndhyve-cli intel run ${result.runId}\n`);
      } catch (error) {
        spinner.stop();
        printError('Failed to create intel run', error);
      }
    });

  // ── Run Detail ──────────────────────────────────────────────────────

  run
    .command('info <run-id>')
    .description('Show details of a specific intel run')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (runId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading run...', stream: process.stderr }).start();

      try {
        const detail = await getIntelRun(runId);
        spinner.stop();

        if (!detail) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Run "${runId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(detail, null, 2));
          return;
        }

        console.log(`\n  Intel Run: ${detail.runId}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  Status:      ${detail.status}`);
        console.log(`  Progress:    ${detail.progress}%`);
        console.log(`  Created:     ${formatRelativeTime(detail.createdAt)}`);
        if (detail.completedAt) {
          console.log(`  Completed:   ${formatRelativeTime(detail.completedAt)}`);
        }

        if (detail.resultsSummary) {
          const s = detail.resultsSummary;
          console.log('');
          console.log(`  VoC Records:   ${s.vocRecordsExtracted}`);
          console.log(`  Ad Angles:     ${s.anglesGenerated}`);
          console.log(`  Threads:       ${s.threadsAnalyzed}`);
          console.log(`  Duplicates:    ${s.duplicatesDetected}`);
        }

        if (detail.tokenUsage) {
          console.log('');
          console.log(`  Tokens Used:   ${detail.tokenUsage.totalTokens.toLocaleString()}`);
          console.log(`  Cost:          $${detail.tokenUsage.costUSD.toFixed(4)}`);
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to get run details', error);
      }
    });

  // ── Run Cancel ──────────────────────────────────────────────────────

  run
    .command('cancel <run-id>')
    .description('Cancel a running intel run')
    .action(async (runId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Cancelling run...', stream: process.stderr }).start();

      try {
        await cancelIntelRun(runId);
        spinner.stop();
        console.log(`\n  Run "${runId}" cancelled.\n`);
      } catch (error) {
        spinner.stop();
        printError('Failed to cancel run', error);
      }
    });

  // ── VoC Records ─────────────────────────────────────────────────────

  intel
    .command('voc <run-id>')
    .description('Get Voice of Customer records from a run')
    .action(async (runId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading VoC records...', stream: process.stderr }).start();

      try {
        const records = await getVoCRecords(runId);
        spinner.stop();
        console.log(JSON.stringify(records, null, 2));
      } catch (error) {
        spinner.stop();
        printError('Failed to get VoC records', error);
      }
    });

  // ── Ad Angles ───────────────────────────────────────────────────────

  intel
    .command('angles <run-id>')
    .description('Get ad angles generated from a run')
    .action(async (runId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading ad angles...', stream: process.stderr }).start();

      try {
        const angles = await getAdAngles(runId);
        spinner.stop();
        console.log(JSON.stringify(angles, null, 2));
      } catch (error) {
        spinner.stop();
        printError('Failed to get ad angles', error);
      }
    });

  // ── Targeting Pack ──────────────────────────────────────────────────

  intel
    .command('targeting <run-id>')
    .description('Get targeting pack from a run')
    .action(async (runId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading targeting pack...', stream: process.stderr }).start();

      try {
        const targeting = await getTargetingPack(runId);
        spinner.stop();
        console.log(JSON.stringify(targeting, null, 2));
      } catch (error) {
        spinner.stop();
        printError('Failed to get targeting pack', error);
      }
    });

  // ── Templates List ──────────────────────────────────────────────────

  intel
    .command('templates')
    .description('List available research templates')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading templates...', stream: process.stderr }).start();

      try {
        const templates = await listTemplates();
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(templates, null, 2));
          return;
        }

        if (templates.length === 0) {
          console.log('\n  No templates found.\n');
          return;
        }

        console.log(`\n  Intel Templates (${templates.length})\n`);

        const cols: Array<[string, number]> = [
          ['ID', 24],
          ['Name', 26],
          ['Category', 16],
          ['Source', 10],
        ];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(76, (process.stdout.columns || 76) - 4)));

        for (const t of templates) {
          console.log(formatTableRow([
            [t.id, 24],
            [t.name, 26],
            [t.category, 16],
            [t.source, 10],
          ]));
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to list templates', error);
      }
    });

  // ── Template subcommand group ───────────────────────────────────────

  const template = intel
    .command('template')
    .description('Manage intel templates');

  // ── Template Info ───────────────────────────────────────────────────

  template
    .command('info <template-id>')
    .description('Show details of a specific template')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading template...', stream: process.stderr }).start();

      try {
        const t = await getTemplate(id);
        spinner.stop();

        if (!t) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Template "${id}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(t, null, 2));
          return;
        }

        console.log(`\n  Template: ${t.name}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ID:          ${t.id}`);
        console.log(`  Category:    ${t.category}`);
        console.log(`  Source:      ${t.source}`);
        console.log(`  Description: ${t.description}`);
        if (t.tags.length > 0) {
          console.log(`  Tags:        ${t.tags.join(', ')}`);
        }
        console.log(`  Created:     ${formatRelativeTime(t.createdAt)}`);
        console.log(`  Updated:     ${formatRelativeTime(t.updatedAt)}`);
        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to get template', error);
      }
    });

  // ── Template Create ─────────────────────────────────────────────────

  template
    .command('create')
    .description('Create a new research template')
    .requiredOption('--file <path>', 'Path to JSON template definition')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      let request: CreateTemplateRequest;
      try {
        const fs = await import('node:fs');
        const content = fs.readFileSync(opts.file, 'utf-8');
        request = JSON.parse(content) as CreateTemplateRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printErrorResult({
          code: 'INVALID_FILE',
          message: `Failed to read template file: ${message}`,
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Creating template...', stream: process.stderr }).start();

      try {
        const result = await createTemplate(request);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Template created!`);
        console.log(`  ID:       ${result.id}`);
        console.log(`  Name:     ${result.name}`);
        console.log(`  Category: ${result.category}\n`);
      } catch (error) {
        spinner.stop();
        printError('Failed to create template', error);
      }
    });
}
