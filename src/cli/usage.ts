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

/**
 * Strip ANSI escape sequences + non-printing control characters from
 * a string before rendering it to the operator's terminal. Defense in
 * depth against breakdown keys that flow from Firestore via the
 * getWorkspaceUsage callable: if a malicious tenant ever writes shard
 * data with crafted bracket-notation field paths (admin-SDK-bypass
 * scenario), we don't want crafted ANSI sequences executing in the
 * caller's terminal. Same protection applied to provider / model /
 * scope keys uniformly.
 */
function sanitizeBreakdownKey(raw: unknown, fallback: string, maxLen = 64): string {
  if (typeof raw !== 'string') return fallback;
  // Strip C0 controls (0x00-0x1F including ESC=0x1B + BEL=0x07), DEL
  // (0x7F), and C1 controls (0x80-0x9F). This neutralizes CSI / OSC /
  // hyperlink / cursor-movement escape sequences before they reach
  // `console.log`. Hex-escape form keeps the regex source-readable
  // (vs literal control bytes that some editors mangle) and avoids
  // tripping `no-control-regex` since the only suppressed range is
  // explicit and bounded.
  const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;
  const stripped = raw.replace(CONTROL_CHARS, '');
  if (stripped.length === 0) return fallback;
  return stripped.length > maxLen ? stripped.slice(0, maxLen - 1) + '…' : stripped;
}

/**
 * Coerce a `WorkspaceUsageBreakdownEntry` to safe numeric fields. If
 * any field is malformed (non-finite, undefined, string), render a
 * zero rather than letting `formatTokens(undefined)` throw downstream.
 * Returns `null` when the entire entry is unusable so callers can
 * skip the row instead of rendering meaningless zeros.
 */
function coerceBreakdownEntry(
  raw: unknown,
): { tokens: number; costCents: number; requests: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { tokens?: unknown; costCents?: unknown; requests?: unknown };
  const num = (x: unknown): number =>
    typeof x === 'number' && Number.isFinite(x) ? x : 0;
  const entry = {
    tokens: num(v.tokens),
    costCents: num(v.costCents),
    requests: num(v.requests),
  };
  // If every counter is zero AND none was a real number, treat as
  // unusable. Real zero-shard rows would still be filtered out at the
  // .length > 0 gate, so this only drops genuinely-malformed entries.
  if (entry.tokens === 0 && entry.costCents === 0 && entry.requests === 0 &&
      typeof v.tokens !== 'number' && typeof v.costCents !== 'number' && typeof v.requests !== 'number') {
    return null;
  }
  return entry;
}

/**
 * Phase 1.6 of the WOP A-grade closeout — human-readable labels for
 * the four `byokSecretResolver.resolveWithProvenance` source values.
 *
 * Mirror of `SECRET_SCOPE_LABELS` in the browser AICostDashboard
 * (src/components/observability/AICostDashboard.tsx). Both surfaces
 * track the spec language at
 * `https://github.com/myndhyve/wop/blob/main/spec/v1/byok.md` —
 * update both maps together when the enum graduates.
 */
const SECRET_SCOPE_LABELS: Record<string, string> = {
  run: 'Run-scope ephemeral',
  user: 'User BYOK',
  tenant: 'Workspace BYOK',
  platform: 'Platform fallback',
};

/** Allowlist used to short-circuit unknown / hostile scope keys to a safe rendering. */
const KNOWN_SECRET_SCOPES = new Set(Object.keys(SECRET_SCOPE_LABELS));

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
        // Architecture-review hardening (2026-05-05): each breakdown row
        // is sanitized + coerced before printing. `sanitizeBreakdownKey`
        // strips ANSI/control characters from Firestore-sourced keys,
        // `coerceBreakdownEntry` skips malformed rows so a partial-write
        // race or schema drift doesn't throw deep in the formatter chain
        // (which would surface as a misleading "Failed to fetch workspace
        // usage" error).
        const renderBreakdown = (
          label: string,
          breakdown: Record<string, unknown> | undefined,
          colWidth: number,
        ): void => {
          if (!breakdown) return;
          const rows: Array<[string, { tokens: number; costCents: number; requests: number }]> = [];
          for (const [rawKey, rawEntry] of Object.entries(breakdown)) {
            const entry = coerceBreakdownEntry(rawEntry);
            if (!entry) continue;
            const key = sanitizeBreakdownKey(rawKey, '<unknown>');
            rows.push([key, entry]);
          }
          if (rows.length === 0) return;
          console.log(chalk.dim(`\n${label}:`));
          for (const [k, s] of rows) {
            console.log(`  ${fitColumn(k, colWidth)} ${formatTokens(s.tokens)} tokens · ${formatCents(s.costCents)} · ${s.requests} req`);
          }
        };
        renderBreakdown('By Provider', data.byProvider as Record<string, unknown>, 15);
        renderBreakdown('By Model', data.byModel as Record<string, unknown>, 35);

        // Phase 1.6 of the WOP A-grade closeout — BYOK/platform secret-scope
        // breakdown. Optional because older deployments of getWorkspaceUsage
        // don't surface the field. Unknown scope keys (future enum
        // graduation, malicious tenant write) fall back to the sanitized
        // raw key with a "(unknown)" tag so the row still renders without
        // breaking the table.
        const scopeRows: Array<[string, string, { tokens: number; costCents: number; requests: number }]> = [];
        for (const [rawKey, rawEntry] of Object.entries(data.bySecretScope ?? {})) {
          const entry = coerceBreakdownEntry(rawEntry);
          if (!entry) continue;
          const safeKey = sanitizeBreakdownKey(rawKey, 'unknown', 32);
          const label = KNOWN_SECRET_SCOPES.has(safeKey)
            ? SECRET_SCOPE_LABELS[safeKey]
            : safeKey;
          const tag = KNOWN_SECRET_SCOPES.has(safeKey) ? safeKey : `${safeKey} · unknown`;
          scopeRows.push([label, tag, entry]);
        }
        if (scopeRows.length > 0) {
          console.log(chalk.dim('\nBy Secret Scope:'));
          for (const [label, tag, s] of scopeRows) {
            // Pad the raw `(tag)` string to a fixed visible width FIRST,
            // THEN wrap in chalk.dim — `padEnd` measures the underlying
            // string length, and chalk's escape sequences would distort
            // that count if applied beforehand.
            const tagPaddedRaw = `(${tag})`.padEnd(14);
            const tagDim = chalk.dim(tagPaddedRaw);
            console.log(`  ${fitColumn(label, 22)} ${tagDim} ${formatTokens(s.tokens)} tokens · ${formatCents(s.costCents)} · ${s.requests} req`);
          }
        }
      } catch (err) {
        printError('Failed to fetch workspace usage', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });
}
