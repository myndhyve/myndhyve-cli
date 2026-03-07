/**
 * MyndHyve CLI — Cron Run History
 *
 * Run history is stored as JSONL (one JSON line per record)
 * in ~/.myndhyve-cli/cron/runs/<jobId>.jsonl.
 *
 * This module handles appending, querying, and pruning run logs.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
import { getCronDir } from './store.js';
import type { RunRecord } from './types.js';

const log = createLogger('CronHistory');

// ============================================================================
// DIRECTORY
// ============================================================================

/** Returns the runs directory (~/.myndhyve-cli/cron/runs/), creating it if needed. */
export function getRunsDir(): string {
  const dir = join(getCronDir(), 'runs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

// ============================================================================
// RUN ID
// ============================================================================

/** Generate a unique run ID: run-<timestamp36>-<random8hex>. */
export function generateRunId(): string {
  return `run-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

// ============================================================================
// APPEND
// ============================================================================

/** Append a single run record as a JSON line to the job's JSONL file. */
export function appendRun(record: RunRecord): void {
  try {
    const dir = getRunsDir();
    const filePath = join(dir, `${record.jobId}.jsonl`);
    const line = JSON.stringify(record) + '\n';

    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8');
      writeFileSync(filePath, existing + line, { mode: 0o600 });
    } else {
      writeFileSync(filePath, line, { mode: 0o600 });
    }

    pruneRunLog(record.jobId);
  } catch (err) {
    log.error('Failed to append run record', {
      jobId: record.jobId,
      runId: record.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// QUERY
// ============================================================================

/**
 * Read all run records for a job, sorted newest-first.
 * If `limit` is provided, returns only that many records.
 * Returns [] if the file doesn't exist.
 * Skips unparseable lines with a warning.
 */
export function listRuns(jobId: string, limit?: number): RunRecord[] {
  const filePath = join(getRunsDir(), `${jobId}.jsonl`);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.length > 0);

    const records: RunRecord[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as RunRecord);
      } catch {
        log.warn('Skipping unparseable run record line', { jobId, line: line.slice(0, 120) });
      }
    }

    // Newest first
    records.reverse();

    if (limit !== undefined && limit > 0) {
      return records.slice(0, limit);
    }

    return records;
  } catch (err) {
    log.error('Failed to read run history', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Returns the most recent run record for a job, or null. */
export function getLastRun(jobId: string): RunRecord | null {
  const runs = listRuns(jobId, 1);
  return runs.length > 0 ? runs[0] : null;
}

// ============================================================================
// PRUNING
// ============================================================================

/**
 * If the JSONL file for a job exceeds `maxBytes` (default 2MB),
 * truncate to the newest `keepLines` (default 2000) lines.
 */
export function pruneRunLog(
  jobId: string,
  maxBytes: number = 2_000_000,
  keepLines: number = 2000,
): void {
  const filePath = join(getRunsDir(), `${jobId}.jsonl`);

  if (!existsSync(filePath)) {
    return;
  }

  try {
    const stats = statSync(filePath);
    if (stats.size <= maxBytes) {
      return;
    }

    log.info('Pruning run log', {
      jobId,
      currentBytes: stats.size.toString(),
      maxBytes: maxBytes.toString(),
      keepLines: keepLines.toString(),
    });

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.length > 0);
    const kept = lines.slice(-keepLines);

    writeFileSync(filePath, kept.join('\n') + '\n', { mode: 0o600 });
  } catch (err) {
    log.error('Failed to prune run log', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

/** Delete the JSONL file for a job. Returns true if the file existed. */
export function clearRunHistory(jobId: string): boolean {
  const filePath = join(getRunsDir(), `${jobId}.jsonl`);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    unlinkSync(filePath);
    log.info('Cleared run history', { jobId });
    return true;
  } catch (err) {
    log.error('Failed to clear run history', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
