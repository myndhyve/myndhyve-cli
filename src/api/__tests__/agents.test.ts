import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock firestore module ───────────────────────────────────────────────────

vi.mock('../firestore.js', () => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  runQuery: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
} from '../firestore.js';
import {
  DEFAULT_MODEL_CONFIG,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgent,
} from '../agents.js';
import type { AgentSummary, AgentDetail } from '../agents.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockListDocuments = listDocuments as ReturnType<typeof vi.fn>;
const mockCreateDocument = createDocument as ReturnType<typeof vi.fn>;
const mockUpdateDocument = updateDocument as ReturnType<typeof vi.fn>;
const mockDeleteDocument = deleteDocument as ReturnType<typeof vi.fn>;
const mockRunQuery = runQuery as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockListDocuments.mockReset();
  mockCreateDocument.mockReset();
  mockUpdateDocument.mockReset();
  mockDeleteDocument.mockReset();
  mockRunQuery.mockReset();
});

// ── Test data ────────────────────────────────────────────────────────────────

const userId = 'user-abc123';
const agentId = 'agent-001';
const agentPath = `users/${userId}/agents`;

function makeAgentDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: agentId,
    hyveId: 'landing-page',
    name: 'SEO Agent',
    description: 'Optimizes landing pages for search',
    enabled: true,
    ownerId: userId,
    systemPromptId: 'seo-system',
    model: {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
      topP: 0.9,
    },
    workflowIds: ['wf-1', 'wf-2'],
    envelopeTypes: ['text', 'structured'],
    tags: ['seo', 'content'],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T12:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// DEFAULT_MODEL_CONFIG
// ============================================================================

describe('DEFAULT_MODEL_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_MODEL_CONFIG.provider).toBe('anthropic');
    expect(DEFAULT_MODEL_CONFIG.modelId).toBe('claude-sonnet-4-20250514');
    expect(DEFAULT_MODEL_CONFIG.temperature).toBe(0.7);
    expect(DEFAULT_MODEL_CONFIG.maxTokens).toBe(4096);
    expect(DEFAULT_MODEL_CONFIG.topP).toBe(0.9);
  });

  it('does not include optional fields', () => {
    expect(DEFAULT_MODEL_CONFIG.frequencyPenalty).toBeUndefined();
    expect(DEFAULT_MODEL_CONFIG.presencePenalty).toBeUndefined();
    expect(DEFAULT_MODEL_CONFIG.stopSequences).toBeUndefined();
    expect(DEFAULT_MODEL_CONFIG.fallbackModels).toBeUndefined();
  });
});

// ============================================================================
// listAgents()
// ============================================================================

describe('listAgents()', () => {
  it('lists all agents without filters using listDocuments', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        makeAgentDoc(),
        makeAgentDoc({ id: 'agent-002', name: 'Content Agent', workflowIds: ['wf-3'] }),
      ],
    });

    const results = await listAgents(userId);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(agentPath, { pageSize: 100 });
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(agentId);
    expect(results[1].id).toBe('agent-002');
  });

  it('filters by hyveId using runQuery', async () => {
    mockRunQuery.mockResolvedValue([
      makeAgentDoc({ hyveId: 'app-builder' }),
    ]);

    const results = await listAgents(userId, { hyveId: 'app-builder' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collectionPath, filters, options] = mockRunQuery.mock.calls[0];
    expect(collectionPath).toBe(agentPath);
    expect(filters).toEqual([
      { field: 'hyveId', op: 'EQUAL', value: 'app-builder' },
    ]);
    expect(options).toEqual({ limit: 100 });
    expect(mockListDocuments).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].hyveId).toBe('app-builder');
  });

  it('filters by enabled=true using runQuery', async () => {
    mockRunQuery.mockResolvedValue([makeAgentDoc()]);

    const results = await listAgents(userId, { enabled: true });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'enabled', op: 'EQUAL', value: true },
    ]);
    expect(mockListDocuments).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('filters by enabled=false using runQuery', async () => {
    mockRunQuery.mockResolvedValue([
      makeAgentDoc({ enabled: false }),
    ]);

    await listAgents(userId, { enabled: false });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'enabled', op: 'EQUAL', value: false },
    ]);
  });

  it('combines hyveId and enabled filters', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listAgents(userId, { hyveId: 'slides', enabled: true });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toHaveLength(2);
    expect(filters).toEqual([
      { field: 'hyveId', op: 'EQUAL', value: 'slides' },
      { field: 'enabled', op: 'EQUAL', value: true },
    ]);
  });

  it('uses listDocuments when options is empty object', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listAgents(userId, {});

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('returns empty array when no agents exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listAgents(userId);

    expect(results).toEqual([]);
  });

  it('returns empty array from query when no matches', async () => {
    mockRunQuery.mockResolvedValue([]);

    const results = await listAgents(userId, { hyveId: 'nonexistent' });

    expect(results).toEqual([]);
  });
});

// ============================================================================
// Summary mapping
// ============================================================================

describe('Agent summary mapping', () => {
  it('returns AgentSummary with correct shape', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [makeAgentDoc()],
    });

    const [summary] = await listAgents(userId);

    expect(summary).toEqual<AgentSummary>({
      id: agentId,
      hyveId: 'landing-page',
      name: 'SEO Agent',
      description: 'Optimizes landing pages for search',
      enabled: true,
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      workflowCount: 2,
      tags: ['seo', 'content'],
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T12:00:00Z',
    });
  });

  it('computes workflowCount from workflowIds array length', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        makeAgentDoc({ workflowIds: ['a', 'b', 'c', 'd'] }),
      ],
    });

    const [summary] = await listAgents(userId);

    expect(summary.workflowCount).toBe(4);
  });

  it('sets workflowCount to 0 when workflowIds is missing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [makeAgentDoc({ workflowIds: undefined })],
    });

    const [summary] = await listAgents(userId);

    expect(summary.workflowCount).toBe(0);
  });

  it('extracts provider and modelId from nested model object', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        makeAgentDoc({
          model: { provider: 'openai', modelId: 'gpt-4o', temperature: 0.5, maxTokens: 2048 },
        }),
      ],
    });

    const [summary] = await listAgents(userId);

    expect(summary.provider).toBe('openai');
    expect(summary.modelId).toBe('gpt-4o');
  });

  it('applies defaults for missing fields in summary', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'agent-sparse' }],
    });

    const [summary] = await listAgents(userId);

    expect(summary.id).toBe('agent-sparse');
    expect(summary.hyveId).toBe('');
    expect(summary.name).toBe('Unnamed Agent');
    expect(summary.description).toBe('');
    expect(summary.enabled).toBe(true);
    expect(summary.provider).toBe('anthropic');
    expect(summary.modelId).toBe('claude-sonnet-4-20250514');
    expect(summary.workflowCount).toBe(0);
    expect(summary.tags).toEqual([]);
    expect(summary.createdAt).toBeUndefined();
    expect(summary.updatedAt).toBeUndefined();
  });
});

// ============================================================================
// getAgent()
// ============================================================================

describe('getAgent()', () => {
  it('returns AgentDetail for existing agent', async () => {
    const doc = makeAgentDoc({
      avatarUrl: 'https://example.com/avatar.png',
      schedule: { cron: '0 9 * * *', timezone: 'America/New_York' },
      kanbanAccess: { boardIds: ['board-1'], canAutoRun: true, maxConcurrent: 3 },
    });
    mockGetDocument.mockResolvedValue(doc);

    const agent = await getAgent(userId, agentId);

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(agentPath, agentId);

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(agentId);
    expect(agent!.hyveId).toBe('landing-page');
    expect(agent!.name).toBe('SEO Agent');
    expect(agent!.description).toBe('Optimizes landing pages for search');
    expect(agent!.enabled).toBe(true);
    expect(agent!.ownerId).toBe(userId);
    expect(agent!.systemPromptId).toBe('seo-system');
    expect(agent!.avatarUrl).toBe('https://example.com/avatar.png');
    expect(agent!.workflowIds).toEqual(['wf-1', 'wf-2']);
    expect(agent!.workflowCount).toBe(2);
    expect(agent!.envelopeTypes).toEqual(['text', 'structured']);
    expect(agent!.tags).toEqual(['seo', 'content']);
    expect(agent!.schedule).toEqual({ cron: '0 9 * * *', timezone: 'America/New_York' });
    expect(agent!.kanbanAccess).toEqual({ boardIds: ['board-1'], canAutoRun: true, maxConcurrent: 3 });
  });

  it('builds full AgentModelConfig with defaults', async () => {
    mockGetDocument.mockResolvedValue(
      makeAgentDoc({
        model: { provider: 'openai', modelId: 'gpt-4o' },
      })
    );

    const agent = await getAgent(userId, agentId);

    expect(agent!.model).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096,
      topP: undefined,
      frequencyPenalty: undefined,
      presencePenalty: undefined,
      stopSequences: undefined,
      fallbackModels: undefined,
    });
  });

  it('builds AgentModelConfig defaults when model is missing', async () => {
    mockGetDocument.mockResolvedValue({ id: agentId });

    const agent = await getAgent(userId, agentId);

    expect(agent!.model.provider).toBe('anthropic');
    expect(agent!.model.modelId).toBe('claude-sonnet-4-20250514');
    expect(agent!.model.temperature).toBe(0.7);
    expect(agent!.model.maxTokens).toBe(4096);
  });

  it('returns null for non-existent agent', async () => {
    mockGetDocument.mockResolvedValue(null);

    const agent = await getAgent(userId, 'nonexistent');

    expect(agent).toBeNull();
  });

  it('maps defaults for missing detail fields', async () => {
    mockGetDocument.mockResolvedValue({ id: 'agent-minimal' });

    const agent = await getAgent(userId, 'agent-minimal');

    expect(agent).not.toBeNull();
    expect(agent!.ownerId).toBe('');
    expect(agent!.systemPromptId).toBe('');
    expect(agent!.avatarUrl).toBeUndefined();
    expect(agent!.workflowIds).toEqual([]);
    expect(agent!.envelopeTypes).toEqual([]);
    expect(agent!.schedule).toBeUndefined();
    expect(agent!.kanbanAccess).toBeUndefined();
  });

  it('detail extends summary (has all summary fields)', async () => {
    mockGetDocument.mockResolvedValue(makeAgentDoc());

    const agent = await getAgent(userId, agentId);

    // Verify summary fields are present in the detail result
    expect(agent!.id).toBe(agentId);
    expect(agent!.hyveId).toBe('landing-page');
    expect(agent!.name).toBe('SEO Agent');
    expect(agent!.provider).toBe('anthropic');
    expect(agent!.modelId).toBe('claude-sonnet-4-20250514');
    expect(agent!.workflowCount).toBe(2);
    expect(agent!.tags).toEqual(['seo', 'content']);
    expect(agent!.createdAt).toBe('2026-01-15T10:00:00Z');
    expect(agent!.updatedAt).toBe('2026-01-15T12:00:00Z');
  });

  it('propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Network error'));

    await expect(getAgent(userId, agentId)).rejects.toThrow('Network error');
  });
});

// ============================================================================
// createAgent()
// ============================================================================

describe('createAgent()', () => {
  it('creates agent with merged model config and timestamps', async () => {
    mockCreateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    const agent = await createAgent(userId, agentId, {
      hyveId: 'landing-page',
      name: 'SEO Agent',
      description: 'Optimizes pages',
      model: { provider: 'openai', modelId: 'gpt-4o' },
      workflowIds: ['wf-1'],
      tags: ['seo'],
    });

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [path, id, data] = mockCreateDocument.mock.calls[0];
    expect(path).toBe(agentPath);
    expect(id).toBe(agentId);

    // Model merged with defaults
    expect(data.model).toEqual({
      ...DEFAULT_MODEL_CONFIG,
      provider: 'openai',
      modelId: 'gpt-4o',
    });

    // Timestamps set
    expect(data.createdAt).toBeTruthy();
    expect(data.updatedAt).toBeTruthy();
    expect(data.createdAt).toBe(data.updatedAt);

    // ownerId set to userId
    expect(data.ownerId).toBe(userId);

    // Returned result is AgentDetail
    expect(agent.id).toBe(agentId);
    expect(agent.name).toBe('SEO Agent');
  });

  it('uses DEFAULT_MODEL_CONFIG when no model provided', async () => {
    mockCreateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    await createAgent(userId, agentId, {
      hyveId: 'app-builder',
      name: 'Basic Agent',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.model).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it('sets enabled to true by default', async () => {
    mockCreateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    await createAgent(userId, agentId, {
      hyveId: 'slides',
      name: 'Slides Agent',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.enabled).toBe(true);
  });

  it('respects explicit enabled=false', async () => {
    mockCreateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    await createAgent(userId, agentId, {
      hyveId: 'slides',
      name: 'Disabled Agent',
      enabled: false,
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.enabled).toBe(false);
  });

  it('defaults optional fields to empty values', async () => {
    mockCreateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    await createAgent(userId, agentId, {
      hyveId: 'cad',
      name: 'Minimal Agent',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.description).toBe('');
    expect(data.systemPromptId).toBe('');
    expect(data.workflowIds).toEqual([]);
    expect(data.envelopeTypes).toEqual([]);
    expect(data.tags).toEqual([]);
  });

  it('partial model override merges with defaults', async () => {
    mockCreateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    await createAgent(userId, agentId, {
      hyveId: 'landing-page',
      name: 'Tuned Agent',
      model: { temperature: 0.3 },
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.model.provider).toBe('anthropic');
    expect(data.model.modelId).toBe('claude-sonnet-4-20250514');
    expect(data.model.temperature).toBe(0.3);
    expect(data.model.maxTokens).toBe(4096);
    expect(data.model.topP).toBe(0.9);
  });
});

// ============================================================================
// updateAgent()
// ============================================================================

describe('updateAgent()', () => {
  it('updates agent and sets updatedAt', async () => {
    mockUpdateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...makeAgentDoc(),
      ...data,
    }));

    const agent = await updateAgent(userId, agentId, { name: 'Renamed Agent' });

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [path, id, data] = mockUpdateDocument.mock.calls[0];
    expect(path).toBe(agentPath);
    expect(id).toBe(agentId);
    expect(data.name).toBe('Renamed Agent');
    expect(data.updatedAt).toBeTruthy();

    // Returns AgentDetail
    expect(agent.id).toBe(agentId);
  });

  it('includes updatedAt as ISO string', async () => {
    mockUpdateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...data,
    }));

    await updateAgent(userId, agentId, { description: 'Updated' });

    const [, , data] = mockUpdateDocument.mock.calls[0];
    // Verify updatedAt is a valid ISO date string
    expect(() => new Date(data.updatedAt as string)).not.toThrow();
    expect(new Date(data.updatedAt as string).toISOString()).toBe(data.updatedAt);
  });

  it('propagates errors from updateDocument', async () => {
    mockUpdateDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(updateAgent(userId, agentId, { name: 'fail' })).rejects.toThrow(
      'Permission denied'
    );
  });
});

// ============================================================================
// deleteAgent()
// ============================================================================

describe('deleteAgent()', () => {
  it('deletes agent at correct path', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteAgent(userId, agentId);

    expect(mockDeleteDocument).toHaveBeenCalledOnce();
    expect(mockDeleteDocument).toHaveBeenCalledWith(agentPath, agentId);
  });

  it('propagates errors from deleteDocument', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('Not found'));

    await expect(deleteAgent(userId, agentId)).rejects.toThrow('Not found');
  });
});

// ============================================================================
// toggleAgent()
// ============================================================================

describe('toggleAgent()', () => {
  it('enables an agent via updateAgent', async () => {
    mockUpdateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...makeAgentDoc({ enabled: true }),
      ...data,
    }));

    const agent = await toggleAgent(userId, agentId, true);

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [path, id, data] = mockUpdateDocument.mock.calls[0];
    expect(path).toBe(agentPath);
    expect(id).toBe(agentId);
    expect(data.enabled).toBe(true);
    expect(data.updatedAt).toBeTruthy();
    expect(agent.id).toBe(agentId);
  });

  it('disables an agent via updateAgent', async () => {
    mockUpdateDocument.mockImplementation((_path, _id, data) => ({
      id: agentId,
      ...makeAgentDoc({ enabled: false }),
      ...data,
    }));

    const agent = await toggleAgent(userId, agentId, false);

    const [, , data] = mockUpdateDocument.mock.calls[0];
    expect(data.enabled).toBe(false);
    expect(agent.id).toBe(agentId);
  });
});
