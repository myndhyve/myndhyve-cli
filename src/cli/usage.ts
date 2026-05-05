/**
 * MyndHyve CLI — Token Usage Commands
 */

import type { Command } from 'commander';
import {
  getTodayUsage,
  getUsageForDate,
  getWorkspaceUsage,
  type WorkspaceUsageRange,
} from '../api/usage.js';
import { MyndHyveClient } from '../api/client.js';
import { requireAuth, printError } from './helpers.js';
import { ExitCode } from '../utils/output.js';
import chalk from 'chalk';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

/**
 * Truncate a column value with ellipsis when longer than `width`,
 * otherwise pad to `width` for alignment. Closeout-3 UX-review #15 —
 * model ids can exceed 35 chars (e.g. claude-sonnet-4-20250514-...);
 * truncating prevents column drift in the breakdown table.
 */
function fitColumn(value: string, width: number): string {
  if (value.length === width) return value;
  if (value.length < width) return value.padEnd(width);
  return value.slice(0, width - 1) + '…';
}

export function registerUsageCommands(program: Command): void {
  const usage = program.command('usage').description('View AI token usage and costs');

  usage.command('summary').alias('today').description("Show today's token usage").action(async () => {
    const auth = requireAuth();
    if (!auth) return;
    try {
      const data = await getTodayUsage(auth.uid);
      if (!data) { console.log(chalk.dim('No usage data for today.')); return; }
      console.log(chalk.bold("Today's Token Usage\n"));
      console.log(`  Total Tokens:     ${chalk.bold(formatTokens(data.totalTokens))}`);
      console.log(`  Prompt Tokens:    ${formatTokens(data.totalPromptTokens)}`);
      console.log(`  Completion:       ${formatTokens(data.totalCompletionTokens)}`);
      console.log(`  Requests:         ${data.requestCount}`);
      console.log(`  Est. Cost:        ${chalk.yellow(`$${(data.totalEstimatedCostUsd ?? 0).toFixed(4)}`)}`);
      const providers = data.byProvider ?? {};
      if (Object.keys(providers).length > 0) {
        console.log(chalk.dim('\nBy Provider:'));
        for (const [p, s] of Object.entries(providers)) console.log(`  ${p.padEnd(15)} ${formatTokens(s.tokens)} tokens, ${s.requests} req`);
      }
    } catch (err) { printError('Failed to fetch usage data', err); process.exitCode = ExitCode.GENERAL_ERROR; }
  });

  usage.command('date <date>').description('Show usage for a date (YYYY-MM-DD)').action(async (date: string) => {
    const auth = requireAuth();
    if (!auth) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { printError('Invalid date format', 'Date must be YYYY-MM-DD'); process.exitCode = ExitCode.USAGE_ERROR; return; }
    try {
      const data = await getUsageForDate(auth.uid, date);
      if (!data) { console.log(chalk.dim(`No usage data for ${date}.`)); return; }
      console.log(chalk.bold(`Token Usage — ${date}\n`));
      console.log(`  Total Tokens:     ${chalk.bold(formatTokens(data.totalTokens))}`);
      console.log(`  Requests:         ${data.requestCount}`);
      console.log(`  Est. Cost:        ${chalk.yellow(`$${(data.totalEstimatedCostUsd ?? 0).toFixed(4)}`)}`);
    } catch (err) { printError('Failed to fetch usage data', err); process.exitCode = ExitCode.GENERAL_ERROR; }
  });

  // Closeout-3 C.3 — workspace-aggregate command. Calls the
  // `getWorkspaceUsage` v2 onCall function and prints the cost summary
  // + provider/model breakdowns. `--json` for scripting.
  usage
    .command('workspace <workspaceId>')
    .description('Show AI cost summary for a workspace')
    .option('-r, --range <range>', 'Range (24h | 7d | 30d | all)', '7d')
    .option('--json', 'Emit JSON instead of human-readable output')
    .action(async (workspaceId: string, opts: { range: string; json?: boolean }) => {
      const auth = requireAuth();
      if (!auth) return;
      const range = opts.range as WorkspaceUsageRange;
      if (!['24h', '7d', '30d', 'all'].includes(range)) {
        printError('Invalid range', `Range must be one of: 24h, 7d, 30d, all (got "${opts.range}")`);
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      try {
        const client = new MyndHyveClient();
        const data = await getWorkspaceUsage(client, workspaceId, range);
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const trackingFrom = data.earliestHourBucket
          ? data.earliestHourBucket.slice(0, 10)
          : null;
        console.log(chalk.bold(`Workspace Usage — ${workspaceId}`));
        console.log(chalk.dim(`  Range: ${range} (${data.fromDate} → ${data.toDate})`));
        if (trackingFrom) console.log(chalk.dim(`  Tracking since ${trackingFrom}`));
        console.log();
        console.log(`  Total Cost:       ${chalk.yellow(formatCents(data.totalCostCents))}`);
        console.log(`  Total Tokens:     ${chalk.bold(formatTokens(data.totalTokens))}`);
        console.log(`  Prompt Tokens:    ${formatTokens(data.promptTokens)}`);
        console.log(`  Completion:       ${formatTokens(data.completionTokens)}`);
        console.log(`  Requests:         ${data.requestCount}`);
        const providers = Object.entries(data.byProvider);
        if (providers.length > 0) {
          console.log(chalk.dim('\nBy Provider:'));
          for (const [p, s] of providers) {
            console.log(`  ${fitColumn(p, 15)} ${formatTokens(s.tokens)} tokens · ${formatCents(s.costCents)} · ${s.requests} req`);
          }
        }
        const models = Object.entries(data.byModel);
        if (models.length > 0) {
          console.log(chalk.dim('\nBy Model:'));
          for (const [m, s] of models) {
            console.log(`  ${fitColumn(m, 35)} ${formatTokens(s.tokens)} tokens · ${formatCents(s.costCents)} · ${s.requests} req`);
          }
        }
        // Phase 1.6 of the WOP A-grade closeout — BYOK/platform secret-scope
        // breakdown. Optional because older deployments of getWorkspaceUsage
        // don't surface the field. Human label is rendered first; the raw
        // enum follows in dim text so operators can still match against
        // logs / Firestore docs.
        const scopes = Object.entries(data.bySecretScope ?? {});
        if (scopes.length > 0) {
          console.log(chalk.dim('\nBy Secret Scope:'));
          const scopeLabels: Record<string, string> = {
            run: 'Run-scope ephemeral',
            user: 'User BYOK',
            tenant: 'Workspace BYOK',
            platform: 'Platform fallback',
          };
          for (const [scope, s] of scopes) {
            const label = scopeLabels[scope] ?? scope;
            const tag = chalk.dim(`(${scope})`);
            console.log(`  ${fitColumn(label, 22)} ${tag.padEnd(12)} ${formatTokens(s.tokens)} tokens · ${formatCents(s.costCents)} · ${s.requests} req`);
          }
        }
      } catch (err) {
        printError('Failed to fetch workspace usage', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });
}
