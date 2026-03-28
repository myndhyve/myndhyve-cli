/**
 * MyndHyve CLI — Token Usage API
 *
 * Reads token usage from Firestore.
 * Path: users/{userId}/tokenUsage/{YYYY-MM-DD}
 */

import { getDocument } from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UsageAPI');

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
  const doc = await getDocument(`users/${userId}/tokenUsage`, dateStr);
  if (!doc) return null;
  return doc as unknown as DailyTokenUsageSummary;
}

export async function getUsageForDate(userId: string, date: string): Promise<DailyTokenUsageSummary | null> {
  log.debug('Fetching usage for date');
  const doc = await getDocument(`users/${userId}/tokenUsage`, date);
  if (!doc) return null;
  return doc as unknown as DailyTokenUsageSummary;
}
