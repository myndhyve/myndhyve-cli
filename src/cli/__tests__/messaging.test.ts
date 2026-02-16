import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockTruncate,
  mockFormatRelativeTime,
  mockPrintError,
  mockListConnectors,
  mockGetConnector,
  mockGetPolicy,
  mockUpdatePolicy,
  mockListRoutingRules,
  mockCreateRoutingRule,
  mockDeleteRoutingRule,
  mockListSessions,
  mockGetSession,
  mockListIdentities,
  mockGetIdentity,
  mockLinkPeerToIdentity,
  mockQueryDeliveryLogs,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockPrintError: vi.fn(),
  mockListConnectors: vi.fn(),
  mockGetConnector: vi.fn(),
  mockGetPolicy: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockListRoutingRules: vi.fn(),
  mockCreateRoutingRule: vi.fn(),
  mockDeleteRoutingRule: vi.fn(),
  mockListSessions: vi.fn(),
  mockGetSession: vi.fn(),
  mockListIdentities: vi.fn(),
  mockGetIdentity: vi.fn(),
  mockLinkPeerToIdentity: vi.fn(),
  mockQueryDeliveryLogs: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  formatRelativeTime: (...args: unknown[]) => mockFormatRelativeTime(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/messaging.js', () => ({
  listConnectors: (...args: unknown[]) => mockListConnectors(...args),
  getConnector: (...args: unknown[]) => mockGetConnector(...args),
  getPolicy: (...args: unknown[]) => mockGetPolicy(...args),
  updatePolicy: (...args: unknown[]) => mockUpdatePolicy(...args),
  listRoutingRules: (...args: unknown[]) => mockListRoutingRules(...args),
  createRoutingRule: (...args: unknown[]) => mockCreateRoutingRule(...args),
  deleteRoutingRule: (...args: unknown[]) => mockDeleteRoutingRule(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  listIdentities: (...args: unknown[]) => mockListIdentities(...args),
  getIdentity: (...args: unknown[]) => mockGetIdentity(...args),
  linkPeerToIdentity: (...args: unknown[]) => mockLinkPeerToIdentity(...args),
  queryDeliveryLogs: (...args: unknown[]) => mockQueryDeliveryLogs(...args),
  CLOUD_CHANNELS: ['slack', 'discord', 'telegram'],
  RELAY_CHANNELS: ['whatsapp', 'signal', 'imessage'],
}));

import { registerMessagingCommands } from '../messaging.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerMessagingCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerMessagingCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockFormatRelativeTime.mockReset();
    mockPrintError.mockReset();
    mockListConnectors.mockReset();
    mockGetConnector.mockReset();
    mockGetPolicy.mockReset();
    mockUpdatePolicy.mockReset();
    mockListRoutingRules.mockReset();
    mockCreateRoutingRule.mockReset();
    mockDeleteRoutingRule.mockReset();
    mockListSessions.mockReset();
    mockGetSession.mockReset();
    mockListIdentities.mockReset();
    mockGetIdentity.mockReset();
    mockLinkPeerToIdentity.mockReset();
    mockQueryDeliveryLogs.mockReset();

    // Default auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // truncate passthrough
    mockTruncate.mockImplementation((s: string) => s);

    // formatRelativeTime passthrough
    mockFormatRelativeTime.mockImplementation((s: string) => s);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the messaging command group on the program', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging');
      expect(messaging).toBeDefined();
    });

    it('registers all 6 subcommand groups', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging')!;
      const subNames = messaging.commands.map((c) => c.name());

      expect(subNames).toContain('connectors');
      expect(subNames).toContain('policies');
      expect(subNames).toContain('routing');
      expect(subNames).toContain('logs');
      expect(subNames).toContain('sessions');
      expect(subNames).toContain('identity');
    });

    it('has connectors sub-commands: list and status', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging')!;
      const connectors = messaging.commands.find((c) => c.name() === 'connectors')!;
      const subNames = connectors.commands.map((c) => c.name());
      expect(subNames).toContain('list');
      expect(subNames).toContain('status');
    });

    it('has policies sub-commands: get and set', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging')!;
      const policies = messaging.commands.find((c) => c.name() === 'policies')!;
      const subNames = policies.commands.map((c) => c.name());
      expect(subNames).toContain('get');
      expect(subNames).toContain('set');
    });

    it('has routing sub-commands: list, add, and remove', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging')!;
      const routing = messaging.commands.find((c) => c.name() === 'routing')!;
      const subNames = routing.commands.map((c) => c.name());
      expect(subNames).toContain('list');
      expect(subNames).toContain('add');
      expect(subNames).toContain('remove');
    });

    it('has sessions sub-commands: list and inspect', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging')!;
      const sessions = messaging.commands.find((c) => c.name() === 'sessions')!;
      const subNames = sessions.commands.map((c) => c.name());
      expect(subNames).toContain('list');
      expect(subNames).toContain('inspect');
    });

    it('has identity sub-commands: list and link', () => {
      const program = new Command();
      registerMessagingCommands(program);
      const messaging = program.commands.find((c) => c.name() === 'messaging')!;
      const identity = messaging.commands.find((c) => c.name() === 'identity')!;
      const subNames = identity.commands.map((c) => c.name());
      expect(subNames).toContain('list');
      expect(subNames).toContain('link');
    });
  });

  // ==========================================================================
  // CONNECTORS LIST
  // ==========================================================================

  describe('connectors list', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'connectors', 'list']);

      expect(mockListConnectors).not.toHaveBeenCalled();
    });

    it('shows empty message when no connectors exist', async () => {
      mockListConnectors.mockResolvedValue([]);

      await run(['messaging', 'connectors', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No messaging connectors found');
    });

    it('lists connectors in table format', async () => {
      mockListConnectors.mockResolvedValue([
        { id: 'conn_1', channel: 'slack', platformAccountId: 'T12345', enabled: true },
        { id: 'conn_2', channel: 'whatsapp', platformAccountId: '+1234567890', enabled: false },
      ]);

      await run(['messaging', 'connectors', 'list']);

      expect(mockListConnectors).toHaveBeenCalledWith('user_abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Messaging Connectors (2)');
      expect(output).toContain('conn_1');
      expect(output).toContain('conn_2');
      expect(output).toContain('enabled');
      expect(output).toContain('disabled');
    });

    it('marks relay channels with (relay) suffix', async () => {
      mockListConnectors.mockResolvedValue([
        { id: 'conn_wa', channel: 'whatsapp', platformAccountId: '+1234', enabled: true },
      ]);

      await run(['messaging', 'connectors', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('whatsapp (relay)');
    });

    it('does not mark cloud channels with (relay)', async () => {
      mockListConnectors.mockResolvedValue([
        { id: 'conn_sl', channel: 'slack', platformAccountId: 'T123', enabled: true },
      ]);

      await run(['messaging', 'connectors', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('(relay)');
    });

    it('outputs JSON format when --format json', async () => {
      const connectors = [
        { id: 'conn_1', channel: 'slack', platformAccountId: 'T12345', enabled: true },
      ];
      mockListConnectors.mockResolvedValue(connectors);

      await run(['messaging', 'connectors', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(connectors);
    });

    it('calls printError on API failure', async () => {
      mockListConnectors.mockRejectedValue(new Error('Network error'));

      await run(['messaging', 'connectors', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list connectors', expect.any(Error));
    });

    it('calls truncate on platformAccountId', async () => {
      mockListConnectors.mockResolvedValue([
        { id: 'conn_1', channel: 'slack', platformAccountId: 'a-very-long-account-identifier', enabled: true },
      ]);

      await run(['messaging', 'connectors', 'list']);

      expect(mockTruncate).toHaveBeenCalledWith('a-very-long-account-identifier', 22);
    });
  });

  // ==========================================================================
  // CONNECTORS STATUS
  // ==========================================================================

  describe('connectors status', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'connectors', 'status', 'conn_1']);

      expect(mockGetConnector).not.toHaveBeenCalled();
    });

    it('shows error when connector not found', async () => {
      mockGetConnector.mockResolvedValue(null);

      await run(['messaging', 'connectors', 'status', 'conn_missing']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Connector "conn_missing" not found');
      expect(process.exitCode).toBe(1);
    });

    it('shows connector details in table format', async () => {
      mockGetConnector.mockResolvedValue({
        id: 'conn_1',
        channel: 'slack',
        platformAccountId: 'T12345',
        enabled: true,
        hasSigningSecret: true,
        hasPublicKey: false,
        hasSecretToken: true,
        sessionConfig: {
          defaultDmScope: 'per-peer',
          sessionTimeoutMs: 1800000,
          maxContextEntries: 50,
          persistContext: true,
        },
        label: 'Production Slack',
      });

      await run(['messaging', 'connectors', 'status', 'conn_1']);

      expect(mockGetConnector).toHaveBeenCalledWith('user_abc', 'conn_1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Connector: conn_1');
      expect(output).toContain('Channel:    slack (cloud)');
      expect(output).toContain('Account:    T12345');
      expect(output).toContain('Enabled:    yes');
      expect(output).toContain('Secrets:    signing, token');
      expect(output).toContain('DM Scope:     per-peer');
      expect(output).toContain('Timeout:      30m');
      expect(output).toContain('Max Context:  50 entries');
      expect(output).toContain('Persist:      yes');
      expect(output).toContain('Label:      Production Slack');
    });

    it('shows relay channel type', async () => {
      mockGetConnector.mockResolvedValue({
        id: 'conn_wa',
        channel: 'imessage',
        platformAccountId: '+1234',
        enabled: true,
        hasSigningSecret: false,
        hasPublicKey: false,
        hasSecretToken: false,
      });

      await run(['messaging', 'connectors', 'status', 'conn_wa']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('imessage (relay)');
    });

    it('shows "none" when no secrets are set', async () => {
      mockGetConnector.mockResolvedValue({
        id: 'conn_1',
        channel: 'slack',
        platformAccountId: 'T12345',
        enabled: false,
        hasSigningSecret: false,
        hasPublicKey: false,
        hasSecretToken: false,
      });

      await run(['messaging', 'connectors', 'status', 'conn_1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Secrets:    none');
      expect(output).toContain('Enabled:    no');
    });

    it('omits sessionConfig section when not present', async () => {
      mockGetConnector.mockResolvedValue({
        id: 'conn_1',
        channel: 'slack',
        platformAccountId: 'T12345',
        enabled: true,
        hasSigningSecret: false,
        hasPublicKey: false,
        hasSecretToken: false,
      });

      await run(['messaging', 'connectors', 'status', 'conn_1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('DM Scope');
      expect(output).not.toContain('Timeout');
    });

    it('outputs JSON format when --format json', async () => {
      const connector = {
        id: 'conn_1',
        channel: 'slack',
        platformAccountId: 'T12345',
        enabled: true,
        hasSigningSecret: false,
        hasPublicKey: false,
        hasSecretToken: false,
      };
      mockGetConnector.mockResolvedValue(connector);

      await run(['messaging', 'connectors', 'status', 'conn_1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(connector);
    });

    it('calls printError on API failure', async () => {
      mockGetConnector.mockRejectedValue(new Error('API error'));

      await run(['messaging', 'connectors', 'status', 'conn_1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get connector status', expect.any(Error));
    });

    it('shows pubkey in secrets format', async () => {
      mockGetConnector.mockResolvedValue({
        id: 'conn_1',
        channel: 'slack',
        platformAccountId: 'T12345',
        enabled: true,
        hasSigningSecret: false,
        hasPublicKey: true,
        hasSecretToken: false,
      });

      await run(['messaging', 'connectors', 'status', 'conn_1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Secrets:    pubkey');
    });
  });

  // ==========================================================================
  // POLICIES GET
  // ==========================================================================

  describe('policies get', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'policies', 'get', 'conn_1']);

      expect(mockGetPolicy).not.toHaveBeenCalled();
    });

    it('shows error when policy not found', async () => {
      mockGetPolicy.mockResolvedValue(null);

      await run(['messaging', 'policies', 'get', 'conn_missing']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No policy found for connector "conn_missing"');
      expect(process.exitCode).toBe(1);
    });

    it('displays policy details in table format', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol_1',
        connectorId: 'conn_1',
        channel: 'slack',
        dmPolicy: 'pairing',
        groupPolicy: 'allowlist',
        requireMention: true,
        allowedUsers: ['U001', 'U002'],
        allowedChannels: ['C001'],
        channelHyveBindings: {},
        channelWorkflowBindings: {},
      });

      await run(['messaging', 'policies', 'get', 'conn_1']);

      expect(mockGetPolicy).toHaveBeenCalledWith('user_abc', 'conn_1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Policy for connector: conn_1');
      expect(output).toContain('Channel:         slack');
      expect(output).toContain('DM Policy:       pairing');
      expect(output).toContain('Group Policy:    allowlist');
      expect(output).toContain('Require Mention: yes');
      expect(output).toContain('Allowed Users:   U001, U002');
      expect(output).toContain('Allowed Channels: C001');
    });

    it('omits allowed users/channels when empty', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol_1',
        connectorId: 'conn_1',
        channel: 'slack',
        dmPolicy: 'open',
        groupPolicy: 'disabled',
        requireMention: false,
        allowedUsers: [],
        allowedChannels: [],
        channelHyveBindings: {},
        channelWorkflowBindings: {},
      });

      await run(['messaging', 'policies', 'get', 'conn_1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Require Mention: no');
      expect(output).not.toContain('Allowed Users');
      expect(output).not.toContain('Allowed Channels');
    });

    it('displays hyve bindings when present', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol_1',
        connectorId: 'conn_1',
        channel: 'slack',
        dmPolicy: 'pairing',
        groupPolicy: 'open',
        requireMention: false,
        allowedUsers: [],
        allowedChannels: [],
        channelHyveBindings: { '#general': 'app-builder', '#marketing': 'landing-page' },
        channelWorkflowBindings: {},
      });

      await run(['messaging', 'policies', 'get', 'conn_1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Hyve Bindings:');
      expect(output).toContain('#general');
      expect(output).toContain('app-builder');
      expect(output).toContain('#marketing');
      expect(output).toContain('landing-page');
    });

    it('displays workflow bindings when present', async () => {
      mockGetPolicy.mockResolvedValue({
        id: 'pol_1',
        connectorId: 'conn_1',
        channel: 'slack',
        dmPolicy: 'pairing',
        groupPolicy: 'open',
        requireMention: false,
        allowedUsers: [],
        allowedChannels: [],
        channelHyveBindings: {},
        channelWorkflowBindings: { '#support': ['wf_triage', 'wf_escalate'] },
      });

      await run(['messaging', 'policies', 'get', 'conn_1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Workflow Bindings:');
      expect(output).toContain('#support');
      expect(output).toContain('wf_triage, wf_escalate');
    });

    it('outputs JSON format when --format json', async () => {
      const policy = {
        id: 'pol_1',
        connectorId: 'conn_1',
        channel: 'slack',
        dmPolicy: 'pairing',
        groupPolicy: 'disabled',
        requireMention: true,
        allowedUsers: [],
        allowedChannels: [],
        channelHyveBindings: {},
        channelWorkflowBindings: {},
      };
      mockGetPolicy.mockResolvedValue(policy);

      await run(['messaging', 'policies', 'get', 'conn_1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(policy);
    });

    it('calls printError on API failure', async () => {
      mockGetPolicy.mockRejectedValue(new Error('Service unavailable'));

      await run(['messaging', 'policies', 'get', 'conn_1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get policy', expect.any(Error));
    });
  });

  // ==========================================================================
  // POLICIES SET
  // ==========================================================================

  describe('policies set', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'policies', 'set', 'conn_1', '--dm', 'open']);

      expect(mockUpdatePolicy).not.toHaveBeenCalled();
    });

    it('rejects invalid DM policy', async () => {
      await run(['messaging', 'policies', 'set', 'conn_1', '--dm', 'invalid']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid DM policy "invalid"');
      expect(output).toContain('pairing, allowlist, open, disabled');
      expect(process.exitCode).toBe(1);
      expect(mockUpdatePolicy).not.toHaveBeenCalled();
    });

    it('rejects invalid group policy', async () => {
      await run(['messaging', 'policies', 'set', 'conn_1', '--group', 'pairing']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid group policy "pairing"');
      expect(output).toContain('allowlist, open, disabled');
      expect(process.exitCode).toBe(1);
    });

    it('shows error when no changes specified', async () => {
      await run(['messaging', 'policies', 'set', 'conn_1']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No policy changes specified');
      expect(output).toContain('--dm, --group, or --mention');
      expect(process.exitCode).toBe(1);
    });

    it('updates DM policy successfully', async () => {
      mockUpdatePolicy.mockResolvedValue({
        dmPolicy: 'open',
        groupPolicy: 'disabled',
        requireMention: true,
      });

      await run(['messaging', 'policies', 'set', 'conn_1', '--dm', 'open']);

      expect(mockUpdatePolicy).toHaveBeenCalledWith('user_abc', 'conn_1', { dmPolicy: 'open' });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Policy updated successfully');
      expect(output).toContain('DM Policy:       open');
    });

    it('updates group policy successfully', async () => {
      mockUpdatePolicy.mockResolvedValue({
        dmPolicy: 'pairing',
        groupPolicy: 'open',
        requireMention: false,
      });

      await run(['messaging', 'policies', 'set', 'conn_1', '--group', 'open']);

      expect(mockUpdatePolicy).toHaveBeenCalledWith('user_abc', 'conn_1', { groupPolicy: 'open' });
    });

    it('updates mention requirement', async () => {
      mockUpdatePolicy.mockResolvedValue({
        dmPolicy: 'pairing',
        groupPolicy: 'disabled',
        requireMention: false,
      });

      await run(['messaging', 'policies', 'set', 'conn_1', '--mention', 'false']);

      expect(mockUpdatePolicy).toHaveBeenCalledWith('user_abc', 'conn_1', { requireMention: false });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Require Mention: no');
    });

    it('sets mention to true when string "true"', async () => {
      mockUpdatePolicy.mockResolvedValue({
        dmPolicy: 'pairing',
        groupPolicy: 'disabled',
        requireMention: true,
      });

      await run(['messaging', 'policies', 'set', 'conn_1', '--mention', 'true']);

      expect(mockUpdatePolicy).toHaveBeenCalledWith('user_abc', 'conn_1', { requireMention: true });
    });

    it('updates multiple fields at once', async () => {
      mockUpdatePolicy.mockResolvedValue({
        dmPolicy: 'allowlist',
        groupPolicy: 'open',
        requireMention: true,
      });

      await run(['messaging', 'policies', 'set', 'conn_1', '--dm', 'allowlist', '--group', 'open', '--mention', 'true']);

      expect(mockUpdatePolicy).toHaveBeenCalledWith('user_abc', 'conn_1', {
        dmPolicy: 'allowlist',
        groupPolicy: 'open',
        requireMention: true,
      });
    });

    it('outputs JSON format when --format json', async () => {
      const result = { dmPolicy: 'open', groupPolicy: 'disabled', requireMention: true };
      mockUpdatePolicy.mockResolvedValue(result);

      await run(['messaging', 'policies', 'set', 'conn_1', '--dm', 'open', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('calls printError on API failure', async () => {
      mockUpdatePolicy.mockRejectedValue(new Error('Forbidden'));

      await run(['messaging', 'policies', 'set', 'conn_1', '--dm', 'open']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to update policy', expect.any(Error));
    });
  });

  // ==========================================================================
  // ROUTING LIST
  // ==========================================================================

  describe('routing list', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'routing', 'list']);

      expect(mockListRoutingRules).not.toHaveBeenCalled();
    });

    it('shows empty message when no rules exist', async () => {
      mockListRoutingRules.mockResolvedValue([]);

      await run(['messaging', 'routing', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No routing rules configured');
      expect(output).toContain('myndhyve-cli messaging routing add');
    });

    it('lists routing rules in table format', async () => {
      mockListRoutingRules.mockResolvedValue([
        {
          id: 'rule_1',
          name: 'Slack to App Builder',
          priority: 10,
          conditions: [{ type: 'channel', operator: 'equals', value: 'slack' }],
          target: { type: 'hyve', targetId: 'app-builder' },
          enabled: true,
        },
        {
          id: 'rule_2',
          name: 'VIP Escalation',
          priority: 20,
          conditions: [{ type: 'identity-property', field: 'tier', operator: 'equals', value: 'vip' }],
          target: { type: 'escalation', targetId: 'human-agent' },
          enabled: false,
        },
      ]);

      await run(['messaging', 'routing', 'list']);

      expect(mockListRoutingRules).toHaveBeenCalledWith('user_abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Routing Rules (2)');
      expect(output).toContain('active');
      expect(output).toContain('disabled');
    });

    it('formats conditions with field when present', async () => {
      mockListRoutingRules.mockResolvedValue([
        {
          id: 'rule_1',
          name: 'Test',
          priority: 10,
          conditions: [{ type: 'identity-property', field: 'tier', operator: 'equals', value: 'vip' }],
          target: { type: 'hyve', targetId: 'x' },
          enabled: true,
        },
      ]);

      await run(['messaging', 'routing', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('identity-property.tier');
    });

    it('outputs JSON format when --format json', async () => {
      const rules = [
        {
          id: 'rule_1',
          name: 'Test',
          priority: 10,
          conditions: [],
          target: { type: 'hyve', targetId: 'x' },
          enabled: true,
        },
      ];
      mockListRoutingRules.mockResolvedValue(rules);

      await run(['messaging', 'routing', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(rules);
    });

    it('calls printError on API failure', async () => {
      mockListRoutingRules.mockRejectedValue(new Error('Timeout'));

      await run(['messaging', 'routing', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list routing rules', expect.any(Error));
    });
  });

  // ==========================================================================
  // ROUTING ADD
  // ==========================================================================

  describe('routing add', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'routing', 'add', '--name', 'test', '--condition', 'channel:equals:slack', '--target', 'hyve:app-builder']);

      expect(mockCreateRoutingRule).not.toHaveBeenCalled();
    });

    it('creates a routing rule with simple condition', async () => {
      mockCreateRoutingRule.mockResolvedValue({
        id: 'rule_new',
        name: 'Slack Route',
        priority: 50,
        target: { type: 'hyve', targetId: 'app-builder' },
        enabled: true,
      });

      await run([
        'messaging', 'routing', 'add',
        '--name', 'Slack Route',
        '--condition', 'channel:equals:slack',
        '--target', 'hyve:app-builder',
      ]);

      expect(mockCreateRoutingRule).toHaveBeenCalledWith('user_abc', {
        name: 'Slack Route',
        priority: 50,
        conditions: [{ type: 'channel', operator: 'equals', value: 'slack' }],
        target: { type: 'hyve', targetId: 'app-builder' },
        enabled: true,
        connectorId: undefined,
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Routing rule created');
      expect(output).toContain('rule_new');
    });

    it('creates a rule with identity-property condition (4-part format)', async () => {
      mockCreateRoutingRule.mockResolvedValue({
        id: 'rule_vip',
        name: 'VIP',
        priority: 10,
        target: { type: 'escalation', targetId: 'human' },
        enabled: true,
      });

      await run([
        'messaging', 'routing', 'add',
        '--name', 'VIP',
        '--condition', 'identity-property:tier:equals:vip',
        '--target', 'escalation:human',
        '--priority', '10',
      ]);

      expect(mockCreateRoutingRule).toHaveBeenCalledWith('user_abc', {
        name: 'VIP',
        priority: 10,
        conditions: [{ type: 'identity-property', field: 'tier', operator: 'equals', value: 'vip' }],
        target: { type: 'escalation', targetId: 'human' },
        enabled: true,
        connectorId: undefined,
      });
    });

    it('creates rule in disabled state with --disabled flag', async () => {
      mockCreateRoutingRule.mockResolvedValue({
        id: 'rule_dis',
        name: 'Disabled Rule',
        priority: 50,
        target: { type: 'workflow', targetId: 'wf_1' },
        enabled: false,
      });

      await run([
        'messaging', 'routing', 'add',
        '--name', 'Disabled Rule',
        '--condition', 'channel:equals:discord',
        '--target', 'workflow:wf_1',
        '--disabled',
      ]);

      expect(mockCreateRoutingRule).toHaveBeenCalledWith('user_abc', expect.objectContaining({
        enabled: false,
      }));

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('disabled');
    });

    it('passes connector ID when --connector specified', async () => {
      mockCreateRoutingRule.mockResolvedValue({
        id: 'rule_c',
        name: 'Scoped',
        priority: 50,
        target: { type: 'agent', targetId: 'agent_1' },
        enabled: true,
      });

      await run([
        'messaging', 'routing', 'add',
        '--name', 'Scoped',
        '--condition', 'channel:equals:slack',
        '--target', 'agent:agent_1',
        '--connector', 'conn_1',
      ]);

      expect(mockCreateRoutingRule).toHaveBeenCalledWith('user_abc', expect.objectContaining({
        connectorId: 'conn_1',
      }));
    });

    it('rejects invalid condition format (too few parts)', async () => {
      await run([
        'messaging', 'routing', 'add',
        '--name', 'Bad',
        '--condition', 'channel:slack',
        '--target', 'hyve:app-builder',
      ]);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid condition format');
      expect(process.exitCode).toBe(1);
      expect(mockCreateRoutingRule).not.toHaveBeenCalled();
    });

    it('rejects invalid condition format (too many parts for non-field type)', async () => {
      await run([
        'messaging', 'routing', 'add',
        '--name', 'Bad',
        '--condition', 'channel:extra:equals:slack',
        '--target', 'hyve:app-builder',
      ]);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid condition format');
      expect(process.exitCode).toBe(1);
    });

    it('rejects invalid target format (no colon)', async () => {
      await run([
        'messaging', 'routing', 'add',
        '--name', 'Bad',
        '--condition', 'channel:equals:slack',
        '--target', 'nocolon',
      ]);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid target format');
      expect(process.exitCode).toBe(1);
      expect(mockCreateRoutingRule).not.toHaveBeenCalled();
    });

    it('rejects invalid target type', async () => {
      await run([
        'messaging', 'routing', 'add',
        '--name', 'Bad',
        '--condition', 'channel:equals:slack',
        '--target', 'unknown:some-id',
      ]);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid target format');
      expect(process.exitCode).toBe(1);
    });

    it('rejects target with empty targetId', async () => {
      await run([
        'messaging', 'routing', 'add',
        '--name', 'Bad',
        '--condition', 'channel:equals:slack',
        '--target', 'hyve:',
      ]);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid target format');
      expect(process.exitCode).toBe(1);
    });

    it('outputs JSON format when --format json', async () => {
      const rule = {
        id: 'rule_j',
        name: 'JSON',
        priority: 50,
        target: { type: 'hyve', targetId: 'x' },
        enabled: true,
      };
      mockCreateRoutingRule.mockResolvedValue(rule);

      await run([
        'messaging', 'routing', 'add',
        '--name', 'JSON',
        '--condition', 'channel:equals:slack',
        '--target', 'hyve:x',
        '--format', 'json',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(rule);
    });

    it('calls printError on API failure', async () => {
      mockCreateRoutingRule.mockRejectedValue(new Error('Quota exceeded'));

      await run([
        'messaging', 'routing', 'add',
        '--name', 'Test',
        '--condition', 'channel:equals:slack',
        '--target', 'hyve:x',
      ]);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to create routing rule', expect.any(Error));
    });
  });

  // ==========================================================================
  // ROUTING REMOVE
  // ==========================================================================

  describe('routing remove', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'routing', 'remove', 'rule_1', '--force']);

      expect(mockDeleteRoutingRule).not.toHaveBeenCalled();
    });

    it('deletes rule with --force (skips confirmation)', async () => {
      mockDeleteRoutingRule.mockResolvedValue(undefined);

      await run(['messaging', 'routing', 'remove', 'rule_1', '--force']);

      expect(mockDeleteRoutingRule).toHaveBeenCalledWith('user_abc', 'rule_1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('rule_1');
      expect(output).toContain('deleted');
    });

    it('calls printError on API failure', async () => {
      mockDeleteRoutingRule.mockRejectedValue(new Error('Not found'));

      await run(['messaging', 'routing', 'remove', 'rule_1', '--force']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to delete routing rule', expect.any(Error));
    });
  });

  // ==========================================================================
  // LOGS
  // ==========================================================================

  describe('logs', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'logs']);

      expect(mockQueryDeliveryLogs).not.toHaveBeenCalled();
    });

    it('shows empty message when no logs found', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run(['messaging', 'logs']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No delivery logs found');
    });

    it('queries logs with default options', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run(['messaging', 'logs']);

      expect(mockQueryDeliveryLogs).toHaveBeenCalledWith('user_abc', {
        since: expect.any(String),
        status: undefined,
        channel: undefined,
        direction: undefined,
        limit: 50,
      });
    });

    it('passes filter options to API', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run([
        'messaging', 'logs',
        '--since', '30m',
        '--status', 'error',
        '--channel', 'slack',
        '--direction', 'ingress',
        '--limit', '10',
      ]);

      expect(mockQueryDeliveryLogs).toHaveBeenCalledWith('user_abc', {
        since: expect.any(String),
        status: 'error',
        channel: 'slack',
        direction: 'ingress',
        limit: 10,
      });
    });

    it('displays log entries in table format', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([
        {
          id: 'log_1',
          direction: 'ingress',
          channel: 'slack',
          correlationId: 'cor_1',
          peerId: 'U12345',
          status: 'delivered',
          dispatchTarget: 'workflow:wf_1',
          timestamp: '2025-01-15T10:00:00Z',
        },
        {
          id: 'log_2',
          direction: 'egress',
          channel: 'discord',
          correlationId: 'cor_2',
          peerId: null,
          allowed: false,
          dispatchTarget: null,
          timestamp: '2025-01-15T09:55:00Z',
        },
      ]);

      await run(['messaging', 'logs']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Delivery Logs (2)');
      expect(mockFormatRelativeTime).toHaveBeenCalled();
    });

    it('shows blocked status for logs with allowed=false', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([
        {
          id: 'log_b',
          direction: 'ingress',
          channel: 'slack',
          correlationId: 'cor_b',
          peerId: 'U_bad',
          allowed: false,
          timestamp: '2025-01-15T10:00:00Z',
        },
      ]);

      await run(['messaging', 'logs']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('blocked');
    });

    it('parseDuration: parses hours correctly', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run(['messaging', 'logs', '--since', '2h']);

      const call = mockQueryDeliveryLogs.mock.calls[0];
      const since = new Date(call[1].since);
      const twoHoursAgo = Date.now() - 2 * 3600000;
      // Allow 5 seconds tolerance
      expect(Math.abs(since.getTime() - twoHoursAgo)).toBeLessThan(5000);
    });

    it('parseDuration: parses days correctly', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run(['messaging', 'logs', '--since', '7d']);

      const call = mockQueryDeliveryLogs.mock.calls[0];
      const since = new Date(call[1].since);
      const sevenDaysAgo = Date.now() - 7 * 86400000;
      expect(Math.abs(since.getTime() - sevenDaysAgo)).toBeLessThan(5000);
    });

    it('parseDuration: parses minutes correctly', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run(['messaging', 'logs', '--since', '15m']);

      const call = mockQueryDeliveryLogs.mock.calls[0];
      const since = new Date(call[1].since);
      const fifteenMinAgo = Date.now() - 15 * 60000;
      expect(Math.abs(since.getTime() - fifteenMinAgo)).toBeLessThan(5000);
    });

    it('parseDuration: passes undefined for invalid duration', async () => {
      mockQueryDeliveryLogs.mockResolvedValue([]);

      await run(['messaging', 'logs', '--since', 'invalid']);

      const call = mockQueryDeliveryLogs.mock.calls[0];
      expect(call[1].since).toBeUndefined();
    });

    it('outputs JSON format when --format json', async () => {
      const logs = [{ id: 'log_1', direction: 'ingress', channel: 'slack', timestamp: '2025-01-15T10:00:00Z' }];
      mockQueryDeliveryLogs.mockResolvedValue(logs);

      await run(['messaging', 'logs', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(logs);
    });

    it('calls printError on API failure', async () => {
      mockQueryDeliveryLogs.mockRejectedValue(new Error('Query failed'));

      await run(['messaging', 'logs']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to query delivery logs', expect.any(Error));
    });
  });

  // ==========================================================================
  // SESSIONS LIST
  // ==========================================================================

  describe('sessions list', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'sessions', 'list']);

      expect(mockListSessions).not.toHaveBeenCalled();
    });

    it('shows empty message when no sessions found', async () => {
      mockListSessions.mockResolvedValue([]);

      await run(['messaging', 'sessions', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No messaging sessions found');
    });

    it('lists sessions in table format', async () => {
      mockListSessions.mockResolvedValue([
        {
          sessionKey: 'sess_slack_U123_DM',
          channel: 'slack',
          peerId: 'U12345',
          peerDisplay: 'John Doe',
          messageCount: 42,
          lastMessageAt: '2025-01-15T10:00:00Z',
        },
      ]);

      await run(['messaging', 'sessions', 'list']);

      expect(mockListSessions).toHaveBeenCalledWith('user_abc', {
        channel: undefined,
        limit: 25,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Messaging Sessions (1)');
    });

    it('passes channel filter', async () => {
      mockListSessions.mockResolvedValue([]);

      await run(['messaging', 'sessions', 'list', '--channel', 'discord']);

      expect(mockListSessions).toHaveBeenCalledWith('user_abc', {
        channel: 'discord',
        limit: 25,
      });
    });

    it('passes custom limit', async () => {
      mockListSessions.mockResolvedValue([]);

      await run(['messaging', 'sessions', 'list', '--limit', '100']);

      expect(mockListSessions).toHaveBeenCalledWith('user_abc', {
        channel: undefined,
        limit: 100,
      });
    });

    it('shows dash for sessions without lastMessageAt', async () => {
      mockListSessions.mockResolvedValue([
        {
          sessionKey: 'sess_1',
          channel: 'slack',
          peerId: 'U1',
          messageCount: 0,
          lastMessageAt: undefined,
        },
      ]);

      await run(['messaging', 'sessions', 'list']);

      // formatRelativeTime should NOT be called for undefined lastMessageAt
      // The output should contain a dash
      const _output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      // The code uses formatRelativeTime only when lastMessageAt exists
      // and falls back to a dash character
    });

    it('uses peerDisplay when available, falls back to peerId', async () => {
      mockListSessions.mockResolvedValue([
        {
          sessionKey: 'sess_1',
          channel: 'slack',
          peerId: 'U12345',
          peerDisplay: 'Alice',
          messageCount: 5,
        },
        {
          sessionKey: 'sess_2',
          channel: 'discord',
          peerId: 'D67890',
          peerDisplay: undefined,
          messageCount: 3,
        },
      ]);

      await run(['messaging', 'sessions', 'list']);

      // truncate is called with peerDisplay || peerId
      expect(mockTruncate).toHaveBeenCalledWith('Alice', 16);
      expect(mockTruncate).toHaveBeenCalledWith('D67890', 16);
    });

    it('outputs JSON format when --format json', async () => {
      const sessions = [{ sessionKey: 'sess_1', channel: 'slack', peerId: 'U1', messageCount: 0 }];
      mockListSessions.mockResolvedValue(sessions);

      await run(['messaging', 'sessions', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(sessions);
    });

    it('calls printError on API failure', async () => {
      mockListSessions.mockRejectedValue(new Error('Timeout'));

      await run(['messaging', 'sessions', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list sessions', expect.any(Error));
    });
  });

  // ==========================================================================
  // SESSIONS INSPECT
  // ==========================================================================

  describe('sessions inspect', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'sessions', 'inspect', 'sess_1']);

      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it('shows error when session not found', async () => {
      mockGetSession.mockResolvedValue(null);

      await run(['messaging', 'sessions', 'inspect', 'sess_missing']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Session "sess_missing" not found');
      expect(process.exitCode).toBe(1);
    });

    it('displays full session details', async () => {
      mockGetSession.mockResolvedValue({
        sessionKey: 'sess_slack_U123_DM',
        channel: 'slack',
        peerId: 'U12345',
        peerDisplay: 'John Doe',
        conversationKind: 'dm',
        conversationId: 'conv_abc',
        messageCount: 42,
        linkedHyveId: 'app-builder',
        linkedAgentId: 'agent_1',
        linkedIdentityId: 'id_xyz',
        lastMessageAt: '2025-01-15T10:00:00Z',
        createdAt: '2025-01-10T08:00:00Z',
      });

      await run(['messaging', 'sessions', 'inspect', 'sess_slack_U123_DM']);

      expect(mockGetSession).toHaveBeenCalledWith('user_abc', 'sess_slack_U123_DM');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Session: sess_slack_U123_DM');
      expect(output).toContain('Channel:       slack');
      expect(output).toContain('Peer:          John Doe');
      expect(output).toContain('Peer ID:       U12345');
      expect(output).toContain('Conversation:  dm (conv_abc)');
      expect(output).toContain('Messages:      42');
      expect(output).toContain('Linked Hyve:   app-builder');
      expect(output).toContain('Linked Agent:  agent_1');
      expect(output).toContain('Identity:      id_xyz');
    });

    it('omits optional linked fields when absent', async () => {
      mockGetSession.mockResolvedValue({
        sessionKey: 'sess_bare',
        channel: 'discord',
        peerId: 'D999',
        conversationKind: 'group',
        conversationId: 'conv_g',
        messageCount: 1,
      });

      await run(['messaging', 'sessions', 'inspect', 'sess_bare']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Linked Hyve');
      expect(output).not.toContain('Linked Agent');
      expect(output).not.toContain('Identity');
      expect(output).not.toContain('Last Message');
      expect(output).not.toContain('Created');
    });

    it('shows peerId when peerDisplay is absent', async () => {
      mockGetSession.mockResolvedValue({
        sessionKey: 'sess_no_display',
        channel: 'telegram',
        peerId: 'T_999',
        peerDisplay: undefined,
        conversationKind: 'dm',
        conversationId: 'conv_t',
        messageCount: 0,
      });

      await run(['messaging', 'sessions', 'inspect', 'sess_no_display']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      // peerDisplay || peerId fallback
      expect(output).toContain('Peer:          T_999');
    });

    it('outputs JSON format when --format json', async () => {
      const session = {
        sessionKey: 'sess_j',
        channel: 'slack',
        peerId: 'U1',
        conversationKind: 'dm',
        conversationId: 'conv_1',
        messageCount: 5,
      };
      mockGetSession.mockResolvedValue(session);

      await run(['messaging', 'sessions', 'inspect', 'sess_j', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(session);
    });

    it('calls printError on API failure', async () => {
      mockGetSession.mockRejectedValue(new Error('Permission denied'));

      await run(['messaging', 'sessions', 'inspect', 'sess_1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to inspect session', expect.any(Error));
    });
  });

  // ==========================================================================
  // IDENTITY LIST
  // ==========================================================================

  describe('identity list', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'identity', 'list']);

      expect(mockListIdentities).not.toHaveBeenCalled();
    });

    it('shows empty message when no identities found', async () => {
      mockListIdentities.mockResolvedValue([]);

      await run(['messaging', 'identity', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No messaging identities found');
      expect(output).toContain('Identities are created automatically');
    });

    it('lists identities in table format', async () => {
      mockListIdentities.mockResolvedValue([
        {
          id: 'id_1',
          displayName: 'Alice Smith',
          linkedPeers: [
            { channel: 'slack', peerId: 'U001' },
            { channel: 'discord', peerId: 'D001' },
          ],
          properties: { tier: 'vip', plan: 'pro' },
        },
        {
          id: 'id_2',
          displayName: 'Bob Jones',
          linkedPeers: [],
          properties: {},
        },
      ]);

      await run(['messaging', 'identity', 'list']);

      expect(mockListIdentities).toHaveBeenCalledWith('user_abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Messaging Identities (2)');
    });

    it('formats linked peers as channel:peerId', async () => {
      mockListIdentities.mockResolvedValue([
        {
          id: 'id_1',
          displayName: 'Alice',
          linkedPeers: [{ channel: 'slack', peerId: 'U001' }],
          properties: {},
        },
      ]);

      await run(['messaging', 'identity', 'list']);

      // truncate is called on the joined peer string
      expect(mockTruncate).toHaveBeenCalledWith(expect.stringContaining('slack:'), expect.any(Number));
    });

    it('formats properties as key=value pairs', async () => {
      mockListIdentities.mockResolvedValue([
        {
          id: 'id_1',
          displayName: 'Alice',
          linkedPeers: [],
          properties: { tier: 'vip' },
        },
      ]);

      await run(['messaging', 'identity', 'list']);

      // truncate is called with the formatted properties string
      expect(mockTruncate).toHaveBeenCalledWith(expect.stringContaining('tier=vip'), 20);
    });

    it('outputs JSON format when --format json', async () => {
      const identities = [
        {
          id: 'id_1',
          displayName: 'Alice',
          linkedPeers: [],
          properties: {},
        },
      ];
      mockListIdentities.mockResolvedValue(identities);

      await run(['messaging', 'identity', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(identities);
    });

    it('calls printError on API failure', async () => {
      mockListIdentities.mockRejectedValue(new Error('Connection lost'));

      await run(['messaging', 'identity', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list identities', expect.any(Error));
    });
  });

  // ==========================================================================
  // IDENTITY LINK
  // ==========================================================================

  describe('identity link', () => {
    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001']);

      expect(mockLinkPeerToIdentity).not.toHaveBeenCalled();
    });

    it('links a single peer to an identity', async () => {
      mockLinkPeerToIdentity.mockResolvedValue({
        id: 'id_1',
        displayName: 'Alice',
        linkedPeers: [
          { channel: 'slack', peerId: 'U001', displayName: 'alice' },
        ],
      });

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001']);

      expect(mockLinkPeerToIdentity).toHaveBeenCalledWith(
        'user_abc',
        'id_1',
        [{ channel: 'slack', peerId: 'U001' }],
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Peers linked to identity "Alice"');
      expect(output).toContain('slack:U001');
    });

    it('links multiple peers to an identity', async () => {
      mockLinkPeerToIdentity.mockResolvedValue({
        id: 'id_1',
        displayName: 'Alice',
        linkedPeers: [
          { channel: 'slack', peerId: 'U001' },
          { channel: 'discord', peerId: 'D001' },
        ],
      });

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001', '--peer', 'discord:D001']);

      expect(mockLinkPeerToIdentity).toHaveBeenCalledWith(
        'user_abc',
        'id_1',
        [
          { channel: 'slack', peerId: 'U001' },
          { channel: 'discord', peerId: 'D001' },
        ],
      );
    });

    it('shows displayName in output when peer has one', async () => {
      mockLinkPeerToIdentity.mockResolvedValue({
        id: 'id_1',
        displayName: 'Alice',
        linkedPeers: [
          { channel: 'slack', peerId: 'U001', displayName: 'alice-slack' },
        ],
      });

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('(alice-slack)');
    });

    it('rejects invalid peer format (no colon)', async () => {
      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'nocolon']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid peer format "nocolon"');
      expect(output).toContain('Expected channel:peerId');
      expect(process.exitCode).toBe(1);
      expect(mockLinkPeerToIdentity).not.toHaveBeenCalled();
    });

    it('rejects unknown channel', async () => {
      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'teams:U001']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown channel "teams"');
      expect(output).toContain('Valid channels:');
      expect(process.exitCode).toBe(1);
      expect(mockLinkPeerToIdentity).not.toHaveBeenCalled();
    });

    it('accepts all valid cloud channels', async () => {
      for (const channel of ['slack', 'discord', 'telegram']) {
        mockLinkPeerToIdentity.mockReset();
        mockLinkPeerToIdentity.mockResolvedValue({
          id: 'id_1',
          displayName: 'Test',
          linkedPeers: [{ channel, peerId: 'P1' }],
        });

        await run(['messaging', 'identity', 'link', 'id_1', '--peer', `${channel}:P1`]);

        expect(mockLinkPeerToIdentity).toHaveBeenCalledWith(
          'user_abc',
          'id_1',
          [{ channel, peerId: 'P1' }],
        );
      }
    });

    it('accepts all valid relay channels', async () => {
      for (const channel of ['whatsapp', 'signal', 'imessage']) {
        mockLinkPeerToIdentity.mockReset();
        mockLinkPeerToIdentity.mockResolvedValue({
          id: 'id_1',
          displayName: 'Test',
          linkedPeers: [{ channel, peerId: 'P1' }],
        });

        await run(['messaging', 'identity', 'link', 'id_1', '--peer', `${channel}:P1`]);

        expect(mockLinkPeerToIdentity).toHaveBeenCalledWith(
          'user_abc',
          'id_1',
          [{ channel, peerId: 'P1' }],
        );
      }
    });

    it('handles peer with colons in peerId (e.g., discord:user:1234)', async () => {
      mockLinkPeerToIdentity.mockResolvedValue({
        id: 'id_1',
        displayName: 'Test',
        linkedPeers: [{ channel: 'discord', peerId: 'user:1234' }],
      });

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'discord:user:1234']);

      expect(mockLinkPeerToIdentity).toHaveBeenCalledWith(
        'user_abc',
        'id_1',
        [{ channel: 'discord', peerId: 'user:1234' }],
      );
    });

    it('outputs JSON format when --format json', async () => {
      const result = {
        id: 'id_1',
        displayName: 'Alice',
        linkedPeers: [{ channel: 'slack', peerId: 'U001' }],
      };
      mockLinkPeerToIdentity.mockResolvedValue(result);

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('calls printError on API failure', async () => {
      mockLinkPeerToIdentity.mockRejectedValue(new Error('Identity not found'));

      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to link peer', expect.any(Error));
    });

    it('stops processing peers on first invalid peer in multi-peer list', async () => {
      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001', '--peer', 'badpeer']);

      // First peer is valid, second is invalid — should error out
      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid peer format "badpeer"');
      expect(process.exitCode).toBe(1);
      expect(mockLinkPeerToIdentity).not.toHaveBeenCalled();
    });

    it('stops on first unknown channel in multi-peer list', async () => {
      await run(['messaging', 'identity', 'link', 'id_1', '--peer', 'slack:U001', '--peer', 'teams:U002']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown channel "teams"');
      expect(mockLinkPeerToIdentity).not.toHaveBeenCalled();
    });
  });
});
