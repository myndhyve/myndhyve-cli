/**
 * MyndHyve CLI — Bridge Sync Engine
 *
 * Handles bidirectional file sync between local filesystem and Firestore.
 *
 * Push (local → remote): File watcher detects change → compute hash →
 *   write pendingContent + localHash to FileSyncRecord.
 *
 * Pull (remote → local): Poll Firestore for pendingSource === 'remote' →
 *   write content to local file → clear pending → set synced.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { createLogger } from '../utils/logger.js';
import { hashContent, hashFile, fileIdFromPath } from './hasher.js';
import {
  upsertFileSyncRecord,
  queryPendingRemoteFiles,
  listFileSyncRecords,
} from './session.js';
import type { FileChangeEvent } from './watcher.js';
import type { FileWatcher } from './watcher.js';
import type { BridgeLocalConfig, FileSyncRecord, FileSyncStatus } from './types.js';
import { MIME_TYPES, POLL_INTERVAL_MS } from './types.js';

const log = createLogger('BridgeSync');

// ============================================================================
// PUSH: Local file change → Firestore
// ============================================================================

/**
 * Handle a local file change event from the watcher.
 * Computes the hash, reads the content, and pushes to Firestore.
 */
export async function pushLocalChange(
  sessionId: string,
  projectRoot: string,
  event: FileChangeEvent
): Promise<void> {
  const fileId = fileIdFromPath(event.relativePath);

  if (event.changeType === 'deleted') {
    log.info('File deleted locally', { path: event.relativePath });
    await upsertFileSyncRecord(sessionId, fileId, {
      relativePath: event.relativePath,
      localHash: '',
      syncStatus: 'deleted' satisfies FileSyncStatus,
      localModifiedAt: new Date().toISOString(),
      pendingContent: null,
      pendingSource: 'local',
    });
    return;
  }

  // Read file content
  const absolutePath = join(projectRoot, event.relativePath);
  let content: Buffer;
  try {
    content = await readFile(absolutePath);
  } catch {
    log.warn('Could not read file for push', { path: event.relativePath });
    return;
  }

  const hash = hashContent(content);
  const base64Content = content.toString('base64');

  log.debug('Pushing local change', {
    path: event.relativePath,
    hash: hash.slice(0, 12),
    size: content.length,
  });

  await upsertFileSyncRecord(sessionId, fileId, {
    relativePath: event.relativePath,
    entityType: inferEntityType(event.relativePath),
    entityId: fileId, // Default — web app can update this with real entity mapping
    localHash: hash,
    localModifiedAt: new Date().toISOString(),
    pendingContent: base64Content,
    pendingSource: 'local',
    syncStatus: 'modified-local' satisfies FileSyncStatus,
    fileSize: content.length,
    mimeType: event.mimeType || MIME_TYPES[extname(event.relativePath).toLowerCase()] || 'application/octet-stream',
  });
}

// ============================================================================
// PULL: Firestore → Local file
// ============================================================================

/**
 * Poll Firestore for remote changes and write them to local files.
 * Returns the number of files written.
 */
export async function pullRemoteChanges(
  sessionId: string,
  projectRoot: string,
  watcher?: FileWatcher
): Promise<number> {
  const pendingFiles = await queryPendingRemoteFiles(sessionId);
  if (pendingFiles.length === 0) return 0;

  let written = 0;

  for (const record of pendingFiles) {
    const relativePath = record.relativePath as string;
    const pendingContent = record.pendingContent as string | null;
    const remoteHash = record.remoteHash as string;
    const fileId = record.id as string;

    if (!pendingContent || !relativePath) continue;

    // Decode base64 content
    const content = Buffer.from(pendingContent, 'base64');
    const absolutePath = join(projectRoot, relativePath);

    try {
      // Ensure directory exists
      await mkdir(dirname(absolutePath), { recursive: true });

      // Suppress echo: tell the watcher to ignore this write
      if (watcher) {
        watcher.setKnownHash(relativePath, remoteHash);
      }

      // Write file
      await writeFile(absolutePath, content);

      log.info('Pulled remote change', {
        path: relativePath,
        hash: remoteHash.slice(0, 12),
        size: content.length,
      });

      // Update Firestore: mark as synced
      await upsertFileSyncRecord(sessionId, fileId, {
        baseHash: remoteHash,
        localHash: remoteHash,
        syncStatus: 'synced' satisfies FileSyncStatus,
        lastSyncedAt: new Date().toISOString(),
        pendingContent: null,
        pendingSource: null,
      });

      written++;
    } catch (error) {
      log.error('Failed to write remote file', {
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return written;
}

// ============================================================================
// MANUAL SYNC
// ============================================================================

export interface ManualSyncResult {
  filesChanged: number;
  conflicts: number;
}

/**
 * Run a manual sync operation.
 */
export async function manualSync(
  projectRoot: string,
  config: BridgeLocalConfig,
  direction: 'push' | 'pull' | 'bidirectional'
): Promise<ManualSyncResult> {
  let filesChanged = 0;
  const conflicts = 0;

  if (direction === 'pull' || direction === 'bidirectional') {
    filesChanged += await pullRemoteChanges(config.sessionId, projectRoot);
  }

  if (direction === 'push' || direction === 'bidirectional') {
    // For push, scan all tracked files and push any that are modified-local
    const records = await listFileSyncRecords(config.sessionId);
    for (const record of records) {
      const relativePath = record.relativePath as string;
      const localHash = record.localHash as string;
      const baseHash = record.baseHash as string;

      if (!relativePath || localHash === baseHash) continue;

      // Re-read and push
      const absolutePath = join(projectRoot, relativePath);
      const currentHash = await hashFile(absolutePath);
      if (currentHash && currentHash !== baseHash) {
        const content = await readFile(absolutePath);
        await upsertFileSyncRecord(config.sessionId, record.id as string, {
          localHash: currentHash,
          localModifiedAt: new Date().toISOString(),
          pendingContent: content.toString('base64'),
          pendingSource: 'local',
          syncStatus: 'modified-local',
        });
        filesChanged++;
      }
    }
  }

  return { filesChanged, conflicts };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Infer entity type from file path.
 */
function inferEntityType(relativePath: string): string {
  const lower = relativePath.toLowerCase();

  if (lower.includes('/pages/') || lower.includes('/screens/') || lower.includes('/views/'))
    return 'screen';
  if (lower.includes('/components/'))
    return 'component';
  if (lower.includes('/models/') || lower.includes('/types/') || lower.includes('/schemas/'))
    return 'dataModel';
  if (lower.includes('/api/') || lower.includes('/services/'))
    return 'apiSpec';
  if (lower.includes('theme') || lower.includes('tailwind.config') || lower.includes('styles'))
    return 'theme';
  if (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml'))
    return 'config';

  return 'component'; // Default
}
