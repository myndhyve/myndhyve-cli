/**
 * MyndHyve CLI — Formatting Utilities
 *
 * Shared formatting functions used across CLI commands and services.
 */

import { isRunErrorCode, type RunError } from '@myndhyve/types';

/**
 * Format the time elapsed since a given date as a human-readable string.
 *
 * Examples: "just now", "3 minutes", "2 hours", "5 days"
 */
export function formatTimeSince(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

/**
 * Format a duration in milliseconds as a human-readable "time until" string.
 *
 * Examples: "3 minutes", "2 hours"
 */
export function formatTimeUntil(futureDate: Date): string {
  const diffMs = futureDate.getTime() - Date.now();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

// ─── Run-error formatting ────────────────────────────────────────────

/**
 * Map of `RunErrorCode` → operator-friendly hint. Used by
 * {@link formatRunError} to surface actionable guidance alongside the
 * raw wire code + message.
 *
 * Why a separate hint instead of overwriting `message`: the wire
 * `message` field carries the runtime-specific detail (which workflow
 * id, which node, which limit value). The hint is the GENERIC
 * remediation that's stable across all runs hitting the same code.
 * Operators see both — `message` tells them WHAT, `hint` tells them
 * WHAT TO DO.
 *
 * Codes not present here render with the wire shape only (no hint).
 * Add an entry when (a) the code is reachable from CLI users today
 * and (b) there's a concrete operator action to suggest.
 */
const RUN_ERROR_HINTS: Partial<Record<string, string>> = {
  // Authorization / access
  auth_required: 'Run `myndhyve-cli auth login` to refresh your credentials.',
  forbidden:
    "You don't have permission for this resource. Check workspace membership or scope binding.",
  workspace_not_found:
    'The workspace id is unknown to the server. Confirm the workspace exists and is not soft-deleted.',
  // Run-state conflicts
  run_already_active:
    'Another run for this project is in flight. Wait for it to terminate or use --force on the canvas runtime.',
  run_not_found: 'The run id is unknown. It may have been deleted or never created.',
  run_terminal:
    'The run already terminated. Cancel/resume operations only apply to in-flight runs.',
  engine_version_mismatch:
    'The engine version moved between request and read. Retry the operation; if persistent, redeploy or pin engineVersion.',
  // Validation
  invalid_workflow_definition:
    'The workflow id resolved to an invalid definition. Inspect the source workflow doc for missing nodes/edges.',
  invalid_trigger_input:
    'The trigger input failed schema validation. Inspect the workflow trigger schema.',
  node_type_not_found:
    'A node typeId is not registered server-side. Confirm the canvas-type is fully bootstrapped.',
  config_validation_failed:
    "A node's config failed Zod validation. Inspect the workflow definition.",
  // Quota / budget
  token_budget_exceeded:
    'The run hit the per-turn token budget. Reduce node count or increase the budget tier.',
  concurrent_run_limit_reached:
    'The workspace already has the max concurrent runs in flight. Wait for one to complete.',
  rate_limited: 'You hit a rate limit. Retry after the indicated cooldown.',
  // Execution
  node_timeout: 'A single node exceeded its time budget. Inspect the node config or upstream service.',
  global_timeout:
    'The run exceeded its global time budget. Long-running runs may need RunOptions.configurable.timeoutMs.',
  node_execution_failed:
    'A node executor threw at runtime. Check the node-state error in the run detail.',
  external_call_failed:
    'An outbound HTTP/MCP call failed. Inspect connectivity + the failing endpoint.',
  recursion_limit_exceeded:
    'The run hit the per-run nodeExecutionCount cap. Increase RunOptions.configurable.recursionLimit (capped by Capabilities.maxNodeExecutions) or simplify the workflow to fewer node executions.',
  capability_not_provided:
    'A node declared a runtime capability the host has not registered. Either install the capability provider on the host (browser registers chat.sendPrompt; Cloud Run registers no providers in v1) or remove the requires entry from the node module.',
  // Approval
  approval_timeout:
    'No reviewer approved/rejected within the timeout window. Re-trigger or extend approval.timeoutMs.',
  approval_token_invalid: 'The approval token did not match. Request a fresh approval link.',
  approval_token_expired: 'The approval token expired. Request a fresh one.',
  approval_token_consumed:
    'The approval token was already used. Each approval link is single-use.',
  // Persistence
  persistence_failed:
    'The runtime failed to write run state. Likely Firestore quota or rules — check the runtime logs.',
  doc_budget_exceeded:
    'The run doc exceeded the Firestore size budget. Check projection truncation or split the run.',
};

/**
 * Format a structured `RunError` for terminal display. Returns the
 * `[code] message (node)` line that the CLI's run-detail printer
 * uses today, optionally followed by a hint line when the code has
 * an operator-actionable remediation in {@link RUN_ERROR_HINTS}.
 *
 * Why this helper instead of inlining: keeps the format stable
 * across all CLI surfaces (run detail, run logs, approval errors,
 * watch output) so operators see the same shape everywhere. Adding
 * a hint to one site automatically extends it to the others.
 *
 * The `hint` is OFF by default to preserve current single-line
 * output for callers that haven't opted in. Set `withHint: true`
 * when the surface has space for two lines.
 */
export interface FormatRunErrorOptions {
  /**
   * When `true`, append a second line carrying the operator-
   * actionable remediation hint (when one exists for the code).
   * Default `false` for backwards compatibility.
   */
  readonly withHint?: boolean;
}

export function formatRunError(
  error: RunError | { code: string; message: string; nodeId?: string },
  opts: FormatRunErrorOptions = {},
): string {
  const codeStr = error.code;
  const lines: string[] = [];
  lines.push(
    `[${codeStr}] ${error.message}` + (error.nodeId ? ` (node: ${error.nodeId})` : ''),
  );
  if (opts.withHint && isRunErrorCode(codeStr)) {
    const hint = RUN_ERROR_HINTS[codeStr];
    if (hint) lines.push(`  Hint: ${hint}`);
  }
  return lines.join('\n');
}

/**
 * Test-only export so the suite can verify every code in
 * `RUN_ERROR_CODES` (from `@myndhyve/types`) has a hint entry. The
 * runtime helper {@link formatRunError} reads from this table; the
 * test asserts coverage so a future code addition without a hint is
 * caught at CI time.
 */
export const __RUN_ERROR_HINTS__: Readonly<Partial<Record<string, string>>> = RUN_ERROR_HINTS;
