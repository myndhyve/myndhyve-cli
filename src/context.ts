/**
 * MyndHyve CLI — Active Project Context
 *
 * Manages the "active project" context for the CLI. When a project is set
 * as active via `myndhyve-cli use <project-id>`, subsequent commands like
 * `chat`, `workflows`, etc. automatically use it as context.
 *
 * Stored at ~/.myndhyve-cli/context.json with restricted permissions.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getCliDir, ensureCliDir } from './config/loader.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Context');

// ============================================================================
// TYPES
// ============================================================================

const ContextSchema = z.object({
  /** Active project ID */
  projectId: z.string().min(1),
  /** Project display name (cached for quick display) */
  projectName: z.string().min(1),
  /** Parent hyve ID */
  hyveId: z.string().min(1),
  /** Hyve display name (cached) */
  hyveName: z.string().optional(),
  /** When the context was set */
  setAt: z.string(),
});

export type ActiveContext = z.infer<typeof ContextSchema>;

// ============================================================================
// CONTEXT MANAGEMENT
// ============================================================================

function getContextPath(): string {
  return join(getCliDir(), 'context.json');
}

/**
 * Get the active project context.
 * Returns null if no project is set as active.
 */
export function getActiveContext(): ActiveContext | null {
  const path = getContextPath();

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const json = JSON.parse(raw);
    return ContextSchema.parse(json);
  } catch (error) {
    log.warn('Context file corrupt or invalid, clearing', {
      reason: error instanceof Error ? error.message : 'parse error',
    });
    clearActiveContext();
    return null;
  }
}

/**
 * Set the active project context.
 */
export function setActiveContext(context: {
  projectId: string;
  projectName: string;
  hyveId: string;
  hyveName?: string;
}): ActiveContext {
  ensureCliDir();

  const active: ActiveContext = {
    ...context,
    setAt: new Date().toISOString(),
  };

  // Validate before writing
  ContextSchema.parse(active);

  writeFileSync(getContextPath(), JSON.stringify(active, null, 2), {
    mode: 0o600,
  });

  log.info('Active project set', {
    projectId: context.projectId,
    projectName: context.projectName,
  });

  return active;
}

/**
 * Clear the active project context.
 */
export function clearActiveContext(): void {
  const path = getContextPath();
  if (existsSync(path)) {
    unlinkSync(path);
    log.debug('Active context cleared');
  }
}

/**
 * Check if there is an active project set.
 */
export function hasActiveContext(): boolean {
  return getActiveContext() !== null;
}
