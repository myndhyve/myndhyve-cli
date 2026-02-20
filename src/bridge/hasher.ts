/**
 * MyndHyve CLI — File Content Hasher
 *
 * SHA-256 hashing for file content change detection.
 * Used for 3-way sync conflict detection (baseHash / localHash / remoteHash).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Compute SHA-256 hash of a string or buffer.
 * Returns the hex-encoded hash.
 */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute SHA-256 hash of a file on disk.
 * Returns the hex-encoded hash, or null if the file doesn't exist.
 */
export async function hashFile(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath);
    return hashContent(content);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Generate a deterministic file ID from a relative path.
 * Uses the first 16 hex characters of the SHA-256 hash.
 */
export function fileIdFromPath(relativePath: string): string {
  return hashContent(relativePath).slice(0, 16);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
