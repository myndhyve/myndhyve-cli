/**
 * MyndHyve CLI — Usage API
 *
 * Two layers:
 *   - Per-user daily token usage at `users/{userId}/token_usage/{YYYY-MM-DD}`
 *     (read directly from Firestore via the auth-bridged firestore module).
 *     Closeout-3 C.0 renamed the collection from `tokenUsage` (camelCase)
 *     to `token_usage` (snake_case) so the firestore.rules entry matches.
 *   - Per-workspace aggregate usage via the `getWorkspaceUsage` v2 onCall
 *     function (Closeout-3 C.3). Mirrors the dashboard's `useWorkspaceUsage`
 *     hook output so totals never disagree between CLI and UI.
 *
 * @module myndhyve-cli/api/usage
 */

import { getDocument } from './firestore.js';
import type { MyndHyveClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UsageAPI');

// ─── Per-user daily summary ─────────────────────────────────────────────────

export interface DailyTokenUsageSummary {
  date: string;
  userId: string;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalEstimatedCostUsd: number;
  requestCount: number;
  byProvider: Record<string, { tokens: number; requests: number; estimatedCostUsd: number }>;
  byCanvasType: Record<string, { tokens: number; requests: number }>;
}

function getTodayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(userId: string): Promise<DailyTokenUsageSummary | null> {
  const dateStr = getTodayDateStr();
  log.debug('Fetching today usage');
  const doc = await getDocument(`users/${userId}/token_usage`, dateStr);
  if (!doc) return null;
  return doc as unknown as DailyTokenUsageSummary;
}

export async function getUsageForDate(userId: string, date: string): Promise<DailyTokenUsageSummary | null> {
  log.debug('Fetching usage for date');
  const doc = await getDocument(`users/${userId}/token_usage`, date);
  if (!doc) return null;
  return doc as unknown as DailyTokenUsageSummary;
}

// ─── Per-workspace aggregate (Closeout-3 C.3) ───────────────────────────────

export type WorkspaceUsageRange = '24h' | '7d' | '30d' | 'all';

export interface WorkspaceUsageBreakdownEntry {
  tokens: number;
  costCents: number;
  requests: number;
}

export interface WorkspaceUsageSummary {
  workspaceId: string;
  range: WorkspaceUsageRange;
  fromDate: string;
  toDate: string;
  totalCostCents: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  byProvider: Record<string, WorkspaceUsageBreakdownEntry>;
  byModel: Record<string, WorkspaceUsageBreakdownEntry>;
  /**
   * BYOK / platform credential-scope breakout per Phase 1.6 of the WOP
   * A-grade closeout (main project commit a1c5fc61). Keys are the four
   * `byokSecretResolver.resolveWithProvenance` source values:
   * `'run' | 'user' | 'tenant' | 'platform'`. Older Cloud Functions
   * deployments don't surface this field — treat as optional.
   */
  bySecretScope?: Record<string, WorkspaceUsageBreakdownEntry>;
  earliestHourBucket: string | null;
}

interface CallableEnvelope<T> {
  result: T;
}

/**
 * Fetch workspace AI usage summary via the `getWorkspaceUsage` v2 onCall
 * function. Uses the Firebase callable HTTP wire format: POST with body
 * `{data: {...}}`, response `{result: {...}}`.
 *
 * Auth: caller must be a workspace member OR super-admin (server-side
 * check; CLI passes a Firebase ID token via the standard client).
 */
export async function getWorkspaceUsage(
  client: MyndHyveClient,
  workspaceId: string,
  range: WorkspaceUsageRange,
): Promise<WorkspaceUsageSummary> {
  log.debug('Fetching workspace usage', { workspaceId, range });
  const envelope = await client.post<CallableEnvelope<WorkspaceUsageSummary>>(
    'getWorkspaceUsage',
    { data: { workspaceId, range } },
  );
  return envelope.result;
}
