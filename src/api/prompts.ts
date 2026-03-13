/**
 * MyndHyve CLI — Prompt API
 *
 * Fetches system prompts from the promptApi Cloud Function.
 * Uses in-memory cache to avoid repeated API calls within a session.
 *
 * @see functions/src/prompt-api/index.ts — server endpoint
 * @see src/core/hyve/services/SystemPromptService.ts — web app equivalent
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PromptAPI');

// ============================================================================
// TYPES
// ============================================================================

export interface SystemPromptSummary {
  id: string;
  canvasTypeId: string;
  name: string;
  description: string;
  category: string;
  version: string;
  tags: string[];
  isActive: boolean;
  updatedAt: string;
}

export interface SystemPromptDetail extends SystemPromptSummary {
  codeVersion: string;
  templateText: string | null;
  templateSections: Record<string, string> | null;
  variables: Array<{
    name: string;
    description: string;
    source: string;
  }>;
  createdAt: string;
  customizedAt: string | null;
  customizedBy: string | null;
}

interface ListPromptsResponse {
  success: boolean;
  data: SystemPromptSummary[];
  total: number;
}

interface GetPromptResponse {
  success: boolean;
  data: SystemPromptDetail;
}

// ============================================================================
// CACHE
// ============================================================================

const promptCache = new Map<string, { data: SystemPromptDetail; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(promptId: string): SystemPromptDetail | null {
  const entry = promptCache.get(promptId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    promptCache.delete(promptId);
    return null;
  }
  return entry.data;
}

function setCache(promptId: string, data: SystemPromptDetail): void {
  promptCache.set(promptId, { data, fetchedAt: Date.now() });
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * List all active system prompts (metadata only).
 */
export async function listSystemPrompts(
  filters?: { canvasTypeId?: string; category?: string }
): Promise<SystemPromptSummary[]> {
  const client = getAPIClient();
  const query: Record<string, string> = {};
  if (filters?.canvasTypeId) query.canvasTypeId = filters.canvasTypeId;
  if (filters?.category) query.category = filters.category;

  const response = await client.get<ListPromptsResponse>(
    '/promptApi/v1/system-prompts',
    Object.keys(query).length > 0 ? query : undefined
  );

  return response.data;
}

/**
 * Get a full system prompt by ID (includes template text).
 */
export async function getSystemPrompt(
  promptId: string
): Promise<SystemPromptDetail | null> {
  // Check cache first
  const cached = getCached(promptId);
  if (cached) {
    log.debug('Cache hit', { promptId });
    return cached;
  }

  try {
    const client = getAPIClient();
    const response = await client.get<GetPromptResponse>(
      `/promptApi/v1/system-prompts/${encodeURIComponent(promptId)}`
    );

    if (response.success && response.data) {
      setCache(promptId, response.data);
      return response.data;
    }
    return null;
  } catch (err) {
    log.debug('Failed to fetch prompt', {
      promptId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Fetch the system prompt for a canvas type by its conventional ID (`{canvasTypeId}-system`).
 * Returns the template text or null if unavailable.
 */
export async function fetchCanvasTypeSystemPrompt(
  canvasTypeId: string
): Promise<string | null> {
  const promptId = `${canvasTypeId}-system`;
  const detail = await getSystemPrompt(promptId);

  if (!detail) return null;

  // Prefer templateText for static prompts, fall back to joining templateSections
  if (detail.templateText) return detail.templateText;

  if (detail.templateSections) {
    return Object.values(detail.templateSections).join('\n');
  }

  return null;
}

/**
 * Clear the in-memory prompt cache.
 */
export function clearPromptCache(): void {
  promptCache.clear();
}
