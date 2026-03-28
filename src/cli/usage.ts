/**
 * MyndHyve CLI — Token Usage Commands
 */

import type { Command } from 'commander';
import { getTodayUsage, getUsageForDate } from '../api/usage.js';
import { requireAuth, printError } from './helpers.js';
import { ExitCode } from '../utils/output.js';
import chalk from 'chalk';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
}
