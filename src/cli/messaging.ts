/**
 * MyndHyve CLI — Messaging Commands
 *
 * Commander subcommand group for messaging gateway operations:
 *   myndhyve-cli messaging connectors list|status
 *   myndhyve-cli messaging policies get|set
 *   myndhyve-cli messaging routing list|add|remove
 *   myndhyve-cli messaging logs
 *   myndhyve-cli messaging sessions list|inspect
 *   myndhyve-cli messaging identity list|link
 */

import { Command } from 'commander';
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
  getIdentity as _getIdentity,
  linkPeerToIdentity,
  queryDeliveryLogs,
  CLOUD_CHANNELS,
  RELAY_CHANNELS,
  type MessagingChannel,
  type ConnectorDetail,
  type RoutingCondition,
  type RoutingConditionType,
  type RoutingTarget,
  type RoutingTargetType as _RoutingTargetType,
  type DmPolicyType,
  type GroupPolicyType,
  type UpdatePolicyOptions,
} from '../api/messaging.js';
import {
  requireAuth,
  truncate,
  formatRelativeTime,
  printError,
} from './helpers.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerMessagingCommands(program: Command): void {
  const messaging = program
    .command('messaging')
    .description('Manage messaging gateway — connectors, policies, routing, and observability');

  registerConnectorCommands(messaging);
  registerPolicyCommands(messaging);
  registerRoutingCommands(messaging);
  registerLogCommands(messaging);
  registerSessionCommands(messaging);
  registerIdentityCommands(messaging);
}

// ============================================================================
// CONNECTORS
// ============================================================================

function registerConnectorCommands(messaging: Command): void {
  const connectors = messaging
    .command('connectors')
    .description('Manage messaging platform connectors');

  // ── List ──────────────────────────────────────────────────────────────

  connectors
    .command('list')
    .description('List all messaging connectors')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const results = await listConnectors(auth.uid);

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log('\n  No messaging connectors found.');
          console.log('  Set up connectors in the web app at Settings > Messaging.\n');
          return;
        }

        console.log(`\n  Messaging Connectors (${results.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Channel'.padEnd(12) +
            'Account'.padEnd(24) +
            'Status'
        );
        console.log('  ' + '\u2500'.repeat(70));

        for (const conn of results) {
          const status = conn.enabled ? 'enabled' : 'disabled';
          const channelType = isRelayChannel(conn.channel) ? `${conn.channel} (relay)` : conn.channel;

          console.log(
            '  ' +
              conn.id.padEnd(24) +
              channelType.padEnd(12) +
              truncate(conn.platformAccountId, 22).padEnd(24) +
              status
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list connectors', error);
      }
    });

  // ── Status ────────────────────────────────────────────────────────────

  connectors
    .command('status <connector-id>')
    .description('Show detailed connector status')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (connectorId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const connector = await getConnector(auth.uid, connectorId);

        if (!connector) {
          console.error(`\n  Error: Connector "${connectorId}" not found.\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(connector, null, 2));
          return;
        }

        const channelType = isRelayChannel(connector.channel) ? 'relay' : 'cloud';

        console.log(`\n  Connector: ${connectorId}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  Channel:    ${connector.channel} (${channelType})`);
        console.log(`  Account:    ${connector.platformAccountId}`);
        console.log(`  Enabled:    ${connector.enabled ? 'yes' : 'no'}`);
        console.log(`  Secrets:    ${formatSecrets(connector)}`);

        if (connector.sessionConfig) {
          console.log('');
          console.log(`  DM Scope:     ${connector.sessionConfig.defaultDmScope}`);
          console.log(`  Timeout:      ${Math.round(connector.sessionConfig.sessionTimeoutMs / 60000)}m`);
          console.log(`  Max Context:  ${connector.sessionConfig.maxContextEntries} entries`);
          console.log(`  Persist:      ${connector.sessionConfig.persistContext ? 'yes' : 'no'}`);
        }

        if (connector.label) {
          console.log(`  Label:      ${connector.label}`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to get connector status', error);
      }
    });
}

// ============================================================================
// POLICIES
// ============================================================================

function registerPolicyCommands(messaging: Command): void {
  const policies = messaging
    .command('policies')
    .description('Manage connector access policies');

  // ── Get ───────────────────────────────────────────────────────────────

  policies
    .command('get <connector-id>')
    .description('Show the policy for a connector')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (connectorId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const policy = await getPolicy(auth.uid, connectorId);

        if (!policy) {
          console.error(`\n  Error: No policy found for connector "${connectorId}".\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(policy, null, 2));
          return;
        }

        console.log(`\n  Policy for connector: ${connectorId}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  Channel:         ${policy.channel}`);
        console.log(`  DM Policy:       ${policy.dmPolicy}`);
        console.log(`  Group Policy:    ${policy.groupPolicy}`);
        console.log(`  Require Mention: ${policy.requireMention ? 'yes' : 'no'}`);

        if (policy.allowedUsers.length > 0) {
          console.log(`  Allowed Users:   ${policy.allowedUsers.join(', ')}`);
        }

        if (policy.allowedChannels.length > 0) {
          console.log(`  Allowed Channels: ${policy.allowedChannels.join(', ')}`);
        }

        const hyveBindings = Object.entries(policy.channelHyveBindings);
        if (hyveBindings.length > 0) {
          console.log('');
          console.log('  Hyve Bindings:');
          for (const [ch, hyveId] of hyveBindings) {
            console.log(`    ${ch} \u2192 ${hyveId}`);
          }
        }

        const workflowBindings = Object.entries(policy.channelWorkflowBindings);
        if (workflowBindings.length > 0) {
          console.log('');
          console.log('  Workflow Bindings:');
          for (const [ch, workflows] of workflowBindings) {
            console.log(`    ${ch} \u2192 ${workflows.join(', ')}`);
          }
        }

        console.log('');
      } catch (error) {
        printError('Failed to get policy', error);
      }
    });

  // ── Set ───────────────────────────────────────────────────────────────

  policies
    .command('set <connector-id>')
    .description('Update connector policy settings')
    .option('--dm <policy>', 'DM policy (pairing, allowlist, open, disabled)')
    .option('--group <policy>', 'Group policy (allowlist, open, disabled)')
    .option('--mention <bool>', 'Require @mention in groups (true/false)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (connectorId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Validate inputs
      const dmPolicies: DmPolicyType[] = ['pairing', 'allowlist', 'open', 'disabled'];
      const groupPolicies: GroupPolicyType[] = ['allowlist', 'open', 'disabled'];

      if (opts.dm && !dmPolicies.includes(opts.dm)) {
        console.error(`\n  Error: Invalid DM policy "${opts.dm}".`);
        console.error(`  Valid options: ${dmPolicies.join(', ')}\n`);
        process.exitCode = 1;
        return;
      }

      if (opts.group && !groupPolicies.includes(opts.group)) {
        console.error(`\n  Error: Invalid group policy "${opts.group}".`);
        console.error(`  Valid options: ${groupPolicies.join(', ')}\n`);
        process.exitCode = 1;
        return;
      }

      if (!opts.dm && !opts.group && !opts.mention) {
        console.error('\n  Error: No policy changes specified.');
        console.error('  Use --dm, --group, or --mention to update settings.\n');
        process.exitCode = 1;
        return;
      }

      try {
        const updates: UpdatePolicyOptions = {};
        if (opts.dm) updates.dmPolicy = opts.dm;
        if (opts.group) updates.groupPolicy = opts.group;
        if (opts.mention !== undefined) {
          updates.requireMention = opts.mention === 'true';
        }

        const result = await updatePolicy(auth.uid, connectorId, updates);

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log('\n  Policy updated successfully.');
        console.log(`  DM Policy:       ${result.dmPolicy}`);
        console.log(`  Group Policy:    ${result.groupPolicy}`);
        console.log(`  Require Mention: ${result.requireMention ? 'yes' : 'no'}\n`);
      } catch (error) {
        printError('Failed to update policy', error);
      }
    });
}

// ============================================================================
// ROUTING
// ============================================================================

function registerRoutingCommands(messaging: Command): void {
  const routing = messaging
    .command('routing')
    .description('Manage message routing rules');

  // ── List ──────────────────────────────────────────────────────────────

  routing
    .command('list')
    .description('List all routing rules')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const rules = await listRoutingRules(auth.uid);

        if (opts.format === 'json') {
          console.log(JSON.stringify(rules, null, 2));
          return;
        }

        if (rules.length === 0) {
          console.log('\n  No routing rules configured.');
          console.log('  Add one with: myndhyve-cli messaging routing add --name="..." --condition="..." --target="..."\n');
          return;
        }

        console.log(`\n  Routing Rules (${rules.length})\n`);
        console.log(
          '  ' +
            'Pri'.padEnd(6) +
            'Name'.padEnd(24) +
            'Conditions'.padEnd(30) +
            'Target'.padEnd(20) +
            'Status'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const rule of rules) {
          const conditions = rule.conditions
            .map((c) => `${c.type}${c.field ? '.' + c.field : ''}`)
            .join(', ');
          const target = `${rule.target.type}:${truncate(rule.target.targetId, 12)}`;
          const status = rule.enabled ? 'active' : 'disabled';

          console.log(
            '  ' +
              String(rule.priority).padEnd(6) +
              truncate(rule.name, 22).padEnd(24) +
              truncate(conditions || '(none)', 28).padEnd(30) +
              target.padEnd(20) +
              status
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list routing rules', error);
      }
    });

  // ── Add ───────────────────────────────────────────────────────────────

  routing
    .command('add')
    .description('Create a new routing rule')
    .requiredOption('--name <name>', 'Rule name')
    .requiredOption('--condition <condition>', 'Condition (e.g., "channel:equals:slack", "identity-property:tier:equals:vip")')
    .requiredOption('--target <target>', 'Target (e.g., "workflow:my-workflow-id", "hyve:app-builder")')
    .option('--priority <n>', 'Priority (lower = higher priority)', '50')
    .option('--disabled', 'Create the rule in disabled state')
    .option('--connector <id>', 'Limit rule to a specific connector')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Parse condition
      const condition = parseCondition(opts.condition);
      if (!condition) {
        console.error(`\n  Error: Invalid condition format "${opts.condition}".`);
        console.error('  Format: type:operator:value  or  type:field:operator:value');
        console.error('  Examples:');
        console.error('    channel:equals:slack');
        console.error('    identity-property:tier:equals:vip');
        console.error('    conversation-kind:equals:dm\n');
        process.exitCode = 1;
        return;
      }

      // Parse target
      const target = parseTarget(opts.target);
      if (!target) {
        console.error(`\n  Error: Invalid target format "${opts.target}".`);
        console.error('  Format: type:targetId');
        console.error('  Types: hyve, workflow, agent, escalation');
        console.error('  Example: workflow:my-workflow-id\n');
        process.exitCode = 1;
        return;
      }

      try {
        const rule = await createRoutingRule(auth.uid, {
          name: opts.name,
          priority: parseInt(opts.priority, 10),
          conditions: [condition],
          target,
          enabled: !opts.disabled,
          connectorId: opts.connector,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(rule, null, 2));
          return;
        }

        console.log('\n  Routing rule created.');
        console.log(`  ID:       ${rule.id}`);
        console.log(`  Name:     ${rule.name}`);
        console.log(`  Priority: ${rule.priority}`);
        console.log(`  Target:   ${rule.target.type}:${rule.target.targetId}`);
        console.log(`  Status:   ${rule.enabled ? 'active' : 'disabled'}\n`);
      } catch (error) {
        printError('Failed to create routing rule', error);
      }
    });

  // ── Remove ────────────────────────────────────────────────────────────

  routing
    .command('remove <rule-id>')
    .description('Delete a routing rule')
    .option('--force', 'Skip confirmation')
    .action(async (ruleId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`\n  Delete routing rule "${ruleId}"? [y/N] `, resolve);
        });

        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('  Cancelled.\n');
          return;
        }
      }

      try {
        await deleteRoutingRule(auth.uid, ruleId);
        console.log(`\n  Routing rule "${ruleId}" deleted.\n`);
      } catch (error) {
        printError('Failed to delete routing rule', error);
      }
    });
}

// ============================================================================
// LOGS
// ============================================================================

function registerLogCommands(messaging: Command): void {
  messaging
    .command('logs')
    .description('Query messaging delivery logs')
    .option('--since <duration>', 'Time range (e.g., 1h, 30m, 7d)', '1h')
    .option('--status <status>', 'Filter by status (e.g., error, delivered)')
    .option('--channel <channel>', 'Filter by channel')
    .option('--direction <dir>', 'Filter by direction (ingress, egress)')
    .option('--limit <n>', 'Max entries to return', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (opts.channel && !validateChannel(opts.channel)) return;

      try {
        const since = parseDuration(opts.since);

        const logs = await queryDeliveryLogs(auth.uid, {
          since: since ? since.toISOString() : undefined,
          status: opts.status,
          channel: opts.channel,
          direction: opts.direction,
          limit: parseInt(opts.limit, 10),
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(logs, null, 2));
          return;
        }

        if (logs.length === 0) {
          console.log('\n  No delivery logs found for the specified criteria.\n');
          return;
        }

        console.log(`\n  Delivery Logs (${logs.length})\n`);
        console.log(
          '  ' +
            'Time'.padEnd(14) +
            'Dir'.padEnd(10) +
            'Channel'.padEnd(10) +
            'Peer'.padEnd(18) +
            'Status'.padEnd(14) +
            'Target'
        );
        console.log('  ' + '\u2500'.repeat(80));

        for (const entry of logs) {
          const time = formatRelativeTime(entry.timestamp);
          const dir = entry.direction === 'ingress' ? '\u2b07 in' : '\u2b06 out';
          const peer = truncate(entry.peerId || '—', 16);
          const status = entry.status || (entry.allowed === false ? 'blocked' : 'ok');
          const target = entry.dispatchTarget || '—';

          console.log(
            '  ' +
              time.padEnd(14) +
              dir.padEnd(10) +
              entry.channel.padEnd(10) +
              peer.padEnd(18) +
              status.padEnd(14) +
              truncate(target, 20)
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to query delivery logs', error);
      }
    });
}

// ============================================================================
// SESSIONS
// ============================================================================

function registerSessionCommands(messaging: Command): void {
  const sessions = messaging
    .command('sessions')
    .description('View messaging sessions');

  // ── List ──────────────────────────────────────────────────────────────

  sessions
    .command('list')
    .description('List messaging sessions')
    .option('--channel <channel>', 'Filter by channel')
    .option('--limit <n>', 'Max sessions', '25')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (opts.channel && !validateChannel(opts.channel)) return;

      try {
        const results = await listSessions(auth.uid, {
          channel: opts.channel,
          limit: parseInt(opts.limit, 10),
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log('\n  No messaging sessions found.\n');
          return;
        }

        console.log(`\n  Messaging Sessions (${results.length})\n`);
        console.log(
          '  ' +
            'Session Key'.padEnd(30) +
            'Channel'.padEnd(10) +
            'Peer'.padEnd(18) +
            'Messages'.padEnd(10) +
            'Last Activity'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const session of results) {
          const lastActivity = session.lastMessageAt
            ? formatRelativeTime(session.lastMessageAt)
            : '—';

          console.log(
            '  ' +
              truncate(session.sessionKey, 28).padEnd(30) +
              session.channel.padEnd(10) +
              truncate(session.peerDisplay || session.peerId, 16).padEnd(18) +
              String(session.messageCount).padEnd(10) +
              lastActivity
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list sessions', error);
      }
    });

  // ── Inspect ───────────────────────────────────────────────────────────

  sessions
    .command('inspect <session-key>')
    .description('Show detailed session information')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (sessionKey: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const session = await getSession(auth.uid, sessionKey);

        if (!session) {
          console.error(`\n  Error: Session "${sessionKey}" not found.\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(session, null, 2));
          return;
        }

        console.log(`\n  Session: ${session.sessionKey}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  Channel:       ${session.channel}`);
        console.log(`  Peer:          ${session.peerDisplay || session.peerId}`);
        console.log(`  Peer ID:       ${session.peerId}`);
        console.log(`  Conversation:  ${session.conversationKind} (${session.conversationId})`);
        console.log(`  Messages:      ${session.messageCount}`);

        if (session.linkedHyveId) {
          console.log(`  Linked Hyve:   ${session.linkedHyveId}`);
        }
        if (session.linkedAgentId) {
          console.log(`  Linked Agent:  ${session.linkedAgentId}`);
        }
        if (session.linkedIdentityId) {
          console.log(`  Identity:      ${session.linkedIdentityId}`);
        }

        if (session.lastMessageAt) {
          console.log(`  Last Message:  ${formatRelativeTime(session.lastMessageAt)}`);
        }
        if (session.createdAt) {
          console.log(`  Created:       ${formatRelativeTime(session.createdAt)}`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to inspect session', error);
      }
    });
}

// ============================================================================
// IDENTITY
// ============================================================================

function registerIdentityCommands(messaging: Command): void {
  const identity = messaging
    .command('identity')
    .description('Manage cross-channel identity linking');

  // ── List ──────────────────────────────────────────────────────────────

  identity
    .command('list')
    .description('List all messaging identities')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const identities = await listIdentities(auth.uid);

        if (opts.format === 'json') {
          console.log(JSON.stringify(identities, null, 2));
          return;
        }

        if (identities.length === 0) {
          console.log('\n  No messaging identities found.');
          console.log('  Identities are created automatically when users interact across channels.\n');
          return;
        }

        console.log(`\n  Messaging Identities (${identities.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(20) +
            'Linked Peers'.padEnd(30) +
            'Properties'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const id of identities) {
          const peers = id.linkedPeers
            .map((p) => `${p.channel}:${truncate(p.peerId, 10)}`)
            .join(', ');
          const props = Object.entries(id.properties)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');

          console.log(
            '  ' +
              id.id.padEnd(24) +
              truncate(id.displayName, 18).padEnd(20) +
              truncate(peers || '(none)', 28).padEnd(30) +
              truncate(props || '—', 20)
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list identities', error);
      }
    });

  // ── Link ──────────────────────────────────────────────────────────────

  identity
    .command('link <identity-id>')
    .description('Link a platform peer to an identity')
    .requiredOption('--peer <peer...>', 'Peer to link (format: channel:peerId, e.g., slack:U12345)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (identityId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Parse peers
      const peers: Array<{ channel: MessagingChannel; peerId: string }> = [];

      for (const peerStr of opts.peer) {
        const colonIdx = peerStr.indexOf(':');
        if (colonIdx === -1) {
          console.error(`\n  Error: Invalid peer format "${peerStr}". Expected channel:peerId\n`);
          process.exitCode = 1;
          return;
        }

        const channel = peerStr.substring(0, colonIdx);
        const peerId = peerStr.substring(colonIdx + 1);

        if (!validateChannel(channel)) return;

        peers.push({ channel: channel as MessagingChannel, peerId });
      }

      try {
        const result = await linkPeerToIdentity(auth.uid, identityId, peers);

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Peers linked to identity "${result.displayName}".`);
        console.log('  Linked peers:');
        for (const peer of result.linkedPeers) {
          console.log(`    ${peer.channel}:${peer.peerId}${peer.displayName ? ` (${peer.displayName})` : ''}`);
        }
        console.log('');
      } catch (error) {
        printError('Failed to link peer', error);
      }
    });
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

/**
 * Parse a condition string like "channel:equals:slack" or "identity-property:tier:equals:vip".
 */
function parseCondition(input: string): RoutingCondition | null {
  const validTypes: RoutingConditionType[] = [
    'channel', 'peer', 'identity', 'identity-property',
    'conversation-kind', 'intent', 'time-of-day',
  ];
  const validOperators: RoutingCondition['operator'][] = [
    'equals', 'not-equals', 'contains', 'matches', 'in',
  ];

  const parts = input.split(':');

  // Types that have a field: identity-property:field:operator:value
  const fieldTypes: RoutingConditionType[] = ['identity-property'];

  if (parts.length === 4 && fieldTypes.includes(parts[0] as RoutingConditionType)) {
    if (!validTypes.includes(parts[0] as RoutingConditionType)) return null;
    if (!validOperators.includes(parts[2] as RoutingCondition['operator'])) return null;

    return {
      type: parts[0] as RoutingConditionType,
      field: parts[1],
      operator: parts[2] as RoutingCondition['operator'],
      value: parts[3],
    };
  }

  // Simple: type:operator:value
  if (parts.length === 3) {
    if (!validTypes.includes(parts[0] as RoutingConditionType)) return null;
    if (!validOperators.includes(parts[1] as RoutingCondition['operator'])) return null;

    return {
      type: parts[0] as RoutingConditionType,
      operator: parts[1] as RoutingCondition['operator'],
      value: parts[2],
    };
  }

  return null;
}

/**
 * Parse a target string like "workflow:my-workflow-id".
 */
function parseTarget(input: string): RoutingTarget | null {
  const colonIdx = input.indexOf(':');
  if (colonIdx === -1) return null;

  const type = input.substring(0, colonIdx);
  const targetId = input.substring(colonIdx + 1);

  const validTypes = ['hyve', 'workflow', 'agent', 'escalation'];
  if (!validTypes.includes(type) || !targetId) return null;

  return {
    type: type as RoutingTarget['type'],
    targetId,
  };
}

/**
 * Parse a duration string like "1h", "30m", "7d" into a Date.
 */
function parseDuration(input: string): Date | null {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  const now = Date.now();
  switch (unit) {
    case 'm': return new Date(now - amount * 60_000);
    case 'h': return new Date(now - amount * 3_600_000);
    case 'd': return new Date(now - amount * 86_400_000);
    default: return null;
  }
}

/**
 * Format connector secrets presence.
 */
function formatSecrets(connector: ConnectorDetail): string {
  const parts: string[] = [];
  if (connector.hasSigningSecret) parts.push('signing');
  if (connector.hasPublicKey) parts.push('pubkey');
  if (connector.hasSecretToken) parts.push('token');
  return parts.length > 0 ? parts.join(', ') : 'none';
}

/**
 * Check if a channel is a relay (device-bound) channel.
 */
function isRelayChannel(channel: string): boolean {
  return (RELAY_CHANNELS as readonly string[]).includes(channel);
}

/**
 * All valid messaging channels (cloud + relay).
 */
const ALL_CHANNELS: readonly string[] = [...CLOUD_CHANNELS, ...RELAY_CHANNELS];

/**
 * Validate a --channel flag value. Returns true if valid, prints error and sets exitCode if not.
 */
function validateChannel(channel: string): boolean {
  if (!ALL_CHANNELS.includes(channel)) {
    console.error(`\n  Error: Unknown channel "${channel}".`);
    console.error(`  Valid channels: ${ALL_CHANNELS.join(', ')}\n`);
    process.exitCode = 1;
    return false;
  }
  return true;
}
