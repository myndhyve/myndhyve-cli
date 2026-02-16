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

// ── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Mock node:crypto for deterministic rule IDs ─────────────────────────────

vi.mock('node:crypto', () => ({
  randomBytes: vi.fn(() => Buffer.from('abcdef012345', 'hex')),
}));

// ── Import module under test (after mocks) ──────────────────────────────────

import {
  listConnectors,
  getConnector,
  getPolicy,
  updatePolicy,
  listRoutingRules,
  createRoutingRule,
  deleteRoutingRule,
  listSessions,
  getSession,
  listIdentities,
  getIdentity,
  linkPeerToIdentity,
  queryDeliveryLogs,
} from '../messaging.js';

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
} from '../firestore.js';

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockListDocuments = listDocuments as ReturnType<typeof vi.fn>;
const mockCreateDocument = createDocument as ReturnType<typeof vi.fn>;
const mockUpdateDocument = updateDocument as ReturnType<typeof vi.fn>;
const mockDeleteDocument = deleteDocument as ReturnType<typeof vi.fn>;
const mockRunQuery = runQuery as ReturnType<typeof vi.fn>;

// ── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockListDocuments.mockReset();
  mockCreateDocument.mockReset();
  mockUpdateDocument.mockReset();
  mockDeleteDocument.mockReset();
  mockRunQuery.mockReset();
});

// ── Test data fixtures ──────────────────────────────────────────────────────

const USER_ID = 'user_msg_test123';

function makeRawConnector(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conn_slack_001',
    channel: 'slack',
    platformAccountId: 'T12345',
    enabled: true,
    label: 'Main Slack',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeRawConnectorWithSecrets(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...makeRawConnector(),
    signingSecret: 'sk_secret_abc',
    publicKey: 'pk_abc123',
    secretToken: 'tok_xyz',
    sessionConfig: {
      defaultDmScope: 'per-peer',
      sessionTimeoutMs: 3600000,
      maxContextEntries: 50,
      persistContext: true,
    },
    ...overrides,
  };
}

function makeRawPolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conn_slack_001',
    connectorId: 'conn_slack_001',
    channel: 'slack',
    dmPolicy: 'pairing',
    groupPolicy: 'disabled',
    requireMention: true,
    allowedUsers: ['U111', 'U222'],
    allowedChannels: ['C001', 'C002'],
    channelHyveBindings: { C001: 'hyve_lp' },
    channelWorkflowBindings: { C001: ['wf_1', 'wf_2'] },
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeRawRoutingRule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rule_abc123',
    name: 'Route Slack DMs',
    priority: 10,
    conditions: [
      { type: 'channel', operator: 'equals', value: 'slack' },
    ],
    target: { type: 'hyve', targetId: 'hyve_app_builder' },
    enabled: true,
    connectorId: 'conn_slack_001',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeRawSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'slack:T12345:U111:dm',
    sessionKey: 'slack:T12345:U111:dm',
    channel: 'slack',
    peerId: 'U111',
    peerDisplay: 'Alice',
    conversationKind: 'dm',
    conversationId: 'D001',
    linkedHyveId: 'hyve_lp',
    linkedAgentId: 'agent_001',
    linkedIdentityId: 'ident_001',
    messageCount: 42,
    lastMessageAt: '2025-06-15T08:30:00.000Z',
    createdAt: '2025-06-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeRawIdentity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ident_001',
    displayName: 'Alice Smith',
    linkedPeers: [
      { channel: 'slack', peerId: 'U111', displayName: 'alice.s', linkedAt: '2025-06-01T10:00:00.000Z' },
      { channel: 'discord', peerId: '9876543210', displayName: 'alice#1234', linkedAt: '2025-06-02T10:00:00.000Z' },
    ],
    properties: { role: 'admin', company: 'Acme' },
    managedBy: 'user',
    createdAt: '2025-06-01T10:00:00.000Z',
    updatedAt: '2025-06-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeRawDeliveryLog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'log_001',
    direction: 'ingress',
    channel: 'slack',
    correlationId: 'corr_abc',
    peerId: 'U111',
    conversationId: 'D001',
    sessionKey: 'slack:T12345:U111:dm',
    allowed: true,
    dispatched: true,
    dispatchTarget: 'hyve_lp',
    status: 'delivered',
    durationMs: 120,
    timestamp: '2025-06-15T08:30:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// listConnectors
// ============================================================================

describe('listConnectors', () => {
  it('calls listDocuments with correct collection path', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listConnectors(USER_ID);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    const [collection, options] = mockListDocuments.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingConnectors`);
    expect(options).toEqual({ pageSize: 50 });
  });

  it('returns ConnectorSummary[] with correct shape', async () => {
    const rawDocs = [
      makeRawConnector({ id: 'conn_1', channel: 'slack' }),
      makeRawConnector({ id: 'conn_2', channel: 'discord', label: 'My Discord' }),
    ];
    mockListDocuments.mockResolvedValue({ documents: rawDocs });

    const results = await listConnectors(USER_ID);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 'conn_1',
      channel: 'slack',
      platformAccountId: 'T12345',
      enabled: true,
      label: 'Main Slack',
      createdAt: '2025-06-01T10:00:00.000Z',
      updatedAt: '2025-06-01T12:00:00.000Z',
    });
    expect(results[1].id).toBe('conn_2');
    expect(results[1].channel).toBe('discord');
    expect(results[1].label).toBe('My Discord');
  });

  it('returns empty array when no connectors exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listConnectors(USER_ID);

    expect(results).toEqual([]);
  });

  it('defaults channel to "slack" when missing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'conn_minimal' }],
    });

    const results = await listConnectors(USER_ID);

    expect(results[0].channel).toBe('slack');
  });

  it('defaults enabled to true when missing (nullish coalescing)', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'conn_no_enabled' }],
    });

    const results = await listConnectors(USER_ID);

    expect(results[0].enabled).toBe(true);
  });

  it('preserves enabled=false (does not default to true)', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'conn_disabled', enabled: false }],
    });

    const results = await listConnectors(USER_ID);

    expect(results[0].enabled).toBe(false);
  });

  it('defaults platformAccountId to empty string when missing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'conn_no_acct' }],
    });

    const results = await listConnectors(USER_ID);

    expect(results[0].platformAccountId).toBe('');
  });

  it('does not include detail-only fields in summary', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [makeRawConnectorWithSecrets()],
    });

    const results = await listConnectors(USER_ID);

    const summary = results[0];
    expect(summary).not.toHaveProperty('signingSecret');
    expect(summary).not.toHaveProperty('publicKey');
    expect(summary).not.toHaveProperty('secretToken');
    expect(summary).not.toHaveProperty('sessionConfig');
    expect(summary).not.toHaveProperty('userId');
    expect(summary).not.toHaveProperty('hasSigningSecret');
  });
});

// ============================================================================
// getConnector
// ============================================================================

describe('getConnector', () => {
  it('calls getDocument with correct collection path and ID', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnectorWithSecrets());

    await getConnector(USER_ID, 'conn_slack_001');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/messagingConnectors`,
      'conn_slack_001'
    );
  });

  it('returns ConnectorDetail with hasSigningSecret/hasPublicKey/hasSecretToken booleans', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnectorWithSecrets());

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result).not.toBeNull();
    expect(result!.hasSigningSecret).toBe(true);
    expect(result!.hasPublicKey).toBe(true);
    expect(result!.hasSecretToken).toBe(true);
  });

  it('returns false for secret flags when secrets are absent', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnector());

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result).not.toBeNull();
    expect(result!.hasSigningSecret).toBe(false);
    expect(result!.hasPublicKey).toBe(false);
    expect(result!.hasSecretToken).toBe(false);
  });

  it('returns false for secret flags when secrets are empty strings', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnector({
      signingSecret: '',
      publicKey: '',
      secretToken: '',
    }));

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result!.hasSigningSecret).toBe(false);
    expect(result!.hasPublicKey).toBe(false);
    expect(result!.hasSecretToken).toBe(false);
  });

  it('includes userId in detail', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnector());

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result!.userId).toBe(USER_ID);
  });

  it('includes sessionConfig in detail', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnectorWithSecrets());

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result!.sessionConfig).toEqual({
      defaultDmScope: 'per-peer',
      sessionTimeoutMs: 3600000,
      maxContextEntries: 50,
      persistContext: true,
    });
  });

  it('returns null when connector does not exist', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getConnector(USER_ID, 'conn_nonexistent');

    expect(result).toBeNull();
  });

  it('returns undefined sessionConfig when absent', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnector());

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result!.sessionConfig).toBeUndefined();
  });

  it('includes all summary fields in detail', async () => {
    mockGetDocument.mockResolvedValue(makeRawConnector());

    const result = await getConnector(USER_ID, 'conn_slack_001');

    expect(result!.id).toBe('conn_slack_001');
    expect(result!.channel).toBe('slack');
    expect(result!.platformAccountId).toBe('T12345');
    expect(result!.enabled).toBe(true);
    expect(result!.label).toBe('Main Slack');
    expect(result!.createdAt).toBe('2025-06-01T10:00:00.000Z');
    expect(result!.updatedAt).toBe('2025-06-01T12:00:00.000Z');
  });
});

// ============================================================================
// getPolicy
// ============================================================================

describe('getPolicy', () => {
  it('returns policy from direct getDocument lookup', async () => {
    mockGetDocument.mockResolvedValue(makeRawPolicy());

    const result = await getPolicy(USER_ID, 'conn_slack_001');

    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/messagingPolicies`,
      'conn_slack_001'
    );
    expect(result).not.toBeNull();
    expect(result!.connectorId).toBe('conn_slack_001');
    expect(result!.dmPolicy).toBe('pairing');
  });

  it('falls back to runQuery when getDocument returns null', async () => {
    mockGetDocument.mockResolvedValue(null);
    mockRunQuery.mockResolvedValue([makeRawPolicy({ id: 'policy_alt_001' })]);

    const result = await getPolicy(USER_ID, 'conn_slack_001');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collection, filters, options] = mockRunQuery.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingPolicies`);
    expect(filters).toEqual([
      { field: 'connectorId', op: 'EQUAL', value: 'conn_slack_001' },
    ]);
    expect(options).toEqual({ limit: 1 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('policy_alt_001');
  });

  it('returns null when both getDocument and runQuery find nothing', async () => {
    mockGetDocument.mockResolvedValue(null);
    mockRunQuery.mockResolvedValue([]);

    const result = await getPolicy(USER_ID, 'conn_slack_001');

    expect(result).toBeNull();
  });

  it('does not call runQuery when getDocument succeeds', async () => {
    mockGetDocument.mockResolvedValue(makeRawPolicy());

    await getPolicy(USER_ID, 'conn_slack_001');

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('maps all policy fields correctly', async () => {
    mockGetDocument.mockResolvedValue(makeRawPolicy());

    const result = await getPolicy(USER_ID, 'conn_slack_001');

    expect(result).toEqual({
      id: 'conn_slack_001',
      connectorId: 'conn_slack_001',
      channel: 'slack',
      dmPolicy: 'pairing',
      groupPolicy: 'disabled',
      requireMention: true,
      allowedUsers: ['U111', 'U222'],
      allowedChannels: ['C001', 'C002'],
      channelHyveBindings: { C001: 'hyve_lp' },
      channelWorkflowBindings: { C001: ['wf_1', 'wf_2'] },
      createdAt: '2025-06-01T10:00:00.000Z',
      updatedAt: '2025-06-01T12:00:00.000Z',
    });
  });

  it('applies defaults for missing policy fields', async () => {
    mockGetDocument.mockResolvedValue({ id: 'policy_minimal' });

    const result = await getPolicy(USER_ID, 'some_connector');

    expect(result!.connectorId).toBe('');
    expect(result!.channel).toBe('slack');
    expect(result!.dmPolicy).toBe('pairing');
    expect(result!.groupPolicy).toBe('disabled');
    expect(result!.requireMention).toBe(true);
    expect(result!.allowedUsers).toEqual([]);
    expect(result!.allowedChannels).toEqual([]);
    expect(result!.channelHyveBindings).toEqual({});
    expect(result!.channelWorkflowBindings).toEqual({});
  });

  it('preserves requireMention=false (nullish coalescing)', async () => {
    mockGetDocument.mockResolvedValue(makeRawPolicy({ requireMention: false }));

    const result = await getPolicy(USER_ID, 'conn_slack_001');

    expect(result!.requireMention).toBe(false);
  });
});

// ============================================================================
// updatePolicy
// ============================================================================

describe('updatePolicy', () => {
  beforeEach(() => {
    mockUpdateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        ...makeRawPolicy({ id: docId }),
        ...data,
      })
    );
  });

  it('calls updateDocument with correct collection path', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { dmPolicy: 'open' });

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [collection] = mockUpdateDocument.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingPolicies`);
  });

  it('updates dmPolicy field with correct fieldPaths', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { dmPolicy: 'open' });

    const [, docId, data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(docId).toBe('conn_slack_001');
    expect(data.dmPolicy).toBe('open');
    expect(fieldPaths).toContain('dmPolicy');
  });

  it('updates groupPolicy field', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { groupPolicy: 'allowlist' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.groupPolicy).toBe('allowlist');
    expect(fieldPaths).toContain('groupPolicy');
  });

  it('updates requireMention field', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { requireMention: false });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.requireMention).toBe(false);
    expect(fieldPaths).toContain('requireMention');
  });

  it('updates allowedUsers field', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { allowedUsers: ['U333', 'U444'] });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.allowedUsers).toEqual(['U333', 'U444']);
    expect(fieldPaths).toContain('allowedUsers');
  });

  it('updates allowedChannels field', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { allowedChannels: ['C999'] });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.allowedChannels).toEqual(['C999']);
    expect(fieldPaths).toContain('allowedChannels');
  });

  it('always includes updatedAt in data and fieldPaths', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { dmPolicy: 'open' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.updatedAt).toBeDefined();
    expect(typeof data.updatedAt).toBe('string');
    expect(fieldPaths).toContain('updatedAt');
  });

  it('handles partial update (single field only)', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { dmPolicy: 'disabled' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(fieldPaths).toEqual(['dmPolicy', 'updatedAt']);
    expect(data.groupPolicy).toBeUndefined();
    expect(data.requireMention).toBeUndefined();
    expect(data.allowedUsers).toBeUndefined();
    expect(data.allowedChannels).toBeUndefined();
  });

  it('handles multiple fields at once', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', {
      dmPolicy: 'open',
      groupPolicy: 'open',
      requireMention: false,
      allowedUsers: ['U555'],
      allowedChannels: ['C555'],
    });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(fieldPaths).toEqual([
      'dmPolicy',
      'groupPolicy',
      'requireMention',
      'allowedUsers',
      'allowedChannels',
      'updatedAt',
    ]);
    expect(data.dmPolicy).toBe('open');
    expect(data.groupPolicy).toBe('open');
    expect(data.requireMention).toBe(false);
    expect(data.allowedUsers).toEqual(['U555']);
    expect(data.allowedChannels).toEqual(['C555']);
  });

  it('returns PolicySummary from result', async () => {
    const result = await updatePolicy(USER_ID, 'conn_slack_001', { dmPolicy: 'open' });

    expect(result).toBeDefined();
    expect(result.id).toBe('conn_slack_001');
    expect(result.connectorId).toBeDefined();
    expect(result.channel).toBeDefined();
  });

  it('updatedAt is a valid ISO timestamp', async () => {
    await updatePolicy(USER_ID, 'conn_slack_001', { dmPolicy: 'open' });

    const [, , data] = mockUpdateDocument.mock.calls[0];
    const ts = data.updatedAt as string;
    const parsed = new Date(ts);
    expect(parsed.getTime()).not.toBeNaN();
    expect(Date.now() - parsed.getTime()).toBeLessThan(5000);
  });
});

// ============================================================================
// listRoutingRules
// ============================================================================

describe('listRoutingRules', () => {
  it('calls runQuery with correct collection and ordering', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listRoutingRules(USER_ID);

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collection, filters, options] = mockRunQuery.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingRoutingRules`);
    expect(filters).toEqual([]);
    expect(options).toEqual({
      orderBy: 'priority',
      orderDirection: 'ASCENDING',
      limit: 100,
    });
  });

  it('returns RoutingRuleSummary[] with correct shape', async () => {
    mockRunQuery.mockResolvedValue([
      makeRawRoutingRule({ id: 'rule_1', priority: 10 }),
      makeRawRoutingRule({ id: 'rule_2', priority: 20, name: 'Route Discord' }),
    ]);

    const results = await listRoutingRules(USER_ID);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('rule_1');
    expect(results[0].priority).toBe(10);
    expect(results[1].id).toBe('rule_2');
    expect(results[1].name).toBe('Route Discord');
    expect(results[1].priority).toBe(20);
  });

  it('returns empty array when no rules exist', async () => {
    mockRunQuery.mockResolvedValue([]);

    const results = await listRoutingRules(USER_ID);

    expect(results).toEqual([]);
  });

  it('applies defaults for missing routing rule fields', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'rule_minimal' }]);

    const results = await listRoutingRules(USER_ID);

    expect(results[0].name).toBe('Unnamed');
    expect(results[0].priority).toBe(0);
    expect(results[0].conditions).toEqual([]);
    expect(results[0].target).toEqual({ type: 'hyve', targetId: '' });
    expect(results[0].enabled).toBe(true);
    expect(results[0].connectorId).toBeUndefined();
  });

  it('preserves enabled=false (nullish coalescing)', async () => {
    mockRunQuery.mockResolvedValue([makeRawRoutingRule({ enabled: false })]);

    const results = await listRoutingRules(USER_ID);

    expect(results[0].enabled).toBe(false);
  });
});

// ============================================================================
// createRoutingRule
// ============================================================================

describe('createRoutingRule', () => {
  beforeEach(() => {
    mockCreateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        ...data,
        id: docId,
      })
    );
  });

  it('calls createDocument with correct collection path', async () => {
    await createRoutingRule(USER_ID, {
      name: 'New Rule',
      priority: 5,
      conditions: [],
      target: { type: 'hyve', targetId: 'hyve_lp' },
    });

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [collection] = mockCreateDocument.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingRoutingRules`);
  });

  it('generates rule ID with rule_ prefix', async () => {
    await createRoutingRule(USER_ID, {
      name: 'Test Rule',
      priority: 1,
      conditions: [],
      target: { type: 'hyve', targetId: 'hyve_1' },
    });

    const [, ruleId] = mockCreateDocument.mock.calls[0];
    expect(ruleId).toMatch(/^rule_[a-f0-9]+$/);
  });

  it('creates with correct data fields', async () => {
    const conditions = [
      { type: 'channel' as const, operator: 'equals' as const, value: 'slack' },
    ];
    const target = { type: 'workflow' as const, targetId: 'wf_123', label: 'My Workflow' };

    await createRoutingRule(USER_ID, {
      name: 'Rule X',
      priority: 15,
      conditions,
      target,
      enabled: false,
      connectorId: 'conn_001',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.name).toBe('Rule X');
    expect(data.priority).toBe(15);
    expect(data.conditions).toEqual(conditions);
    expect(data.target).toEqual(target);
    expect(data.enabled).toBe(false);
    expect(data.connectorId).toBe('conn_001');
    expect(typeof data.createdAt).toBe('string');
    expect(typeof data.updatedAt).toBe('string');
    expect(data.createdAt).toBe(data.updatedAt);
  });

  it('defaults enabled to true when not specified', async () => {
    await createRoutingRule(USER_ID, {
      name: 'Default enabled',
      priority: 1,
      conditions: [],
      target: { type: 'hyve', targetId: 'hyve_1' },
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.enabled).toBe(true);
  });

  it('defaults connectorId to null when not specified', async () => {
    await createRoutingRule(USER_ID, {
      name: 'No connector',
      priority: 1,
      conditions: [],
      target: { type: 'hyve', targetId: 'hyve_1' },
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.connectorId).toBeNull();
  });

  it('returns RoutingRuleSummary from result', async () => {
    const result = await createRoutingRule(USER_ID, {
      name: 'Created Rule',
      priority: 10,
      conditions: [{ type: 'channel', operator: 'equals', value: 'discord' }],
      target: { type: 'agent', targetId: 'agent_001' },
    });

    expect(result).toBeDefined();
    expect(result.name).toBe('Created Rule');
    expect(result.priority).toBe(10);
    expect(result.target).toEqual({ type: 'agent', targetId: 'agent_001' });
    expect(result.enabled).toBe(true);
    expect(result.id).toBeDefined();
  });
});

// ============================================================================
// deleteRoutingRule
// ============================================================================

describe('deleteRoutingRule', () => {
  it('calls deleteDocument with correct collection and ID', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteRoutingRule(USER_ID, 'rule_to_delete');

    expect(mockDeleteDocument).toHaveBeenCalledOnce();
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/messagingRoutingRules`,
      'rule_to_delete'
    );
  });

  it('propagates errors from deleteDocument', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(deleteRoutingRule(USER_ID, 'rule_forbidden')).rejects.toThrow('Permission denied');
  });
});

// ============================================================================
// listSessions
// ============================================================================

describe('listSessions', () => {
  it('uses listDocuments when no channel filter is specified', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listSessions(USER_ID);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    const [collection, options] = mockListDocuments.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingSessions`);
    expect(options).toEqual({ pageSize: 50 });
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('uses runQuery when channel filter is specified', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listSessions(USER_ID, { channel: 'discord' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collection, filters, options] = mockRunQuery.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingSessions`);
    expect(filters).toEqual([
      { field: 'channel', op: 'EQUAL', value: 'discord' },
    ]);
    expect(options).toEqual({ limit: 50 });
    expect(mockListDocuments).not.toHaveBeenCalled();
  });

  it('passes custom limit to listDocuments when no channel filter', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listSessions(USER_ID, { limit: 10 });

    const [, options] = mockListDocuments.mock.calls[0];
    expect(options).toEqual({ pageSize: 10 });
  });

  it('passes custom limit to runQuery when channel filter specified', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listSessions(USER_ID, { channel: 'telegram', limit: 25 });

    const [, , options] = mockRunQuery.mock.calls[0];
    expect(options).toEqual({ limit: 25 });
  });

  it('returns SessionSummary[] with correct shape', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [makeRawSession()],
    });

    const results = await listSessions(USER_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      sessionKey: 'slack:T12345:U111:dm',
      channel: 'slack',
      peerId: 'U111',
      peerDisplay: 'Alice',
      conversationKind: 'dm',
      conversationId: 'D001',
      linkedHyveId: 'hyve_lp',
      linkedAgentId: 'agent_001',
      linkedIdentityId: 'ident_001',
      messageCount: 42,
      lastMessageAt: '2025-06-15T08:30:00.000Z',
      createdAt: '2025-06-01T10:00:00.000Z',
    });
  });

  it('uses runQuery results for channel-filtered sessions', async () => {
    mockRunQuery.mockResolvedValue([
      makeRawSession({ id: 'sess_1', channel: 'discord' }),
      makeRawSession({ id: 'sess_2', channel: 'discord' }),
    ]);

    const results = await listSessions(USER_ID, { channel: 'discord' });

    expect(results).toHaveLength(2);
    expect(results[0].sessionKey).toBe('sess_1');
    expect(results[1].sessionKey).toBe('sess_2');
  });

  it('returns empty array when no sessions exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listSessions(USER_ID);

    expect(results).toEqual([]);
  });

  it('applies defaults for missing session fields', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'sess_minimal' }],
    });

    const results = await listSessions(USER_ID);

    expect(results[0].sessionKey).toBe('sess_minimal');
    expect(results[0].channel).toBe('slack');
    expect(results[0].peerId).toBe('');
    expect(results[0].conversationKind).toBe('dm');
    expect(results[0].conversationId).toBe('');
    expect(results[0].messageCount).toBe(0);
    expect(results[0].peerDisplay).toBeUndefined();
    expect(results[0].linkedHyveId).toBeUndefined();
    expect(results[0].linkedAgentId).toBeUndefined();
    expect(results[0].linkedIdentityId).toBeUndefined();
    expect(results[0].lastMessageAt).toBeUndefined();
    expect(results[0].createdAt).toBeUndefined();
  });

  it('prefers doc.id over doc.sessionKey for sessionKey mapping', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'id_value', sessionKey: 'key_value' }],
    });

    const results = await listSessions(USER_ID);

    // toSessionSummary: (doc.id as string) || (doc.sessionKey as string)
    expect(results[0].sessionKey).toBe('id_value');
  });

  it('falls back to doc.sessionKey when doc.id is absent', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ sessionKey: 'key_only_value', channel: 'telegram' }],
    });

    const results = await listSessions(USER_ID);

    expect(results[0].sessionKey).toBe('key_only_value');
  });
});

// ============================================================================
// getSession
// ============================================================================

describe('getSession', () => {
  it('calls getDocument with correct collection and session key', async () => {
    mockGetDocument.mockResolvedValue(makeRawSession());

    await getSession(USER_ID, 'slack:T12345:U111:dm');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/messagingSessions`,
      'slack:T12345:U111:dm'
    );
  });

  it('returns SessionSummary for existing session', async () => {
    mockGetDocument.mockResolvedValue(makeRawSession());

    const result = await getSession(USER_ID, 'slack:T12345:U111:dm');

    expect(result).not.toBeNull();
    expect(result!.sessionKey).toBe('slack:T12345:U111:dm');
    expect(result!.channel).toBe('slack');
    expect(result!.peerId).toBe('U111');
  });

  it('returns null when session does not exist', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getSession(USER_ID, 'nonexistent_key');

    expect(result).toBeNull();
  });
});

// ============================================================================
// listIdentities
// ============================================================================

describe('listIdentities', () => {
  it('calls listDocuments with correct collection path', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listIdentities(USER_ID);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    const [collection, options] = mockListDocuments.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingIdentities`);
    expect(options).toEqual({ pageSize: 100 });
  });

  it('returns IdentitySummary[] with correct shape', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [makeRawIdentity()],
    });

    const results = await listIdentities(USER_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'ident_001',
      displayName: 'Alice Smith',
      linkedPeers: [
        { channel: 'slack', peerId: 'U111', displayName: 'alice.s', linkedAt: '2025-06-01T10:00:00.000Z' },
        { channel: 'discord', peerId: '9876543210', displayName: 'alice#1234', linkedAt: '2025-06-02T10:00:00.000Z' },
      ],
      properties: { role: 'admin', company: 'Acme' },
      managedBy: 'user',
      createdAt: '2025-06-01T10:00:00.000Z',
      updatedAt: '2025-06-15T10:00:00.000Z',
    });
  });

  it('returns empty array when no identities exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listIdentities(USER_ID);

    expect(results).toEqual([]);
  });

  it('applies defaults for missing identity fields', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'ident_minimal' }],
    });

    const results = await listIdentities(USER_ID);

    expect(results[0].displayName).toBe('Unknown');
    expect(results[0].linkedPeers).toEqual([]);
    expect(results[0].properties).toEqual({});
    expect(results[0].managedBy).toBe('user');
  });

  it('handles linkedPeers with missing sub-fields', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{
        id: 'ident_sparse_peers',
        linkedPeers: [
          { channel: 'telegram' },
          {},
        ],
      }],
    });

    const results = await listIdentities(USER_ID);

    expect(results[0].linkedPeers).toHaveLength(2);
    expect(results[0].linkedPeers[0].channel).toBe('telegram');
    expect(results[0].linkedPeers[0].peerId).toBe('');
    expect(results[0].linkedPeers[0].displayName).toBeUndefined();
    expect(results[0].linkedPeers[0].linkedAt).toBeUndefined();
    expect(results[0].linkedPeers[1].channel).toBe('slack'); // default
    expect(results[0].linkedPeers[1].peerId).toBe('');
  });
});

// ============================================================================
// getIdentity
// ============================================================================

describe('getIdentity', () => {
  it('calls getDocument with correct collection and ID', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await getIdentity(USER_ID, 'ident_001');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/messagingIdentities`,
      'ident_001'
    );
  });

  it('returns IdentitySummary for existing identity', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    const result = await getIdentity(USER_ID, 'ident_001');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('ident_001');
    expect(result!.displayName).toBe('Alice Smith');
    expect(result!.linkedPeers).toHaveLength(2);
  });

  it('returns null when identity does not exist', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getIdentity(USER_ID, 'ident_nonexistent');

    expect(result).toBeNull();
  });
});

// ============================================================================
// linkPeerToIdentity
// ============================================================================

describe('linkPeerToIdentity', () => {
  beforeEach(() => {
    mockUpdateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        id: docId,
        displayName: 'Alice Smith',
        managedBy: 'user',
        ...data,
      })
    );
  });

  it('throws if identity not found', async () => {
    mockGetDocument.mockResolvedValue(null);

    await expect(
      linkPeerToIdentity(USER_ID, 'ident_missing', [
        { channel: 'slack', peerId: 'U999' },
      ])
    ).rejects.toThrow('Identity "ident_missing" not found');
  });

  it('calls getDocument with correct collection and ID', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'telegram', peerId: 'T111' },
    ]);

    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${USER_ID}/messagingIdentities`,
      'ident_001'
    );
  });

  it('adds new peers that do not exist yet', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'telegram', peerId: 'T111', displayName: 'alice_tg' },
    ]);

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [collection, docId, data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(collection).toBe(`users/${USER_ID}/messagingIdentities`);
    expect(docId).toBe('ident_001');
    expect(fieldPaths).toEqual(['linkedPeers', 'peerKeys', 'updatedAt']);

    // Should have 3 peers: 2 existing + 1 new
    const peers = data.linkedPeers as Array<Record<string, unknown>>;
    expect(peers).toHaveLength(3);

    // New peer should have linkedAt set
    const newPeer = peers[2];
    expect(newPeer.channel).toBe('telegram');
    expect(newPeer.peerId).toBe('T111');
    expect(newPeer.displayName).toBe('alice_tg');
    expect(typeof newPeer.linkedAt).toBe('string');
  });

  it('deduplicates existing peers (same channel:peerId)', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'slack', peerId: 'U111' }, // Already exists
    ]);

    const [, , data] = mockUpdateDocument.mock.calls[0];
    const peers = data.linkedPeers as Array<Record<string, unknown>>;
    // Should still be 2 (no duplicate added)
    expect(peers).toHaveLength(2);
  });

  it('deduplicates some peers while adding new ones', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'slack', peerId: 'U111' },    // Duplicate - skip
      { channel: 'telegram', peerId: 'T999' },  // New - add
      { channel: 'discord', peerId: '9876543210' }, // Duplicate - skip
    ]);

    const [, , data] = mockUpdateDocument.mock.calls[0];
    const peers = data.linkedPeers as Array<Record<string, unknown>>;
    // 2 existing + 1 new (telegram)
    expect(peers).toHaveLength(3);
    expect(peers[2].channel).toBe('telegram');
    expect(peers[2].peerId).toBe('T999');
  });

  it('builds peerKeys array for Firestore queries', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'whatsapp', peerId: 'W001' },
    ]);

    const [, , data] = mockUpdateDocument.mock.calls[0];
    const peerKeys = data.peerKeys as string[];
    expect(peerKeys).toContain('slack:U111');
    expect(peerKeys).toContain('discord:9876543210');
    expect(peerKeys).toContain('whatsapp:W001');
    expect(peerKeys).toHaveLength(3);
  });

  it('includes updatedAt timestamp', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'signal', peerId: 'S001' },
    ]);

    const [, , data] = mockUpdateDocument.mock.calls[0];
    expect(typeof data.updatedAt).toBe('string');
    const parsed = new Date(data.updatedAt as string);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('handles identity with no existing linkedPeers', async () => {
    mockGetDocument.mockResolvedValue({ id: 'ident_empty', displayName: 'Bob' });

    await linkPeerToIdentity(USER_ID, 'ident_empty', [
      { channel: 'slack', peerId: 'U999' },
    ]);

    const [, , data] = mockUpdateDocument.mock.calls[0];
    const peers = data.linkedPeers as Array<Record<string, unknown>>;
    expect(peers).toHaveLength(1);
    expect(peers[0].channel).toBe('slack');
    expect(peers[0].peerId).toBe('U999');
  });

  it('returns IdentitySummary from result', async () => {
    mockGetDocument.mockResolvedValue(makeRawIdentity());

    const result = await linkPeerToIdentity(USER_ID, 'ident_001', [
      { channel: 'telegram', peerId: 'T001' },
    ]);

    expect(result).toBeDefined();
    expect(result.id).toBe('ident_001');
    expect(result.displayName).toBeDefined();
  });
});

// ============================================================================
// queryDeliveryLogs
// ============================================================================

describe('queryDeliveryLogs', () => {
  it('always includes userId filter', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID);

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collection, filters] = mockRunQuery.mock.calls[0];
    expect(collection).toBe('messaging_delivery_log');
    expect(filters).toEqual([
      { field: 'userId', op: 'EQUAL', value: USER_ID },
    ]);
  });

  it('uses correct ordering and default limit', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID);

    const [, , options] = mockRunQuery.mock.calls[0];
    expect(options).toEqual({
      orderBy: 'timestamp',
      orderDirection: 'DESCENDING',
      limit: 50,
    });
  });

  it('adds direction filter when specified', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID, { direction: 'egress' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toContainEqual(
      { field: 'direction', op: 'EQUAL', value: 'egress' }
    );
  });

  it('adds channel filter when specified', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID, { channel: 'discord' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toContainEqual(
      { field: 'channel', op: 'EQUAL', value: 'discord' }
    );
  });

  it('adds status filter when specified', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID, { status: 'failed' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toContainEqual(
      { field: 'status', op: 'EQUAL', value: 'failed' }
    );
  });

  it('adds since filter with GREATER_THAN_OR_EQUAL', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID, { since: '2025-06-01T00:00:00.000Z' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toContainEqual(
      { field: 'timestamp', op: 'GREATER_THAN_OR_EQUAL', value: '2025-06-01T00:00:00.000Z' }
    );
  });

  it('combines all filter options', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID, {
      direction: 'ingress',
      channel: 'slack',
      status: 'delivered',
      since: '2025-06-10T00:00:00.000Z',
      limit: 25,
    });

    const [, filters, options] = mockRunQuery.mock.calls[0];
    expect(filters).toHaveLength(5); // userId + direction + channel + status + since
    expect(filters[0]).toEqual({ field: 'userId', op: 'EQUAL', value: USER_ID });
    expect(filters[1]).toEqual({ field: 'direction', op: 'EQUAL', value: 'ingress' });
    expect(filters[2]).toEqual({ field: 'channel', op: 'EQUAL', value: 'slack' });
    expect(filters[3]).toEqual({ field: 'status', op: 'EQUAL', value: 'delivered' });
    expect(filters[4]).toEqual({ field: 'timestamp', op: 'GREATER_THAN_OR_EQUAL', value: '2025-06-10T00:00:00.000Z' });
    expect(options.limit).toBe(25);
  });

  it('uses custom limit when specified', async () => {
    mockRunQuery.mockResolvedValue([]);

    await queryDeliveryLogs(USER_ID, { limit: 100 });

    const [, , options] = mockRunQuery.mock.calls[0];
    expect(options.limit).toBe(100);
  });

  it('returns DeliveryLogEntry[] with correct shape', async () => {
    mockRunQuery.mockResolvedValue([makeRawDeliveryLog()]);

    const results = await queryDeliveryLogs(USER_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'log_001',
      direction: 'ingress',
      channel: 'slack',
      correlationId: 'corr_abc',
      peerId: 'U111',
      conversationId: 'D001',
      sessionKey: 'slack:T12345:U111:dm',
      allowed: true,
      dispatched: true,
      dispatchTarget: 'hyve_lp',
      status: 'delivered',
      durationMs: 120,
      timestamp: '2025-06-15T08:30:00.000Z',
    });
  });

  it('returns empty array when no logs found', async () => {
    mockRunQuery.mockResolvedValue([]);

    const results = await queryDeliveryLogs(USER_ID);

    expect(results).toEqual([]);
  });

  it('applies defaults for missing delivery log fields', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'log_minimal' }]);

    const results = await queryDeliveryLogs(USER_ID);

    expect(results[0].direction).toBe('ingress');
    expect(results[0].channel).toBe('slack');
    expect(results[0].correlationId).toBe('');
    expect(results[0].peerId).toBeUndefined();
    expect(results[0].conversationId).toBeUndefined();
    expect(results[0].sessionKey).toBeUndefined();
    expect(results[0].allowed).toBeUndefined();
    expect(results[0].dispatched).toBeUndefined();
    expect(results[0].dispatchTarget).toBeUndefined();
    expect(results[0].status).toBeUndefined();
    expect(results[0].errorCode).toBeUndefined();
    expect(results[0].durationMs).toBeUndefined();
    // timestamp falls back to new Date().toISOString()
    expect(typeof results[0].timestamp).toBe('string');
    expect(new Date(results[0].timestamp).getTime()).not.toBeNaN();
  });

  it('returns multiple log entries', async () => {
    mockRunQuery.mockResolvedValue([
      makeRawDeliveryLog({ id: 'log_1', direction: 'ingress' }),
      makeRawDeliveryLog({ id: 'log_2', direction: 'egress' }),
      makeRawDeliveryLog({ id: 'log_3', direction: 'ingress', status: 'failed', errorCode: 'TIMEOUT' }),
    ]);

    const results = await queryDeliveryLogs(USER_ID);

    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('log_1');
    expect(results[1].id).toBe('log_2');
    expect(results[1].direction).toBe('egress');
    expect(results[2].status).toBe('failed');
    expect(results[2].errorCode).toBe('TIMEOUT');
  });
});

// ============================================================================
// Collection path correctness (cross-cutting)
// ============================================================================

describe('collection paths', () => {
  it('listConnectors uses users/{userId}/messagingConnectors', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    await listConnectors('uid_123');
    expect(mockListDocuments.mock.calls[0][0]).toBe('users/uid_123/messagingConnectors');
  });

  it('getConnector uses users/{userId}/messagingConnectors', async () => {
    mockGetDocument.mockResolvedValue(null);
    await getConnector('uid_123', 'c1');
    expect(mockGetDocument.mock.calls[0][0]).toBe('users/uid_123/messagingConnectors');
  });

  it('getPolicy uses users/{userId}/messagingPolicies', async () => {
    mockGetDocument.mockResolvedValue(makeRawPolicy());
    await getPolicy('uid_123', 'c1');
    expect(mockGetDocument.mock.calls[0][0]).toBe('users/uid_123/messagingPolicies');
  });

  it('updatePolicy uses users/{userId}/messagingPolicies', async () => {
    mockUpdateDocument.mockResolvedValue(makeRawPolicy());
    await updatePolicy('uid_123', 'c1', { dmPolicy: 'open' });
    expect(mockUpdateDocument.mock.calls[0][0]).toBe('users/uid_123/messagingPolicies');
  });

  it('listRoutingRules uses users/{userId}/messagingRoutingRules', async () => {
    mockRunQuery.mockResolvedValue([]);
    await listRoutingRules('uid_123');
    expect(mockRunQuery.mock.calls[0][0]).toBe('users/uid_123/messagingRoutingRules');
  });

  it('createRoutingRule uses users/{userId}/messagingRoutingRules', async () => {
    mockCreateDocument.mockResolvedValue({ id: 'r1' });
    await createRoutingRule('uid_123', {
      name: 'R', priority: 1, conditions: [], target: { type: 'hyve', targetId: 'h1' },
    });
    expect(mockCreateDocument.mock.calls[0][0]).toBe('users/uid_123/messagingRoutingRules');
  });

  it('deleteRoutingRule uses users/{userId}/messagingRoutingRules', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);
    await deleteRoutingRule('uid_123', 'r1');
    expect(mockDeleteDocument.mock.calls[0][0]).toBe('users/uid_123/messagingRoutingRules');
  });

  it('listSessions uses users/{userId}/messagingSessions', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    await listSessions('uid_123');
    expect(mockListDocuments.mock.calls[0][0]).toBe('users/uid_123/messagingSessions');
  });

  it('getSession uses users/{userId}/messagingSessions', async () => {
    mockGetDocument.mockResolvedValue(null);
    await getSession('uid_123', 'key');
    expect(mockGetDocument.mock.calls[0][0]).toBe('users/uid_123/messagingSessions');
  });

  it('listIdentities uses users/{userId}/messagingIdentities', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    await listIdentities('uid_123');
    expect(mockListDocuments.mock.calls[0][0]).toBe('users/uid_123/messagingIdentities');
  });

  it('getIdentity uses users/{userId}/messagingIdentities', async () => {
    mockGetDocument.mockResolvedValue(null);
    await getIdentity('uid_123', 'i1');
    expect(mockGetDocument.mock.calls[0][0]).toBe('users/uid_123/messagingIdentities');
  });

  it('queryDeliveryLogs uses messaging_delivery_log (top-level)', async () => {
    mockRunQuery.mockResolvedValue([]);
    await queryDeliveryLogs('uid_123');
    expect(mockRunQuery.mock.calls[0][0]).toBe('messaging_delivery_log');
  });
});
