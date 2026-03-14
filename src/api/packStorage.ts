/**
 * MyndHyve CLI — Pack Storage API
 *
 * Interacts with pack storage Cloud Functions for uploading, downloading,
 * and managing pack content versions.
 *
 * @see functions/src/marketplace/storage.ts — server endpoints
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PackStorageAPI');

// ============================================================================
// TYPES
// ============================================================================

export interface PackManifest {
  packId: string;
  version: string;
  packType: string;
  name: string;
  description: string;
  checksum: string;
  size: number;
  componentCount: number;
  createdAt: string;
  publisherId: string;
  dependencies: string[];
  minPlatformVersion?: string;
}

export interface PackVersion {
  version: string;
  checksum: string;
  size: number;
  publishedAt: string;
  changelog?: string;
  downloads: number;
}

export interface UploadResult {
  success: boolean;
  packId: string;
  version: string;
  checksum?: string;
  size?: number;
  error?: string;
  errorCode?: string;
}

export interface RetrieveResult {
  success: boolean;
  packId: string;
  version: string;
  content?: unknown;
  manifest?: PackManifest;
  error?: string;
  errorCode?: string;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  errorCode?: string;
}

export interface DownloadUrlResult {
  success: boolean;
  url?: string;
  expiresAt?: string;
  error?: string;
  errorCode?: string;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Upload pack content to storage.
 */
export async function uploadPackContent(
  packId: string,
  version: string,
  content: unknown,
  options?: { changelog?: string; dependencies?: string[]; minPlatformVersion?: string }
): Promise<UploadResult> {
  const client = getAPIClient();
  log.debug('Uploading pack content', { packId, version });

  return client.post<UploadResult>('/packStorageUpload', {
    packId,
    version,
    content,
    ...options,
  });
}

/**
 * Retrieve pack content from storage.
 */
export async function getPackContent(
  packId: string,
  version?: string
): Promise<RetrieveResult> {
  const client = getAPIClient();
  const query: Record<string, string> = { packId };
  if (version) query.version = version;

  log.debug('Retrieving pack content', { packId, version });
  return client.get<RetrieveResult>('/packStorageContent', query);
}

/**
 * List versions of a pack.
 */
export async function listPackVersions(
  packId: string,
  options?: { limit?: number; includeChangelog?: boolean }
): Promise<{ success: boolean; versions?: PackVersion[] }> {
  const client = getAPIClient();
  const query: Record<string, string> = { packId };
  if (options?.limit) query.limit = String(options.limit);
  if (options?.includeChangelog) query.includeChangelog = 'true';

  log.debug('Listing pack versions', { packId });
  return client.get<{ success: boolean; versions?: PackVersion[] }>(
    '/packStorageVersions',
    query
  );
}

/**
 * Get the manifest for a specific pack version.
 */
export async function getPackManifest(
  packId: string,
  version: string
): Promise<{ success: boolean; manifest?: PackManifest }> {
  const client = getAPIClient();
  log.debug('Fetching pack manifest', { packId, version });

  return client.get<{ success: boolean; manifest?: PackManifest }>(
    '/packStorageManifest',
    { packId, version }
  );
}

/**
 * Delete a specific version of a pack.
 */
export async function deletePackVersion(
  packId: string,
  version: string
): Promise<OperationResult> {
  const client = getAPIClient();
  log.debug('Deleting pack version', { packId, version });

  return client.delete<OperationResult>('/packStorageDeleteVersion', { packId, version });
}

/**
 * Get a signed download URL for a pack version.
 */
export async function getPackDownloadUrl(
  packId: string,
  version?: string
): Promise<DownloadUrlResult> {
  const client = getAPIClient();
  const query: Record<string, string> = { packId };
  if (version) query.version = version;

  log.debug('Getting download URL', { packId, version });
  return client.get<DownloadUrlResult>('/packStorageDownloadUrl', query);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format a byte count as a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
