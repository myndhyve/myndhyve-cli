/**
 * MyndHyve CLI — File Watcher
 *
 * Watches a local project directory for file changes using node:fs.watch.
 * Debounces rapid changes and filters through ignore patterns.
 * Emits normalized change events for the sync engine to process.
 */

import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import { IgnoreMatcher } from './ignore.js';
import { hashFile } from './hasher.js';
import { WATCHER_DEBOUNCE_MS, MAX_INLINE_FILE_SIZE, MIME_TYPES } from './types.js';

const log = createLogger('FileWatcher');

// ============================================================================
// TYPES
// ============================================================================

export interface FileChangeEvent {
  /** Relative path from project root (POSIX-style forward slashes) */
  relativePath: string;
  /** Type of change */
  changeType: 'added' | 'modified' | 'deleted';
  /** SHA-256 hash of new content (null for deleted) */
  hash: string | null;
  /** File size in bytes (0 for deleted) */
  fileSize: number;
  /** Detected MIME type */
  mimeType: string;
}

export interface FileWatcherConfig {
  /** Project root directory */
  rootPath: string;
  /** Ignore pattern matcher */
  ignoreMatcher: IgnoreMatcher;
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Maximum file size to process (bytes) */
  maxFileSize?: number;
}

export interface FileWatcherEvents {
  change: (event: FileChangeEvent) => void;
  error: (error: Error) => void;
  ready: () => void;
}

// ============================================================================
// FILE WATCHER
// ============================================================================

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly config: Required<FileWatcherConfig>;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly knownHashes = new Map<string, string>();
  private closed = false;

  constructor(config: FileWatcherConfig) {
    super();
    this.config = {
      debounceMs: WATCHER_DEBOUNCE_MS,
      maxFileSize: MAX_INLINE_FILE_SIZE,
      ...config,
    };
  }

  /**
   * Start watching the project directory.
   */
  start(): void {
    if (this.watcher) {
      log.warn('Watcher already started');
      return;
    }

    const { rootPath } = this.config;
    log.info('Starting file watcher', { rootPath });

    try {
      this.watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
        if (this.closed || !filename) return;
        this.handleFsEvent(eventType, filename);
      });

      this.watcher.on('error', (error) => {
        log.error('File watcher error', { error: error.message });
        this.emit('error', error);
      });

      this.emit('ready');
      log.info('File watcher started');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to start file watcher', { error: err.message });
      this.emit('error', err);
    }
  }

  /**
   * Stop watching and clean up.
   */
  stop(): void {
    this.closed = true;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      log.info('File watcher stopped');
    }
  }

  /**
   * Set the known hash for a file (used to suppress echo events after sync writes).
   */
  setKnownHash(relativePath: string, hash: string): void {
    this.knownHashes.set(relativePath, hash);
  }

  /**
   * Clear the known hash for a file.
   */
  clearKnownHash(relativePath: string): void {
    this.knownHashes.delete(relativePath);
  }

  // --------------------------------------------------------------------------
  // INTERNAL
  // --------------------------------------------------------------------------

  private handleFsEvent(_eventType: string, filename: string): void {
    // Normalize to forward slashes
    const relativePath = filename.replace(/\\/g, '/');

    // Check ignore patterns
    if (this.config.ignoreMatcher.isIgnored(relativePath)) {
      return;
    }

    // Debounce rapid changes to the same file
    const existing = this.debounceTimers.get(relativePath);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      relativePath,
      setTimeout(() => {
        this.debounceTimers.delete(relativePath);
        this.processFileChange(relativePath).catch((error) => {
          log.error('Error processing file change', {
            relativePath,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, this.config.debounceMs)
    );
  }

  private async processFileChange(relativePath: string): Promise<void> {
    const absolutePath = join(this.config.rootPath, relativePath);

    try {
      const fileStat = await stat(absolutePath);

      // Skip directories
      if (fileStat.isDirectory()) return;

      // Skip files that are too large
      if (fileStat.size > this.config.maxFileSize) {
        log.debug('Skipping large file', { relativePath, size: fileStat.size });
        return;
      }

      // Compute hash
      const hash = await hashFile(absolutePath);
      if (!hash) return; // File disappeared between stat and read

      // Suppress echo: if the hash matches what we just wrote, skip
      const knownHash = this.knownHashes.get(relativePath);
      if (knownHash && knownHash === hash) {
        this.knownHashes.delete(relativePath);
        return;
      }

      const ext = extname(relativePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      const event: FileChangeEvent = {
        relativePath,
        changeType: 'modified', // We can't distinguish add vs modify from fs.watch
        hash,
        fileSize: fileStat.size,
        mimeType,
      };

      this.emit('change', event);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        // File was deleted
        this.knownHashes.delete(relativePath);

        const event: FileChangeEvent = {
          relativePath,
          changeType: 'deleted',
          hash: null,
          fileSize: 0,
          mimeType: 'application/octet-stream',
        };

        this.emit('change', event);
      } else {
        throw error;
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
