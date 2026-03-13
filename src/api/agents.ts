/**
 * MyndHyve CLI — Agent API
 *
 * Operations for AutomationAgent entities via Firestore REST API.
 * Agents are stored at `users/{userId}/agents/{agentId}`.
 */

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AgentAPI');

// ============================================================================
// TYPES
// ============================================================================

/** AI provider for agent model configuration. */
export type ModelProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'groq'
  | 'mistral'
  | 'cohere'
  | 'perplexity'
  | 'deepseek'
  | 'xai';

/** Agent model configuration. */
export interface AgentModelConfig {
  provider: ModelProvider;
  modelId: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  fallbackModels?: Array<{
    provider: ModelProvider;
    modelId: string;
    condition: 'error' | 'rate_limit' | 'cost_limit';
  }>;
}

/** Kanban board access configuration for agent auto-run. */
export interface AgentKanbanAccess {
  boardIds: string[];
  canAutoRun: boolean;
  maxConcurrent: number;
}

/** Agent summary for list display. */
export interface AgentSummary {
  id: string;
  canvasTypeId: string;
  name: string;
  description: string;
  enabled: boolean;
  provider: string;
  modelId: string;
  workflowCount: number;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** Full agent detail. */
export interface AgentDetail extends AgentSummary {
  ownerId: string;
  avatarUrl?: string;
  systemPromptId: string;
  model: AgentModelConfig;
  workflowIds: string[];
  envelopeTypes: string[];
  schedule?: { cron: string; timezone: string };
  kanbanAccess?: AgentKanbanAccess;
}

/** Default model configuration. */
export const DEFAULT_MODEL_CONFIG: AgentModelConfig = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.9,
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * List agents for a user.
 */
export async function listAgents(
  userId: string,
  options?: { canvasTypeId?: string; enabled?: boolean }
): Promise<AgentSummary[]> {
  const path = `users/${userId}/agents`;

  log.debug('Listing agents', { userId, options });

  if (options?.canvasTypeId || options?.enabled !== undefined) {
    const filters: QueryFilter[] = [];
    if (options.canvasTypeId) {
      filters.push({ field: 'hyveId', op: 'EQUAL', value: options.canvasTypeId });
    }
    if (options.enabled !== undefined) {
      filters.push({ field: 'enabled', op: 'EQUAL', value: options.enabled });
    }

    const results = await runQuery(path, filters, { limit: 100 });
    return results.map(toAgentSummary);
  }

  const { documents } = await listDocuments(path, { pageSize: 100 });
  return documents.map(toAgentSummary);
}

/**
 * Get a single agent by ID.
 */
export async function getAgent(
  userId: string,
  agentId: string
): Promise<AgentDetail | null> {
  const path = `users/${userId}/agents`;

  log.debug('Getting agent', { userId, agentId });

  const doc = await getDocument(path, agentId);
  if (!doc) return null;

  return toAgentDetail(doc);
}

/**
 * Create a new agent.
 */
export async function createAgent(
  userId: string,
  agentId: string,
  data: {
    canvasTypeId: string;
    name: string;
    description?: string;
    systemPromptId?: string;
    model?: Partial<AgentModelConfig>;
    workflowIds?: string[];
    envelopeTypes?: string[];
    tags?: string[];
    enabled?: boolean;
  }
): Promise<AgentDetail> {
  const path = `users/${userId}/agents`;

  log.debug('Creating agent', { userId, agentId, canvasTypeId: data.canvasTypeId });

  const now = new Date().toISOString();
  const agentData: Record<string, unknown> = {
    hyveId: data.canvasTypeId,
    name: data.name,
    description: data.description || '',
    systemPromptId: data.systemPromptId || '',
    model: { ...DEFAULT_MODEL_CONFIG, ...data.model },
    workflowIds: data.workflowIds || [],
    envelopeTypes: data.envelopeTypes || [],
    enabled: data.enabled ?? true,
    ownerId: userId,
    tags: data.tags || [],
    createdAt: now,
    updatedAt: now,
  };

  const doc = await createDocument(path, agentId, agentData);
  return toAgentDetail(doc);
}

/**
 * Update an agent.
 */
export async function updateAgent(
  userId: string,
  agentId: string,
  data: Record<string, unknown>
): Promise<AgentDetail> {
  const path = `users/${userId}/agents`;

  log.debug('Updating agent', { userId, agentId });

  const updateData = {
    ...data,
    updatedAt: new Date().toISOString(),
  };

  const doc = await updateDocument(path, agentId, updateData);
  return toAgentDetail(doc);
}

/**
 * Delete an agent.
 */
export async function deleteAgent(
  userId: string,
  agentId: string
): Promise<void> {
  const path = `users/${userId}/agents`;

  log.debug('Deleting agent', { userId, agentId });

  await deleteDocument(path, agentId);
}

/**
 * Enable or disable an agent.
 */
export async function toggleAgent(
  userId: string,
  agentId: string,
  enabled: boolean
): Promise<AgentDetail> {
  return updateAgent(userId, agentId, { enabled });
}

// ============================================================================
// HELPERS
// ============================================================================

function toAgentSummary(doc: Record<string, unknown>): AgentSummary {
  const model = (doc.model || {}) as Record<string, unknown>;
  const workflowIds = (doc.workflowIds || []) as string[];

  return {
    id: doc.id as string,
    canvasTypeId: (doc.hyveId as string) || '',
    name: (doc.name as string) || 'Unnamed Agent',
    description: (doc.description as string) || '',
    enabled: (doc.enabled as boolean) ?? true,
    provider: (model.provider as string) || 'anthropic',
    modelId: (model.modelId as string) || 'claude-sonnet-4-20250514',
    workflowCount: workflowIds.length,
    tags: (doc.tags as string[]) || [],
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toAgentDetail(doc: Record<string, unknown>): AgentDetail {
  const summary = toAgentSummary(doc);
  const model = (doc.model || {}) as Record<string, unknown>;

  return {
    ...summary,
    ownerId: (doc.ownerId as string) || '',
    avatarUrl: doc.avatarUrl as string | undefined,
    systemPromptId: (doc.systemPromptId as string) || '',
    model: {
      provider: (model.provider as ModelProvider) || 'anthropic',
      modelId: (model.modelId as string) || 'claude-sonnet-4-20250514',
      temperature: (model.temperature as number) ?? 0.7,
      maxTokens: (model.maxTokens as number) ?? 4096,
      topP: model.topP as number | undefined,
      frequencyPenalty: model.frequencyPenalty as number | undefined,
      presencePenalty: model.presencePenalty as number | undefined,
      stopSequences: model.stopSequences as string[] | undefined,
      fallbackModels: model.fallbackModels as AgentDetail['model']['fallbackModels'],
    },
    workflowIds: (doc.workflowIds as string[]) || [],
    envelopeTypes: (doc.envelopeTypes as string[]) || [],
    schedule: doc.schedule as { cron: string; timezone: string } | undefined,
    kanbanAccess: doc.kanbanAccess as AgentKanbanAccess | undefined,
  };
}
