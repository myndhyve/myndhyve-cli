/**
 * MyndHyve CLI — IDE Bridge Types
 *
 * Shared type definitions for the bidirectional bridge between
 * the MyndHyve web app and local IDE projects via Firestore sync.
 */

// ============================================================================
// BRIDGE SESSION (Firestore: users/{userId}/bridgeSessions/{sessionId})
// ============================================================================

/** Supported export frameworks */
export type ExportFramework =
  | 'react-tailwind'
  | 'react-styled'
  | 'vue-tailwind'
  | 'html-css'
  | 'react-native'
  | 'flutter'
  | 'nextjs'
  | 'nuxt';

/** Sync direction options */
export type SyncDirection = 'myndhyve-to-ide' | 'ide-to-myndhyve' | 'bidirectional';

/** Bridge session status */
export type BridgeSessionStatus = 'online' | 'offline' | 'syncing' | 'building';

/** A live connection between a local project directory and a MyndHyve project. */
export interface BridgeSession {
  /** Auto-generated session ID */
  id: string;
  /** Firebase user ID */
  userId: string;
  /** MyndHyve project or hyveDocument ID */
  projectId: string;
  /** System hyve ID (e.g. 'app-builder', 'landing-page') */
  hyveId: string;

  /** Absolute local project path */
  localPath: string;
  /** Target framework/language */
  framework: ExportFramework;
  /** CLI version for compatibility checks */
  cliVersion: string;
  /** Machine hostname for display */
  hostname: string;
  /** Operating system */
  os: 'darwin' | 'linux' | 'win32';

  /** Sync direction preference */
  syncDirection: SyncDirection;
  /** Whether auto-sync is enabled */
  syncEnabled: boolean;
  /** File patterns to ignore (.gitignore-style) */
  ignorePatterns: string[];

  /** Current session status */
  status: BridgeSessionStatus;
  /** Last heartbeat timestamp (CLI writes every 15s) */
  lastHeartbeat: string;
  /** When the session was first connected */
  connectedAt: string;
  /** When the session was last disconnected */
  disconnectedAt: string | null;

  /** Whether MCP server is enabled */
  mcpEnabled: boolean;
  /** MCP transport type */
  mcpTransport: 'stdio' | 'sse';

  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// FILE SYNC RECORD (Firestore: .../bridgeSessions/{id}/files/{fileId})
// ============================================================================

/** MyndHyve entity type that a file maps to */
export type BridgeEntityType =
  | 'screen'
  | 'component'
  | 'dataModel'
  | 'apiSpec'
  | 'theme'
  | 'config'
  | 'asset';

/** File sync status — must match web app's FileSyncStatus in ide-bridge/types.ts */
export type FileSyncStatus =
  | 'synced'
  | 'modified-local'
  | 'modified-remote'
  | 'conflict'
  | 'new'
  | 'deleted';

/** Per-file bidirectional sync state */
export interface FileSyncRecord {
  /** Deterministic ID: SHA-256 of relativePath (first 16 hex chars) */
  id: string;
  /** Relative path from project root (e.g. 'src/pages/Home.tsx') */
  relativePath: string;

  /** MyndHyve entity type this file maps to */
  entityType: BridgeEntityType;
  /** MyndHyve entity ID */
  entityId: string;

  /** SHA-256 of last mutually-synced content (common ancestor) */
  baseHash: string;
  /** SHA-256 of current local file content (CLI updates this) */
  localHash: string;
  /** SHA-256 of MyndHyve-generated content (web app updates this) */
  remoteHash: string;

  /** Current sync status */
  syncStatus: FileSyncStatus;
  /** When the file was last synced */
  lastSyncedAt: string;
  /** When the local file was last modified */
  localModifiedAt: string | null;
  /** When the remote content was last modified */
  remoteModifiedAt: string | null;

  /**
   * Base64-encoded file content pending transfer.
   * Populated when one side has a change for the other.
   * Cleared after the receiving side acknowledges.
   */
  pendingContent: string | null;
  /** Which side pushed the pending content */
  pendingSource: 'local' | 'remote' | null;

  /** Reference to conflict record if in conflict state */
  conflictId: string | null;

  /** File size in bytes */
  fileSize: number;
  /** MIME type (detected from extension) */
  mimeType: string;
  /** How the file was originally created */
  generatedBy: 'scaffold' | 'codegen' | 'manual' | null;

  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// BUILD RECORD (Firestore: .../bridgeSessions/{id}/builds/{buildId})
// ============================================================================

/** Build type */
export type BuildType =
  | 'development'
  | 'production'
  | 'preview'
  | 'test'
  | 'lint'
  | 'typecheck';

/** Build status */
export type BuildStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/** Parsed build error */
export interface BuildError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

/** Parsed build warning */
export interface BuildWarning {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

/** Build artifact */
export interface BuildArtifact {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  hash: string;
}

/** A build request and its results */
export interface BuildRecord {
  id: string;

  /** Build type */
  buildType: BuildType;
  /** Resolved command (e.g. 'npm run build') */
  command: string;
  /** Extra environment variables */
  env: Record<string, string>;
  /** Who requested the build */
  requestedBy: string;
  requestedAt: string;

  /** Current build status */
  status: BuildStatus;
  /** Process exit code (null until complete) */
  exitCode: number | null;
  /** Duration in milliseconds */
  duration: number | null;

  /** Parsed error count */
  errorCount: number;
  /** Parsed warning count */
  warningCount: number;
  /** Parsed errors (max 50) */
  errors: BuildError[];
  /** Parsed warnings (max 50) */
  warnings: BuildWarning[];

  /** Collected build artifacts */
  artifacts: BuildArtifact[];

  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ============================================================================
// BUILD OUTPUT CHUNK (Firestore: .../builds/{id}/output/{chunkId})
// ============================================================================

/** A chunk of build output (batched for Firestore efficiency) */
export interface BuildOutputChunk {
  id: string;
  /** Which output stream */
  stream: 'stdout' | 'stderr';
  /** Output content (~4KB max per chunk) */
  content: string;
  /** When this chunk was produced */
  timestamp: string;
}

// ============================================================================
// CONFLICT RECORD (Firestore: .../bridgeSessions/{id}/conflicts/{conflictId})
// ============================================================================

/** Conflict type */
export type ConflictType = 'content' | 'delete' | 'rename';

/** Conflict resolution strategy */
export type ConflictStrategy = 'keep-local' | 'keep-remote' | 'merge' | 'manual';

/** A detected sync conflict requiring resolution */
export interface ConflictRecord {
  id: string;
  /** Reference to the FileSyncRecord */
  fileId: string;
  /** Relative path (denormalized for display) */
  relativePath: string;

  /** Last synced version (common ancestor) */
  baseContent: string;
  /** CLI/IDE side content */
  localContent: string;
  /** MyndHyve side content */
  remoteContent: string;

  baseHash: string;
  localHash: string;
  remoteHash: string;

  /** Type of conflict */
  conflictType: ConflictType;

  /** Resolution state */
  status: 'pending' | 'resolved';
  /** How it was resolved */
  resolution: ConflictStrategy | null;
  /** Final resolved content */
  resolvedContent: string | null;
  /** Who resolved it */
  resolvedBy: string | null;
  resolvedAt: string | null;

  detectedAt: string;
}

// ============================================================================
// SYNC OPERATION (Firestore: .../bridgeSessions/{id}/syncOps/{opId})
// ============================================================================

/** Sync operation type */
export type SyncOperationType = 'push' | 'pull' | 'bidirectional' | 'export' | 'import';

/** Sync scope */
export type SyncScope = 'full' | 'incremental' | 'selective';

/** Audit record for a sync operation */
export interface SyncOperationRecord {
  id: string;
  type: SyncOperationType;
  scope: SyncScope;
  direction: 'push' | 'pull' | 'bidirectional';

  /** Number of files involved */
  fileCount: number;
  /** Relative paths of changed files */
  filesChanged: string[];

  /** Operation status */
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  /** Progress 0-100 */
  progress: number;
  /** Error message if failed */
  error: string | null;

  /** Conflict counts */
  conflictCount: number;
  resolvedCount: number;

  startedAt: string;
  completedAt: string | null;
  /** Who initiated: web app, CLI daemon, or automatic */
  initiatedBy: 'web' | 'cli' | 'auto';
}

// ============================================================================
// LOCAL CONFIG (.myndhyve/bridge.json in linked project)
// ============================================================================

/** Local bridge configuration file stored in the project root */
export interface BridgeLocalConfig {
  /** Bridge session ID */
  sessionId: string;
  /** MyndHyve project/hyveDocument ID */
  projectId: string;
  /** System hyve ID */
  hyveId: string;
  /** Target framework */
  framework: ExportFramework;
  /** Firebase user ID */
  userId: string;
  /** When the link was created */
  linkedAt: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Heartbeat interval in milliseconds (CLI writes to Firestore) */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Staleness threshold: if lastHeartbeat is older than this, the CLI is offline */
export const HEARTBEAT_STALE_MS = 45_000;

/** File watcher debounce delay in milliseconds */
export const WATCHER_DEBOUNCE_MS = 500;

/** Firestore poll interval in milliseconds (for remote changes) */
export const POLL_INTERVAL_MS = 3_000;

/** Maximum file size for inline sync (larger files use Firebase Storage) */
export const MAX_INLINE_FILE_SIZE = 900 * 1024; // 900KB

/** Default ignore patterns */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  '.nuxt/**',
  '*.log',
  '.DS_Store',
  '.myndhyve/**',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

/** MIME types by file extension */
export const MIME_TYPES: Record<string, string> = {
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.html': 'text/html',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
