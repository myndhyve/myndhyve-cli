/**
 * MyndHyve CLI — Configuration Loader
 *
 * Reads/writes config from ~/.myndhyve-cli/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RelayConfigSchema, type RelayConfig } from './types.js';
import type { RelayChannel } from '../relay/types.js';

// ============================================================================
// PATHS
// ============================================================================

const CLI_DIR_NAME = '.myndhyve-cli';

export function getCliDir(): string {
  return join(homedir(), CLI_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getCliDir(), 'config.json');
}

export function getAuthDir(channel: string): string {
  return join(getCliDir(), channel);
}

export function getLogDir(): string {
  return join(getCliDir(), 'logs');
}

// ============================================================================
// ENSURE DIRECTORIES
// ============================================================================

export function ensureCliDir(): void {
  const dir = getCliDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function ensureAuthDir(channel: string): string {
  const dir = getAuthDir(channel);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function ensureLogDir(): string {
  const dir = getLogDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

// ============================================================================
// LOAD / SAVE
// ============================================================================

/**
 * Load config from disk. Returns defaults if file doesn't exist.
 */
export function loadConfig(): RelayConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return RelayConfigSchema.parse({});
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const json = JSON.parse(raw);
    return RelayConfigSchema.parse(json);
  } catch (error) {
    // Config file is corrupted — warn so the user knows
    process.stderr.write(
      `Warning: Config file corrupted (${error instanceof Error ? error.message : 'parse error'}), using defaults.\n`
    );
    return RelayConfigSchema.parse({});
  }
}

/**
 * Save config to disk. Creates directory if needed.
 */
export function saveConfig(config: RelayConfig): void {
  ensureCliDir();
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Update specific fields in the config.
 */
export function updateConfig(patch: Partial<RelayConfig>): RelayConfig {
  const current = loadConfig();
  const updated = RelayConfigSchema.parse({ ...current, ...patch });
  saveConfig(updated);
  return updated;
}

/**
 * Check if the relay agent has been set up (has relayId + deviceToken).
 */
export function isConfigured(): boolean {
  const config = loadConfig();
  return !!(config.relayId && config.deviceToken && config.channel);
}

// ============================================================================
// TYPE-SAFE CONFIGURED ACCESS
// ============================================================================

/** Config with required fields guaranteed present. */
export interface ConfiguredRelay extends RelayConfig {
  channel: RelayChannel;
  relayId: string;
  deviceToken: string;
  tokenExpiresAt?: string;
}

/**
 * Load config and verify it's fully configured.
 * Returns null if not configured — avoids non-null assertions (`!`).
 */
export function loadConfiguredRelay(): ConfiguredRelay | null {
  const config = loadConfig();
  if (!config.channel || !config.relayId || !config.deviceToken) return null;
  return config as ConfiguredRelay;
}
