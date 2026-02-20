/**
 * MyndHyve CLI — Bridge Session Management
 *
 * Manages BridgeSession documents in Firestore for tracking live connections
 * between local project directories and MyndHyve projects.
 */

import { hostname, platform } from 'node:os';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createDocument,
  updateDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  runQuery,
} from '../api/firestore.js';
import { loadCredentials } from '../auth/credentials.js';
import { createLogger } from '../utils/logger.js';
import type {
  BridgeSession,
  BridgeLocalConfig,
  ExportFramework,
  SyncDirection,
} from './types.js';
import { DEFAULT_IGNORE_PATTERNS } from './types.js';

const log = createLogger('BridgeSession');

const CLI_VERSION = '0.2.0'; // TODO: read from package.json

// ============================================================================
// LOCAL CONFIG (.myndhyve/bridge.json)
// ============================================================================

const BRIDGE_DIR = '.myndhyve';
const BRIDGE_CONFIG_FILE = 'bridge.json';

/**
 * Get the path to the .myndhyve directory in a project.
 */
export function getBridgeDir(projectRoot: string): string {
  return join(projectRoot, BRIDGE_DIR);
}

/**
 * Get the path to the bridge.json config file.
 */
export function getBridgeConfigPath(projectRoot: string): string {
  return join(projectRoot, BRIDGE_DIR, BRIDGE_CONFIG_FILE);
}

/**
 * Check if a directory has been linked to a MyndHyve project.
 */
export function isLinked(projectRoot: string): boolean {
  return existsSync(getBridgeConfigPath(projectRoot));
}

/**
 * Read the local bridge config from .myndhyve/bridge.json.
 */
export async function readLocalConfig(
  projectRoot: string
): Promise<BridgeLocalConfig | null> {
  const configPath = getBridgeConfigPath(projectRoot);
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as BridgeLocalConfig;
  } catch {
    return null;
  }
}

/**
 * Write the local bridge config to .myndhyve/bridge.json.
 */
export async function writeLocalConfig(
  projectRoot: string,
  config: BridgeLocalConfig
): Promise<void> {
  const bridgeDir = getBridgeDir(projectRoot);
  await mkdir(bridgeDir, { recursive: true });
  const configPath = getBridgeConfigPath(projectRoot);
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  log.debug('Bridge config written', { path: configPath });
}

/**
 * Remove the .myndhyve directory from a project.
 */
export async function removeLocalConfig(projectRoot: string): Promise<void> {
  const bridgeDir = getBridgeDir(projectRoot);
  if (existsSync(bridgeDir)) {
    await rm(bridgeDir, { recursive: true });
    log.debug('Bridge config removed', { path: bridgeDir });
  }
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

function getUserId(): string {
  const creds = loadCredentials();
  if (!creds?.uid) {
    throw new Error('Not authenticated. Run `myndhyve-cli auth login` first.');
  }
  return creds.uid;
}

function sessionCollection(userId: string): string {
  return `users/${userId}/bridgeSessions`;
}

function sessionPath(userId: string, sessionId: string): string {
  return `${sessionCollection(userId)}/${sessionId}`;
}

/**
 * Create a new bridge session in Firestore and write the local config.
 */
export async function createSession(opts: {
  projectRoot: string;
  projectId: string;
  hyveId: string;
  framework: ExportFramework;
  syncDirection?: SyncDirection;
}): Promise<BridgeSession> {
  const userId = getUserId();
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const session: Omit<BridgeSession, 'id'> = {
    userId,
    projectId: opts.projectId,
    hyveId: opts.hyveId,
    localPath: opts.projectRoot,
    framework: opts.framework,
    cliVersion: CLI_VERSION,
    hostname: hostname(),
    os: platform() as 'darwin' | 'linux' | 'win32',
    syncDirection: opts.syncDirection || 'bidirectional',
    syncEnabled: true,
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    status: 'offline',
    lastHeartbeat: now,
    connectedAt: now,
    disconnectedAt: null,
    mcpEnabled: false,
    mcpTransport: 'stdio',
    createdAt: now,
    updatedAt: now,
  };

  const result = await createDocument(
    sessionCollection(userId),
    sessionId,
    session as unknown as Record<string, unknown>
  );

  log.info('Bridge session created', { sessionId, projectId: opts.projectId });

  // Write local config
  const localConfig: BridgeLocalConfig = {
    sessionId,
    projectId: opts.projectId,
    hyveId: opts.hyveId,
    framework: opts.framework,
    userId,
    linkedAt: now,
  };
  await writeLocalConfig(opts.projectRoot, localConfig);

  return { ...session, id: result.id as string } as BridgeSession;
}

/**
 * Get an existing bridge session from Firestore.
 */
export async function getSession(sessionId: string): Promise<BridgeSession | null> {
  const userId = getUserId();
  const doc = await getDocument(sessionCollection(userId), sessionId);
  if (!doc) return null;
  return doc as unknown as BridgeSession;
}

/**
 * List all bridge sessions for the current user.
 */
export async function listSessions(): Promise<BridgeSession[]> {
  const userId = getUserId();
  const result = await listDocuments(sessionCollection(userId));
  return result.documents as unknown as BridgeSession[];
}

/**
 * Update session fields (e.g. status, lastHeartbeat).
 */
export async function updateSession(
  sessionId: string,
  updates: Partial<BridgeSession>
): Promise<void> {
  const userId = getUserId();
  const data = { ...updates, updatedAt: new Date().toISOString() };
  await updateDocument(
    sessionCollection(userId),
    sessionId,
    data as Record<string, unknown>,
    Object.keys(data)
  );
}

/**
 * Send a heartbeat — updates lastHeartbeat and status.
 */
export async function sendHeartbeat(
  sessionId: string,
  status: BridgeSession['status'] = 'online'
): Promise<void> {
  const now = new Date().toISOString();
  await updateSession(sessionId, {
    status,
    lastHeartbeat: now,
  });
}

/**
 * Mark a session as offline.
 */
export async function markOffline(sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateSession(sessionId, {
    status: 'offline',
    disconnectedAt: now,
  });
}

/**
 * Delete a bridge session from Firestore and remove local config.
 */
export async function deleteSession(
  sessionId: string,
  projectRoot?: string
): Promise<void> {
  const userId = getUserId();
  await deleteDocument(sessionCollection(userId), sessionId);
  log.info('Bridge session deleted', { sessionId });

  if (projectRoot) {
    await removeLocalConfig(projectRoot);
  }
}

// ============================================================================
// FILE SYNC RECORD OPERATIONS
// ============================================================================

function filesCollection(userId: string, sessionId: string): string {
  return `users/${userId}/bridgeSessions/${sessionId}/files`;
}

/**
 * Create or update a file sync record.
 */
export async function upsertFileSyncRecord(
  sessionId: string,
  fileId: string,
  data: Record<string, unknown>
): Promise<void> {
  const userId = getUserId();
  const collection = filesCollection(userId, sessionId);

  try {
    await updateDocument(collection, fileId, {
      ...data,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    // If not found, create it
    if (isNotFound(error)) {
      await createDocument(collection, fileId, {
        ...data,
        id: fileId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      throw error;
    }
  }
}

/**
 * List all file sync records for a session.
 */
export async function listFileSyncRecords(
  sessionId: string
): Promise<Record<string, unknown>[]> {
  const userId = getUserId();
  const result = await listDocuments(filesCollection(userId, sessionId));
  return result.documents;
}

/**
 * Query file sync records that have pending remote changes.
 */
export async function queryPendingRemoteFiles(
  sessionId: string
): Promise<Record<string, unknown>[]> {
  const userId = getUserId();
  return runQuery(filesCollection(userId, sessionId), [
    { field: 'pendingSource', op: 'EQUAL', value: 'remote' },
  ]);
}

// ============================================================================
// BUILD RECORD OPERATIONS
// ============================================================================

function buildsCollection(userId: string, sessionId: string): string {
  return `users/${userId}/bridgeSessions/${sessionId}/builds`;
}

/**
 * Query pending build requests.
 */
export async function queryPendingBuilds(
  sessionId: string
): Promise<Record<string, unknown>[]> {
  const userId = getUserId();
  return runQuery(buildsCollection(userId, sessionId), [
    { field: 'status', op: 'EQUAL', value: 'pending' },
  ]);
}

/**
 * Update a build record.
 */
export async function updateBuildRecord(
  sessionId: string,
  buildId: string,
  data: Record<string, unknown>
): Promise<void> {
  const userId = getUserId();
  await updateDocument(
    buildsCollection(userId, sessionId),
    buildId,
    { ...data, updatedAt: new Date().toISOString() }
  );
}

/**
 * Write a build output chunk.
 */
export async function writeBuildOutputChunk(
  sessionId: string,
  buildId: string,
  chunkId: string,
  data: Record<string, unknown>
): Promise<void> {
  const userId = getUserId();
  const collection = `users/${userId}/bridgeSessions/${sessionId}/builds/${buildId}/output`;
  await createDocument(collection, chunkId, data);
}

// ============================================================================
// HELPERS
// ============================================================================

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === 'NOT_FOUND'
  );
}
