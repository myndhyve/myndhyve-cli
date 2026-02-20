/**
 * MyndHyve CLI — Messaging API
 *
 * Operations for the messaging gateway via Firestore REST API.
 * Covers connectors, policies, routing rules, sessions, identities,
 * and delivery logs.
 *
 * Firestore collections:
 *   users/{userId}/messagingConnectors/{connectorId}
 *   users/{userId}/messagingPolicies/{policyId}
 *   users/{userId}/messagingRoutingRules/{ruleId}
 *   users/{userId}/messagingSessions/{sessionKey}
 *   users/{userId}/messagingIdentities/{identityId}
 *   messaging_delivery_log/{logId}
 */

import { randomBytes } from 'node:crypto';
import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  runQuery,
  type QueryFilter,
} from './firestore.js';
import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MessagingAPI');

// ============================================================================
// CHANNEL TYPES
// ============================================================================

export type MessagingChannel = 'slack' | 'discord' | 'telegram' | 'whatsapp' | 'signal' | 'imessage';

export const CLOUD_CHANNELS: readonly MessagingChannel[] = ['slack', 'discord', 'telegram'];
export const RELAY_CHANNELS: readonly MessagingChannel[] = ['whatsapp', 'signal', 'imessage'];

// ============================================================================
// CONNECTOR TYPES
// ============================================================================

/** Connector summary for list display. */
export interface ConnectorSummary {
  id: string;
  channel: MessagingChannel;
  platformAccountId: string;
  enabled: boolean;
  label?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Full connector detail. */
export interface ConnectorDetail extends ConnectorSummary {
  userId: string;
  sessionConfig?: SessionConfig;
  hasSigningSecret: boolean;
  hasPublicKey: boolean;
  hasSecretToken: boolean;
}

/** Session configuration for a messaging connector. */
export interface SessionConfig {
  /** How DM sessions are scoped (e.g., one session per peer or per channel+peer). */
  defaultDmScope: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  /** Timeout in milliseconds before a session expires. */
  sessionTimeoutMs: number;
  /** Maximum number of context entries retained in a session. */
  maxContextEntries: number;
  /** Whether session context is persisted to Firestore. */
  persistContext: boolean;
}

// ============================================================================
// POLICY TYPES
// ============================================================================

export type DmPolicyType = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicyType = 'allowlist' | 'open' | 'disabled';

/** Full policy summary for a messaging connector. */
export interface PolicySummary {
  id: string;
  connectorId: string;
  channel: MessagingChannel;
  dmPolicy: DmPolicyType;
  groupPolicy: GroupPolicyType;
  requireMention: boolean;
  allowedUsers: string[];
  allowedChannels: string[];
  channelHyveBindings: Record<string, string>;
  channelWorkflowBindings: Record<string, string[]>;
  createdAt?: string;
  updatedAt?: string;
}

/** Fields that can be updated on a connector policy. */
export interface UpdatePolicyOptions {
  dmPolicy?: DmPolicyType;
  groupPolicy?: GroupPolicyType;
  requireMention?: boolean;
  allowedUsers?: string[];
  allowedChannels?: string[];
}

// ============================================================================
// ROUTING TYPES
// ============================================================================

export type RoutingConditionType =
  | 'channel' | 'peer' | 'identity' | 'identity-property'
  | 'conversation-kind' | 'intent' | 'time-of-day';

export interface RoutingCondition {
  type: RoutingConditionType;
  field?: string;
  operator: 'equals' | 'not-equals' | 'contains' | 'matches' | 'in';
  value: string;
}

export type RoutingTargetType = 'hyve' | 'workflow' | 'agent' | 'escalation';

export interface RoutingTarget {
  type: RoutingTargetType;
  targetId: string;
  label?: string;
}

/** Routing rule summary with conditions and target. */
export interface RoutingRuleSummary {
  id: string;
  name: string;
  priority: number;
  conditions: RoutingCondition[];
  target: RoutingTarget;
  enabled: boolean;
  connectorId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Options for creating a new routing rule. */
export interface CreateRoutingRuleOptions {
  name: string;
  priority: number;
  conditions: RoutingCondition[];
  target: RoutingTarget;
  enabled?: boolean;
  connectorId?: string;
}

// ============================================================================
// SESSION TYPES
// ============================================================================

/** Messaging session summary with peer and activity info. */
export interface SessionSummary {
  sessionKey: string;
  channel: MessagingChannel;
  peerId: string;
  peerDisplay?: string;
  conversationKind: string;
  conversationId: string;
  linkedHyveId?: string;
  linkedAgentId?: string;
  linkedIdentityId?: string;
  messageCount: number;
  lastMessageAt?: string;
  createdAt?: string;
}

// ============================================================================
// IDENTITY TYPES
// ============================================================================

export interface LinkedPeer {
  channel: MessagingChannel;
  peerId: string;
  displayName?: string;
  linkedAt?: string;
}

/** Cross-channel identity with linked peers and properties. */
export interface IdentitySummary {
  id: string;
  displayName: string;
  linkedPeers: LinkedPeer[];
  properties: Record<string, string>;
  managedBy: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// DELIVERY LOG TYPES
// ============================================================================

/** Single delivery log entry for ingress or egress message processing. */
export interface DeliveryLogEntry {
  id: string;
  direction: 'ingress' | 'egress';
  channel: MessagingChannel;
  correlationId: string;
  peerId?: string;
  conversationId?: string;
  sessionKey?: string;
  allowed?: boolean;
  dispatched?: boolean;
  dispatchTarget?: string;
  status?: string;
  errorCode?: string;
  durationMs?: number;
  timestamp: string;
}

/** Options for filtering delivery log queries. */
export interface LogQueryOptions {
  since?: string;
  status?: string;
  channel?: MessagingChannel;
  direction?: 'ingress' | 'egress';
  limit?: number;
}

// ============================================================================
// CONNECTOR OPERATIONS
// ============================================================================

/**
 * List all messaging connectors for a user.
 */
export async function listConnectors(
  userId: string
): Promise<ConnectorSummary[]> {
  const collectionPath = `users/${userId}/messagingConnectors`;

  log.debug('Listing connectors', { userId });

  const { documents } = await listDocuments(collectionPath, { pageSize: 50 });
  return documents.map(toConnectorSummary);
}

/**
 * Get full connector details by ID.
 */
export async function getConnector(
  userId: string,
  connectorId: string
): Promise<ConnectorDetail | null> {
  const collectionPath = `users/${userId}/messagingConnectors`;

  log.debug('Getting connector', { userId, connectorId });

  const doc = await getDocument(collectionPath, connectorId);
  if (!doc) return null;

  return toConnectorDetail(doc, userId);
}

/**
 * Enable a messaging connector.
 */
export async function enableConnector(
  userId: string,
  connectorId: string
): Promise<ConnectorSummary> {
  const collectionPath = `users/${userId}/messagingConnectors`;
  log.debug('Enabling connector', { userId, connectorId });
  const result = await updateDocument(collectionPath, connectorId, {
    enabled: true,
    updatedAt: new Date().toISOString(),
  }, ['enabled', 'updatedAt']);
  return toConnectorSummary(result);
}

/**
 * Disable a messaging connector.
 */
export async function disableConnector(
  userId: string,
  connectorId: string
): Promise<ConnectorSummary> {
  const collectionPath = `users/${userId}/messagingConnectors`;
  log.debug('Disabling connector', { userId, connectorId });
  const result = await updateDocument(collectionPath, connectorId, {
    enabled: false,
    updatedAt: new Date().toISOString(),
  }, ['enabled', 'updatedAt']);
  return toConnectorSummary(result);
}

/**
 * Test result from a connector health check.
 */
export interface ConnectorTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Send a test message through a connector to verify connectivity.
 */
export async function testConnector(
  userId: string,
  connectorId: string
): Promise<ConnectorTestResult> {
  log.debug('Testing connector', { userId, connectorId });
  const client = getAPIClient();
  return client.post<ConnectorTestResult>(
    `/messaging/connectors/${connectorId}/test`
  );
}

// ============================================================================
// POLICY OPERATIONS
// ============================================================================

/**
 * Get the policy for a connector.
 */
export async function getPolicy(
  userId: string,
  connectorId: string
): Promise<PolicySummary | null> {
  const collectionPath = `users/${userId}/messagingPolicies`;

  log.debug('Getting policy', { userId, connectorId });

  // Policies are stored with connectorId as the document ID
  const doc = await getDocument(collectionPath, connectorId);
  if (doc) return toPolicySummary(doc);

  // Fallback: query by connectorId field
  const results = await runQuery(collectionPath, [
    { field: 'connectorId', op: 'EQUAL', value: connectorId },
  ], { limit: 1 });

  if (results.length === 0) return null;
  return toPolicySummary(results[0]);
}

/**
 * Update connector policy fields.
 */
export async function updatePolicy(
  userId: string,
  connectorId: string,
  updates: UpdatePolicyOptions
): Promise<PolicySummary> {
  const collectionPath = `users/${userId}/messagingPolicies`;

  log.debug('Updating policy', { userId, connectorId, updates });

  const data: Record<string, unknown> = {};
  const fieldPaths: string[] = [];

  if (updates.dmPolicy !== undefined) {
    data.dmPolicy = updates.dmPolicy;
    fieldPaths.push('dmPolicy');
  }
  if (updates.groupPolicy !== undefined) {
    data.groupPolicy = updates.groupPolicy;
    fieldPaths.push('groupPolicy');
  }
  if (updates.requireMention !== undefined) {
    data.requireMention = updates.requireMention;
    fieldPaths.push('requireMention');
  }
  if (updates.allowedUsers !== undefined) {
    data.allowedUsers = updates.allowedUsers;
    fieldPaths.push('allowedUsers');
  }
  if (updates.allowedChannels !== undefined) {
    data.allowedChannels = updates.allowedChannels;
    fieldPaths.push('allowedChannels');
  }

  data.updatedAt = new Date().toISOString();
  fieldPaths.push('updatedAt');

  const result = await updateDocument(collectionPath, connectorId, data, fieldPaths);
  return toPolicySummary(result);
}

// ============================================================================
// ROUTING OPERATIONS
// ============================================================================

/**
 * List all routing rules for a user, sorted by priority.
 */
export async function listRoutingRules(
  userId: string
): Promise<RoutingRuleSummary[]> {
  const collectionPath = `users/${userId}/messagingRoutingRules`;

  log.debug('Listing routing rules', { userId });

  const results = await runQuery(collectionPath, [], {
    orderBy: 'priority',
    orderDirection: 'ASCENDING',
    limit: 100,
  });

  return results.map(toRoutingRuleSummary);
}

/**
 * Create a new routing rule.
 */
export async function createRoutingRule(
  userId: string,
  options: CreateRoutingRuleOptions
): Promise<RoutingRuleSummary> {
  const collectionPath = `users/${userId}/messagingRoutingRules`;
  const ruleId = `rule_${randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  log.debug('Creating routing rule', { userId, ruleId, name: options.name });

  const data: Record<string, unknown> = {
    name: options.name,
    priority: options.priority,
    conditions: options.conditions,
    target: options.target,
    enabled: options.enabled ?? true,
    connectorId: options.connectorId || null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await createDocument(collectionPath, ruleId, data);
  return toRoutingRuleSummary(result);
}

/**
 * Delete a routing rule.
 */
export async function deleteRoutingRule(
  userId: string,
  ruleId: string
): Promise<void> {
  const collectionPath = `users/${userId}/messagingRoutingRules`;

  log.debug('Deleting routing rule', { userId, ruleId });
  await deleteDocument(collectionPath, ruleId);
}

// ============================================================================
// SESSION OPERATIONS
// ============================================================================

/**
 * List messaging sessions.
 */
export async function listSessions(
  userId: string,
  options?: { active?: boolean; channel?: MessagingChannel; limit?: number }
): Promise<SessionSummary[]> {
  const collectionPath = `users/${userId}/messagingSessions`;

  log.debug('Listing sessions', { userId, options });

  const filters: QueryFilter[] = [];

  if (options?.channel) {
    filters.push({ field: 'channel', op: 'EQUAL', value: options.channel });
  }

  if (filters.length > 0) {
    const results = await runQuery(collectionPath, filters, {
      limit: options?.limit || 50,
    });
    return results.map(toSessionSummary);
  }

  const { documents } = await listDocuments(collectionPath, {
    pageSize: options?.limit || 50,
  });
  return documents.map(toSessionSummary);
}

/**
 * Get session details by session key.
 */
export async function getSession(
  userId: string,
  sessionKey: string
): Promise<SessionSummary | null> {
  const collectionPath = `users/${userId}/messagingSessions`;

  log.debug('Getting session', { userId, sessionKey });

  const doc = await getDocument(collectionPath, sessionKey);
  if (!doc) return null;

  return toSessionSummary(doc);
}

/**
 * Close and delete a messaging session.
 */
export async function deleteSession(
  userId: string,
  sessionKey: string
): Promise<void> {
  const collectionPath = `users/${userId}/messagingSessions`;
  log.debug('Deleting session', { userId, sessionKey });
  await deleteDocument(collectionPath, sessionKey);
}

// ============================================================================
// IDENTITY OPERATIONS
// ============================================================================

/**
 * List all messaging identities.
 */
export async function listIdentities(
  userId: string
): Promise<IdentitySummary[]> {
  const collectionPath = `users/${userId}/messagingIdentities`;

  log.debug('Listing identities', { userId });

  const { documents } = await listDocuments(collectionPath, { pageSize: 100 });
  return documents.map(toIdentitySummary);
}

/**
 * Get identity details.
 */
export async function getIdentity(
  userId: string,
  identityId: string
): Promise<IdentitySummary | null> {
  const collectionPath = `users/${userId}/messagingIdentities`;

  log.debug('Getting identity', { userId, identityId });

  const doc = await getDocument(collectionPath, identityId);
  if (!doc) return null;

  return toIdentitySummary(doc);
}

/**
 * Link a peer to an existing identity.
 */
export async function linkPeerToIdentity(
  userId: string,
  identityId: string,
  peers: Array<{ channel: MessagingChannel; peerId: string; displayName?: string }>
): Promise<IdentitySummary> {
  const collectionPath = `users/${userId}/messagingIdentities`;

  log.debug('Linking peers to identity', { userId, identityId, peerCount: peers.length });

  // Get current identity
  const doc = await getDocument(collectionPath, identityId);
  if (!doc) {
    throw new Error(`Identity "${identityId}" not found`);
  }

  const existing = (doc.linkedPeers || []) as Array<Record<string, unknown>>;
  const existingKeys = new Set(
    existing.map((p) => `${p.channel}:${p.peerId}`)
  );

  const now = new Date().toISOString();
  const newPeers = peers
    .filter((p) => !existingKeys.has(`${p.channel}:${p.peerId}`))
    .map((p) => ({
      channel: p.channel,
      peerId: p.peerId,
      displayName: p.displayName,
      linkedAt: now,
    }));

  const allPeers = [...existing, ...newPeers];

  // Build peerKeys for Firestore array-contains queries
  const peerKeys = allPeers.map((p) => `${p.channel}:${p.peerId}`);

  const result = await updateDocument(collectionPath, identityId, {
    linkedPeers: allPeers,
    peerKeys,
    updatedAt: now,
  }, ['linkedPeers', 'peerKeys', 'updatedAt']);

  return toIdentitySummary(result);
}

/**
 * Remove peers from an identity's linked peers list.
 */
export async function unlinkPeersFromIdentity(
  userId: string,
  identityId: string,
  peers: Array<{ channel: MessagingChannel; peerId: string }>
): Promise<IdentitySummary> {
  const collectionPath = `users/${userId}/messagingIdentities`;
  log.debug('Unlinking peers from identity', { userId, identityId, peerCount: peers.length });

  const doc = await getDocument(collectionPath, identityId);
  if (!doc) {
    throw new Error(`Identity "${identityId}" not found`);
  }

  const existing = (doc.linkedPeers || []) as Array<Record<string, unknown>>;
  const removeKeys = new Set(peers.map((p) => `${p.channel}:${p.peerId}`));
  const remaining = existing.filter(
    (p) => !removeKeys.has(`${p.channel}:${p.peerId}`)
  );

  const peerKeys = remaining.map((p) => `${p.channel}:${p.peerId}`);
  const now = new Date().toISOString();

  const result = await updateDocument(collectionPath, identityId, {
    linkedPeers: remaining,
    peerKeys,
    updatedAt: now,
  }, ['linkedPeers', 'peerKeys', 'updatedAt']);

  return toIdentitySummary(result);
}

// ============================================================================
// DELIVERY LOG OPERATIONS
// ============================================================================

/**
 * Query delivery logs.
 */
export async function queryDeliveryLogs(
  userId: string,
  options?: LogQueryOptions
): Promise<DeliveryLogEntry[]> {
  const collectionPath = 'messaging_delivery_log';

  log.debug('Querying delivery logs', { userId, options });

  const filters: QueryFilter[] = [
    { field: 'userId', op: 'EQUAL', value: userId },
  ];

  if (options?.direction) {
    filters.push({ field: 'direction', op: 'EQUAL', value: options.direction });
  }

  if (options?.channel) {
    filters.push({ field: 'channel', op: 'EQUAL', value: options.channel });
  }

  if (options?.status) {
    filters.push({ field: 'status', op: 'EQUAL', value: options.status });
  }

  if (options?.since) {
    filters.push({ field: 'timestamp', op: 'GREATER_THAN_OR_EQUAL', value: options.since });
  }

  const results = await runQuery(collectionPath, filters, {
    orderBy: 'timestamp',
    orderDirection: 'DESCENDING',
    limit: options?.limit || 50,
  });

  return results.map(toDeliveryLogEntry);
}

// ============================================================================
// HELPERS — TYPE CONVERTERS
// ============================================================================

function toConnectorSummary(doc: Record<string, unknown>): ConnectorSummary {
  return {
    id: doc.id as string,
    channel: (doc.channel as MessagingChannel) || 'slack',
    platformAccountId: (doc.platformAccountId as string) || '',
    enabled: (doc.enabled as boolean) ?? true,
    label: doc.label as string | undefined,
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toConnectorDetail(doc: Record<string, unknown>, userId: string): ConnectorDetail {
  const summary = toConnectorSummary(doc);
  return {
    ...summary,
    userId,
    sessionConfig: doc.sessionConfig as SessionConfig | undefined,
    hasSigningSecret: Boolean(doc.signingSecret),
    hasPublicKey: Boolean(doc.publicKey),
    hasSecretToken: Boolean(doc.secretToken),
  };
}

function toPolicySummary(doc: Record<string, unknown>): PolicySummary {
  return {
    id: doc.id as string,
    connectorId: (doc.connectorId as string) || '',
    channel: (doc.channel as MessagingChannel) || 'slack',
    dmPolicy: (doc.dmPolicy as DmPolicyType) || 'pairing',
    groupPolicy: (doc.groupPolicy as GroupPolicyType) || 'disabled',
    requireMention: (doc.requireMention as boolean) ?? true,
    allowedUsers: (doc.allowedUsers as string[]) || [],
    allowedChannels: (doc.allowedChannels as string[]) || [],
    channelHyveBindings: (doc.channelHyveBindings as Record<string, string>) || {},
    channelWorkflowBindings: (doc.channelWorkflowBindings as Record<string, string[]>) || {},
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toRoutingRuleSummary(doc: Record<string, unknown>): RoutingRuleSummary {
  return {
    id: doc.id as string,
    name: (doc.name as string) || 'Unnamed',
    priority: (doc.priority as number) || 0,
    conditions: (doc.conditions as RoutingCondition[]) || [],
    target: (doc.target as RoutingTarget) || { type: 'hyve', targetId: '' },
    enabled: (doc.enabled as boolean) ?? true,
    connectorId: doc.connectorId as string | undefined,
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toSessionSummary(doc: Record<string, unknown>): SessionSummary {
  return {
    sessionKey: (doc.id as string) || (doc.sessionKey as string) || '',
    channel: (doc.channel as MessagingChannel) || 'slack',
    peerId: (doc.peerId as string) || '',
    peerDisplay: doc.peerDisplay as string | undefined,
    conversationKind: (doc.conversationKind as string) || 'dm',
    conversationId: (doc.conversationId as string) || '',
    linkedHyveId: doc.linkedHyveId as string | undefined,
    linkedAgentId: doc.linkedAgentId as string | undefined,
    linkedIdentityId: doc.linkedIdentityId as string | undefined,
    messageCount: (doc.messageCount as number) || 0,
    lastMessageAt: doc.lastMessageAt as string | undefined,
    createdAt: doc.createdAt as string | undefined,
  };
}

function toIdentitySummary(doc: Record<string, unknown>): IdentitySummary {
  const rawPeers = (doc.linkedPeers || []) as Array<Record<string, unknown>>;
  const linkedPeers: LinkedPeer[] = rawPeers.map((p) => ({
    channel: (p.channel as MessagingChannel) || 'slack',
    peerId: (p.peerId as string) || '',
    displayName: p.displayName as string | undefined,
    linkedAt: p.linkedAt as string | undefined,
  }));

  return {
    id: doc.id as string,
    displayName: (doc.displayName as string) || 'Unknown',
    linkedPeers,
    properties: (doc.properties as Record<string, string>) || {},
    managedBy: (doc.managedBy as string) || 'user',
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toDeliveryLogEntry(doc: Record<string, unknown>): DeliveryLogEntry {
  return {
    id: doc.id as string,
    direction: (doc.direction as 'ingress' | 'egress') || 'ingress',
    channel: (doc.channel as MessagingChannel) || 'slack',
    correlationId: (doc.correlationId as string) || '',
    peerId: doc.peerId as string | undefined,
    conversationId: doc.conversationId as string | undefined,
    sessionKey: doc.sessionKey as string | undefined,
    allowed: doc.allowed as boolean | undefined,
    dispatched: doc.dispatched as boolean | undefined,
    dispatchTarget: doc.dispatchTarget as string | undefined,
    status: doc.status as string | undefined,
    errorCode: doc.errorCode as string | undefined,
    durationMs: doc.durationMs as number | undefined,
    timestamp: (doc.timestamp as string) || new Date().toISOString(),
  };
}
