/**
 * MyndHyve CLI — Market Intelligence API
 *
 * Interacts with the marketIntelApi Cloud Function for running market research,
 * viewing VoC data, ad angles, targeting packs, and managing templates.
 *
 * @see functions/src/market-intel/ — server endpoints
 */

import { getAPIClient, APIClientError } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MarketIntelAPI');

// ============================================================================
// TYPES
// ============================================================================

export interface ICP {
  roles: string[];
  industries: string[];
  companyStage?: string[];
  painPoints?: string[];
  goals?: string[];
}

export interface Product {
  name: string;
  description: string;
  outcome: string;
  differentiators: string[];
}

export interface CreateRunRequest {
  icp: ICP;
  product: Product;
  sourceUrls?: string[];
  options?: {
    cleanLanguage?: boolean;
    requireSourceUrls?: boolean;
    maxCommunities?: number;
    maxThreads?: number;
    maxQuotes?: number;
  };
  templateId?: string;
}

export interface RunSummary {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  completedAt?: string;
  resultsSummary?: {
    vocRecordsExtracted: number;
    anglesGenerated: number;
    threadsAnalyzed: number;
    duplicatesDetected: number;
  };
  tokenUsage?: {
    totalTokens: number;
    costUSD: number;
  };
}

export interface RunDetail extends RunSummary {
  icp: ICP;
  product: Product;
  options: CreateRunRequest['options'];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  source: 'builtin' | 'user';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateRequest {
  name: string;
  description: string;
  category: string;
  icp: ICP;
  product?: Partial<Product>;
  options?: CreateRunRequest['options'];
  suggestedSourceUrls?: string[];
  tags?: string[];
}

interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  limit?: number;
  nextCursor?: string;
  hasMore?: boolean;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

const BASE = '/marketIntelApi/v1';

/**
 * Create a new market intelligence run.
 */
export async function createIntelRun(request: CreateRunRequest): Promise<RunSummary> {
  const client = getAPIClient();
  log.debug('Creating intel run', { product: request.product.name });
  const response = await client.post<APIResponse<RunSummary>>(`${BASE}/runs`, request);

  if (!response.success || !response.data) {
    throw new APIClientError(
      response.error?.message || 'Failed to create intel run',
      response.error?.code || 'API_ERROR'
    );
  }
  return response.data;
}

/**
 * List market intelligence runs.
 */
export async function listIntelRuns(): Promise<RunSummary[]> {
  const client = getAPIClient();
  log.debug('Listing intel runs');
  const response = await client.get<APIResponse<RunSummary[]>>(`${BASE}/runs`);
  return response.data || [];
}

/**
 * Get detailed information about a specific run.
 */
export async function getIntelRun(runId: string): Promise<RunDetail | null> {
  const client = getAPIClient();
  log.debug('Getting intel run', { runId });

  try {
    const response = await client.get<APIResponse<RunDetail>>(`${BASE}/runs/${encodeURIComponent(runId)}`);
    return response.data || null;
  } catch {
    return null;
  }
}

/**
 * Get VoC (Voice of Customer) records from a run.
 */
export async function getVoCRecords(runId: string): Promise<unknown[]> {
  const client = getAPIClient();
  log.debug('Getting VoC records', { runId });
  const response = await client.get<APIResponse<unknown[]>>(`${BASE}/runs/${encodeURIComponent(runId)}/voc`);
  return response.data || [];
}

/**
 * Get ad angles generated from a run.
 */
export async function getAdAngles(runId: string): Promise<unknown[]> {
  const client = getAPIClient();
  log.debug('Getting ad angles', { runId });
  const response = await client.get<APIResponse<unknown[]>>(`${BASE}/runs/${encodeURIComponent(runId)}/angles`);
  return response.data || [];
}

/**
 * Get the targeting pack from a run.
 */
export async function getTargetingPack(runId: string): Promise<unknown> {
  const client = getAPIClient();
  log.debug('Getting targeting pack', { runId });
  const response = await client.get<APIResponse<unknown>>(`${BASE}/runs/${encodeURIComponent(runId)}/targeting`);
  return response.data || null;
}

/**
 * Cancel a running intel run.
 */
export async function cancelIntelRun(runId: string): Promise<{ success: boolean }> {
  const client = getAPIClient();
  log.debug('Cancelling intel run', { runId });
  return client.delete<{ success: boolean }>(`${BASE}/runs/${encodeURIComponent(runId)}`);
}

/**
 * List market intelligence templates.
 */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const client = getAPIClient();
  log.debug('Listing templates');
  const response = await client.get<APIResponse<TemplateSummary[]>>(`${BASE}/templates`);
  return response.data || [];
}

/**
 * Get a specific template.
 */
export async function getTemplate(id: string): Promise<TemplateSummary | null> {
  const client = getAPIClient();
  log.debug('Getting template', { id });

  try {
    const response = await client.get<APIResponse<TemplateSummary>>(`${BASE}/templates/${encodeURIComponent(id)}`);
    return response.data || null;
  } catch {
    return null;
  }
}

/**
 * Create a new template.
 */
export async function createTemplate(request: CreateTemplateRequest): Promise<TemplateSummary> {
  const client = getAPIClient();
  log.debug('Creating template', { name: request.name });
  const response = await client.post<APIResponse<TemplateSummary>>(`${BASE}/templates`, request);

  if (!response.success || !response.data) {
    throw new APIClientError(
      response.error?.message || 'Failed to create template',
      response.error?.code || 'API_ERROR'
    );
  }
  return response.data;
}
