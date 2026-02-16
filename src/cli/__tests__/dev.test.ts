import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRunDoctorChecks,
  mockCreateTestEnvelope,
  mockValidateEnvelope,
  mockGenerateWebhookEvent,
  mockGetAvailableEventTypes,
  mockLoadConfig,
  mockSaveConfig,
  mockGetConfigPath,
  mockGetCliDir,
  mockLoadCredentials,
  mockGetCredentialsPath,
  mockGetActiveContext,
  mockPrintError,
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockRelayConfigSchemaParse,
} = vi.hoisted(() => ({
  mockRunDoctorChecks: vi.fn(),
  mockCreateTestEnvelope: vi.fn(),
  mockValidateEnvelope: vi.fn(),
  mockGenerateWebhookEvent: vi.fn(),
  mockGetAvailableEventTypes: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetConfigPath: vi.fn(),
  mockGetCliDir: vi.fn(),
  mockLoadCredentials: vi.fn(),
  mockGetCredentialsPath: vi.fn(),
  mockGetActiveContext: vi.fn(),
  mockPrintError: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRelayConfigSchemaParse: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../dev/doctor.js', () => ({
  runDoctorChecks: (...args: unknown[]) => mockRunDoctorChecks(...args),
}));

vi.mock('../../dev/envelope.js', () => ({
  createTestEnvelope: (...args: unknown[]) => mockCreateTestEnvelope(...args),
  validateEnvelope: (...args: unknown[]) => mockValidateEnvelope(...args),
}));

vi.mock('../../dev/webhook.js', () => ({
  generateWebhookEvent: (...args: unknown[]) => mockGenerateWebhookEvent(...args),
  getAvailableEventTypes: (...args: unknown[]) => mockGetAvailableEventTypes(...args),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  getConfigPath: (...args: unknown[]) => mockGetConfigPath(...args),
  getCliDir: (...args: unknown[]) => mockGetCliDir(...args),
}));

vi.mock('../../config/types.js', () => ({
  RelayConfigSchema: {
    parse: (...args: unknown[]) => mockRelayConfigSchemaParse(...args),
  },
}));

vi.mock('../../auth/credentials.js', () => ({
  loadCredentials: (...args: unknown[]) => mockLoadCredentials(...args),
  getCredentialsPath: (...args: unknown[]) => mockGetCredentialsPath(...args),
}));

vi.mock('../../context.js', () => ({
  getActiveContext: (...args: unknown[]) => mockGetActiveContext(...args),
}));

vi.mock('../helpers.js', () => ({
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

import { registerDevCommands } from '../dev.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerDevCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Mock fetch ─────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let mockFetch: MockInstance;

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerDevCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;

  beforeEach(() => {
    mockRunDoctorChecks.mockReset();
    mockCreateTestEnvelope.mockReset();
    mockValidateEnvelope.mockReset();
    mockGenerateWebhookEvent.mockReset();
    mockGetAvailableEventTypes.mockReset();
    mockLoadConfig.mockReset();
    mockSaveConfig.mockReset();
    mockGetConfigPath.mockReset();
    mockGetCliDir.mockReset();
    mockLoadCredentials.mockReset();
    mockGetCredentialsPath.mockReset();
    mockGetActiveContext.mockReset();
    mockPrintError.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockRelayConfigSchemaParse.mockReset();

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;

    mockFetch = vi.fn() as unknown as MockInstance;
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    globalThis.fetch = originalFetch;
    process.exitCode = undefined;
  });

  // ==========================================================================
  // REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the dev command group on the program', () => {
      const program = new Command();
      registerDevCommands(program);
      const dev = program.commands.find((c) => c.name() === 'dev');
      expect(dev).toBeDefined();
    });

    it('registers all 5 subcommand groups', () => {
      const program = new Command();
      registerDevCommands(program);
      const dev = program.commands.find((c) => c.name() === 'dev')!;
      const subNames = dev.commands.map((c) => c.name());

      expect(subNames).toContain('doctor');
      expect(subNames).toContain('ping');
      expect(subNames).toContain('envelope');
      expect(subNames).toContain('webhook');
      expect(subNames).toContain('config');
    });

    it('has envelope sub-commands: create and validate', () => {
      const program = new Command();
      registerDevCommands(program);
      const dev = program.commands.find((c) => c.name() === 'dev')!;
      const envelope = dev.commands.find((c) => c.name() === 'envelope')!;
      const subNames = envelope.commands.map((c) => c.name());
      expect(subNames).toContain('create');
      expect(subNames).toContain('validate');
    });

    it('has webhook sub-commands: test and events', () => {
      const program = new Command();
      registerDevCommands(program);
      const dev = program.commands.find((c) => c.name() === 'dev')!;
      const webhook = dev.commands.find((c) => c.name() === 'webhook')!;
      const subNames = webhook.commands.map((c) => c.name());
      expect(subNames).toContain('test');
      expect(subNames).toContain('events');
    });

    it('has config sub-commands: export, import, and validate', () => {
      const program = new Command();
      registerDevCommands(program);
      const dev = program.commands.find((c) => c.name() === 'dev')!;
      const config = dev.commands.find((c) => c.name() === 'config')!;
      const subNames = config.commands.map((c) => c.name());
      expect(subNames).toContain('export');
      expect(subNames).toContain('import');
      expect(subNames).toContain('validate');
    });
  });

  // ==========================================================================
  // DOCTOR
  // ==========================================================================

  describe('dev doctor', () => {
    it('runs doctor checks and prints results in table format', async () => {
      mockRunDoctorChecks.mockResolvedValue({
        version: '1.0.0',
        checks: [
          { name: 'Node.js version', ok: true, message: 'v20.0.0 (>= 18 required)' },
          { name: 'Configuration', ok: true, message: 'Valid' },
        ],
        passed: 2,
        failed: 0,
      });

      await run(['dev', 'doctor']);

      expect(mockRunDoctorChecks).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MyndHyve CLI Doctor (v1.0.0)');
      expect(output).toContain('Node.js version');
      expect(output).toContain('2 passed, 0 failed');
    });

    it('outputs JSON when --format=json', async () => {
      const report = {
        version: '1.0.0',
        checks: [
          { name: 'Node.js version', ok: true, message: 'v20.0.0' },
        ],
        passed: 1,
        failed: 0,
      };
      mockRunDoctorChecks.mockResolvedValue(report);

      await run(['dev', 'doctor', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(report);
    });

    it('sets exitCode=1 when checks fail', async () => {
      mockRunDoctorChecks.mockResolvedValue({
        version: '1.0.0',
        checks: [
          { name: 'Auth', ok: false, message: 'Not authenticated', fix: 'Run auth login' },
        ],
        passed: 0,
        failed: 1,
      });

      await run(['dev', 'doctor']);

      expect(process.exitCode).toBe(1);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('0 passed, 1 failed');
    });

    it('shows fix hint for failed checks', async () => {
      mockRunDoctorChecks.mockResolvedValue({
        version: '1.0.0',
        checks: [
          { name: 'Auth', ok: false, message: 'Not authenticated', fix: 'Run auth login' },
        ],
        passed: 0,
        failed: 1,
      });

      await run(['dev', 'doctor']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Fix: Run auth login');
    });

    it('does not set exitCode when all checks pass', async () => {
      mockRunDoctorChecks.mockResolvedValue({
        version: '1.0.0',
        checks: [{ name: 'Test', ok: true, message: 'OK' }],
        passed: 1,
        failed: 0,
      });

      await run(['dev', 'doctor']);

      expect(process.exitCode).toBeUndefined();
    });

    it('handles thrown errors gracefully', async () => {
      mockRunDoctorChecks.mockRejectedValue(new Error('System failure'));

      await run(['dev', 'doctor']);

      expect(mockPrintError).toHaveBeenCalledWith('Doctor check failed', expect.any(Error));
    });
  });

  // ==========================================================================
  // PING
  // ==========================================================================

  describe('dev ping', () => {
    it('successful ping shows latency in table format', async () => {
      (mockFetch as MockInstance).mockResolvedValue({
        status: 200,
      });

      await run(['dev', 'ping']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Ping:');
      expect(output).toContain('us-central1-myndhyve.cloudfunctions.net');
      expect(output).toContain('Status: 200');
      expect(output).toContain('Reachable');
    });

    it('successful ping with --format=json outputs JSON', async () => {
      (mockFetch as MockInstance).mockResolvedValue({
        status: 200,
      });

      await run(['dev', 'ping', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.reachable).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(typeof result.latencyMs).toBe('number');
      expect(result.url).toContain('us-central1-myndhyve.cloudfunctions.net');
    });

    it('failed ping shows error and sets exitCode=1 in table format', async () => {
      (mockFetch as MockInstance).mockRejectedValue(new Error('ECONNREFUSED'));

      await run(['dev', 'ping']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Unreachable');
      expect(errOutput).toContain('ECONNREFUSED');
      expect(process.exitCode).toBe(1);
    });

    it('failed ping with --format=json outputs error JSON and sets exitCode', async () => {
      (mockFetch as MockInstance).mockRejectedValue(new Error('Timeout'));

      await run(['dev', 'ping', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.reachable).toBe(false);
      expect(result.error).toBe('Timeout');
      expect(process.exitCode).toBe(1);
    });

    it('uses HEAD method and AbortSignal timeout', async () => {
      (mockFetch as MockInstance).mockResolvedValue({ status: 200 });

      await run(['dev', 'ping']);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://us-central1-myndhyve.cloudfunctions.net',
        expect.objectContaining({ method: 'HEAD' }),
      );
    });
  });

  // ==========================================================================
  // ENVELOPE CREATE
  // ==========================================================================

  describe('dev envelope create', () => {
    it('creates envelope with required --channel', async () => {
      const envelope = { channel: 'whatsapp', text: 'Hello from CLI test' };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run(['dev', 'envelope', 'create', '--channel', 'whatsapp']);

      expect(mockCreateTestEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'whatsapp',
          text: 'Hello from CLI test',
        }),
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(envelope);
    });

    it('creates envelope with custom --text', async () => {
      const envelope = { channel: 'signal', text: 'Custom message' };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run(['dev', 'envelope', 'create', '--channel', 'signal', '--text', 'Custom message']);

      expect(mockCreateTestEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'signal',
          text: 'Custom message',
        }),
      );
    });

    it('creates envelope with --peer and --conversation', async () => {
      const envelope = { channel: 'whatsapp', peerId: 'peer-123', conversationId: 'conv-456' };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run([
        'dev', 'envelope', 'create',
        '--channel', 'whatsapp',
        '--peer', 'peer-123',
        '--conversation', 'conv-456',
      ]);

      expect(mockCreateTestEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          peerId: 'peer-123',
          conversationId: 'conv-456',
        }),
      );
    });

    it('creates envelope with --group flag', async () => {
      const envelope = { channel: 'signal', isGroup: true };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run(['dev', 'envelope', 'create', '--channel', 'signal', '--group']);

      expect(mockCreateTestEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          isGroup: true,
        }),
      );
    });

    it('creates envelope with --group-name (implies --group)', async () => {
      const envelope = { channel: 'imessage', isGroup: true, groupName: 'Team Chat' };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run(['dev', 'envelope', 'create', '--channel', 'imessage', '--group-name', 'Team Chat']);

      expect(mockCreateTestEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          isGroup: true,
          groupName: 'Team Chat',
        }),
      );
    });

    it('rejects invalid channel', async () => {
      await run(['dev', 'envelope', 'create', '--channel', 'telegram']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Unknown channel "telegram"');
      expect(errOutput).toContain('whatsapp, signal, imessage');
      expect(process.exitCode).toBe(1);
      expect(mockCreateTestEnvelope).not.toHaveBeenCalled();
    });

    it('supports --format=compact (single line JSON)', async () => {
      const envelope = { channel: 'whatsapp', text: 'test' };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run(['dev', 'envelope', 'create', '--channel', 'whatsapp', '--format', 'compact']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('');
      // compact means no indentation
      expect(output).toBe(JSON.stringify(envelope));
      expect(output).not.toContain('\n');
    });

    it('outputs pretty JSON by default', async () => {
      const envelope = { channel: 'whatsapp', text: 'test' };
      mockCreateTestEnvelope.mockReturnValue(envelope);

      await run(['dev', 'envelope', 'create', '--channel', 'whatsapp']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toBe(JSON.stringify(envelope, null, 2));
    });
  });

  // ==========================================================================
  // ENVELOPE VALIDATE
  // ==========================================================================

  describe('dev envelope validate', () => {
    it('validates a valid ingress envelope file', async () => {
      const validData = { channel: 'whatsapp', peerId: 'p1', text: 'hello', isGroup: false };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(validData));
      mockValidateEnvelope.mockReturnValue({
        valid: true,
        envelopeType: 'ingress',
        errors: [],
      });

      await run(['dev', 'envelope', 'validate', '/tmp/envelope.json']);

      expect(mockExistsSync).toHaveBeenCalledWith('/tmp/envelope.json');
      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/envelope.json', 'utf-8');
      expect(mockValidateEnvelope).toHaveBeenCalledWith(validData);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Valid ingress envelope');
    });

    it('reports errors for invalid envelope', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ bad: true }));
      mockValidateEnvelope.mockReturnValue({
        valid: false,
        envelopeType: 'ingress',
        errors: ['channel: Required', 'peerId: Required'],
      });

      await run(['dev', 'envelope', 'validate', '/tmp/bad.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Invalid envelope');
      expect(errOutput).toContain('ingress');
      expect(process.exitCode).toBe(1);
    });

    it('shows individual error bullets for invalid envelope', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));
      mockValidateEnvelope.mockReturnValue({
        valid: false,
        envelopeType: 'ingress',
        errors: ['channel: Required', 'text: Required'],
      });

      await run(['dev', 'envelope', 'validate', '/tmp/bad.json']);

      const allErrOutput = consoleErrSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allErrOutput).toContain('channel: Required');
      expect(allErrOutput).toContain('text: Required');
    });

    it('validates with --format=json', async () => {
      const result = { valid: true, envelopeType: 'egress', errors: [] };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ channel: 'signal' }));
      mockValidateEnvelope.mockReturnValue(result);

      await run(['dev', 'envelope', 'validate', '/tmp/egress.json', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(result);
    });

    it('sets exitCode=1 for invalid envelope with --format=json', async () => {
      const result = { valid: false, envelopeType: 'ingress', errors: ['channel: Required'] };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));
      mockValidateEnvelope.mockReturnValue(result);

      await run(['dev', 'envelope', 'validate', '/tmp/bad.json', '--format', 'json']);

      expect(process.exitCode).toBe(1);
    });

    it('errors when file not found', async () => {
      mockExistsSync.mockReturnValue(false);

      await run(['dev', 'envelope', 'validate', '/tmp/missing.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('File not found');
      expect(errOutput).toContain('/tmp/missing.json');
      expect(process.exitCode).toBe(1);
      expect(mockValidateEnvelope).not.toHaveBeenCalled();
    });

    it('errors when file contains invalid JSON', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json {{{');

      await run(['dev', 'envelope', 'validate', '/tmp/broken.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Invalid JSON');
      expect(errOutput).toContain('/tmp/broken.json');
      expect(process.exitCode).toBe(1);
      expect(mockValidateEnvelope).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // WEBHOOK TEST
  // ==========================================================================

  describe('dev webhook test', () => {
    it('generates WhatsApp message event', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message', 'typing']);
      const event = {
        channel: 'whatsapp',
        eventType: 'message',
        payload: { object: 'whatsapp_business_account' },
        headers: {},
        description: 'WhatsApp message event',
      };
      mockGenerateWebhookEvent.mockReturnValue(event);

      await run(['dev', 'webhook', 'test', 'whatsapp']);

      expect(mockGetAvailableEventTypes).toHaveBeenCalledWith('whatsapp');
      expect(mockGenerateWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'whatsapp',
          eventType: 'message',
          text: 'Hello from webhook test',
        }),
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(event);
    });

    it('generates Signal message event', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message', 'typing', 'read-receipt']);
      const event = { channel: 'signal', eventType: 'message', payload: {}, headers: {}, description: 'Signal message' };
      mockGenerateWebhookEvent.mockReturnValue(event);

      await run(['dev', 'webhook', 'test', 'signal']);

      expect(mockGenerateWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'signal' }),
      );
    });

    it('generates iMessage message event', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message', 'typing', 'read-receipt']);
      const event = { channel: 'imessage', eventType: 'message', payload: {}, headers: {}, description: 'iMessage message' };
      mockGenerateWebhookEvent.mockReturnValue(event);

      await run(['dev', 'webhook', 'test', 'imessage']);

      expect(mockGenerateWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'imessage' }),
      );
    });

    it('rejects invalid channel', async () => {
      await run(['dev', 'webhook', 'test', 'telegram']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Unknown channel "telegram"');
      expect(errOutput).toContain('whatsapp, signal, imessage');
      expect(process.exitCode).toBe(1);
      expect(mockGenerateWebhookEvent).not.toHaveBeenCalled();
    });

    it('rejects invalid event type', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message', 'typing']);

      await run(['dev', 'webhook', 'test', 'whatsapp', '--event', 'group-join-invalid']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Event type "group-join-invalid" not available');
      expect(errOutput).toContain('message, typing');
      expect(process.exitCode).toBe(1);
      expect(mockGenerateWebhookEvent).not.toHaveBeenCalled();
    });

    it('uses custom --text and --sender', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      mockGenerateWebhookEvent.mockReturnValue({
        channel: 'whatsapp',
        eventType: 'message',
        payload: {},
        headers: {},
        description: 'test',
      });

      await run([
        'dev', 'webhook', 'test', 'whatsapp',
        '--text', 'Custom text',
        '--sender', '+1234567890',
      ]);

      expect(mockGenerateWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Custom text',
          senderId: '+1234567890',
        }),
      );
    });

    it('uses --payload flag to load from file', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      const customPayload = { custom: 'data', nested: { key: 'value' } };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(customPayload));

      await run(['dev', 'webhook', 'test', 'whatsapp', '--payload', '/tmp/payload.json']);

      expect(mockExistsSync).toHaveBeenCalledWith('/tmp/payload.json');
      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/payload.json', 'utf-8');
      // When payload is provided, generateWebhookEvent should NOT be called
      expect(mockGenerateWebhookEvent).not.toHaveBeenCalled();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.channel).toBe('whatsapp');
      expect(parsed.payload).toEqual(customPayload);
      expect(parsed.source).toBe('/tmp/payload.json');
    });

    it('handles --payload with @ prefix', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      const customPayload = { key: 'value' };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(customPayload));

      await run(['dev', 'webhook', 'test', 'whatsapp', '--payload', '@/tmp/payload.json']);

      // The @ is stripped, so existsSync should be called with path without @
      expect(mockExistsSync).toHaveBeenCalledWith('/tmp/payload.json');
    });

    it('handles missing payload file', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      mockExistsSync.mockReturnValue(false);

      await run(['dev', 'webhook', 'test', 'whatsapp', '--payload', '/tmp/missing.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Payload file not found');
      expect(process.exitCode).toBe(1);
      expect(mockGenerateWebhookEvent).not.toHaveBeenCalled();
    });

    it('handles invalid JSON payload file', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json');

      await run(['dev', 'webhook', 'test', 'whatsapp', '--payload', '/tmp/bad.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Invalid JSON in payload file');
      expect(process.exitCode).toBe(1);
      expect(mockGenerateWebhookEvent).not.toHaveBeenCalled();
    });

    it('supports --format=compact', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      const event = { channel: 'signal', eventType: 'message', payload: {}, headers: {}, description: 'test' };
      mockGenerateWebhookEvent.mockReturnValue(event);

      await run(['dev', 'webhook', 'test', 'signal', '--format', 'compact']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toBe(JSON.stringify(event));
    });

    it('passes group options to generateWebhookEvent', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      mockGenerateWebhookEvent.mockReturnValue({
        channel: 'whatsapp',
        eventType: 'message',
        payload: {},
        headers: {},
        description: 'group event',
      });

      await run([
        'dev', 'webhook', 'test', 'whatsapp',
        '--group',
        '--group-name', 'My Group',
      ]);

      expect(mockGenerateWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          isGroup: true,
          groupName: 'My Group',
        }),
      );
    });

    it('--group-name implies --group', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message']);
      mockGenerateWebhookEvent.mockReturnValue({
        channel: 'signal',
        eventType: 'message',
        payload: {},
        headers: {},
        description: 'test',
      });

      await run(['dev', 'webhook', 'test', 'signal', '--group-name', 'Team']);

      expect(mockGenerateWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          isGroup: true,
          groupName: 'Team',
        }),
      );
    });
  });

  // ==========================================================================
  // WEBHOOK EVENTS
  // ==========================================================================

  describe('dev webhook events', () => {
    it('lists WhatsApp event types', async () => {
      mockGetAvailableEventTypes.mockReturnValue([
        'message', 'message-status', 'group-join', 'group-leave', 'typing', 'read-receipt',
      ]);

      await run(['dev', 'webhook', 'events', 'whatsapp']);

      expect(mockGetAvailableEventTypes).toHaveBeenCalledWith('whatsapp');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Webhook event types for whatsapp');
      expect(output).toContain('message');
      expect(output).toContain('typing');
    });

    it('lists Signal event types', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message', 'typing', 'read-receipt']);

      await run(['dev', 'webhook', 'events', 'signal']);

      expect(mockGetAvailableEventTypes).toHaveBeenCalledWith('signal');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Webhook event types for signal');
    });

    it('lists iMessage event types', async () => {
      mockGetAvailableEventTypes.mockReturnValue(['message', 'typing', 'read-receipt']);

      await run(['dev', 'webhook', 'events', 'imessage']);

      expect(mockGetAvailableEventTypes).toHaveBeenCalledWith('imessage');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Webhook event types for imessage');
    });

    it('rejects invalid channel', async () => {
      await run(['dev', 'webhook', 'events', 'sms']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Unknown channel "sms"');
      expect(process.exitCode).toBe(1);
      expect(mockGetAvailableEventTypes).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CONFIG EXPORT
  // ==========================================================================

  describe('dev config export', () => {
    it('exports config to stdout', async () => {
      const config = {
        server: { baseUrl: 'https://example.com' },
        channel: 'whatsapp',
      };
      mockLoadConfig.mockReturnValue(config);
      mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'export']);

      expect(mockLoadConfig).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const exported = JSON.parse(output);
      expect(exported.config).toEqual(config);
      expect(exported._meta.cliDir).toBe('/home/user/.myndhyve-cli');
      expect(exported._meta.exportedAt).toBeDefined();
      expect(exported.credentials).toBeUndefined();
    });

    it('includes credentials when --include-credentials is set', async () => {
      const config = { server: { baseUrl: 'https://example.com' } };
      const credentials = { idToken: 'tok123', email: 'test@test.com' };
      mockLoadConfig.mockReturnValue(config);
      mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
      mockGetActiveContext.mockReturnValue(null);
      mockLoadCredentials.mockReturnValue(credentials);

      await run(['dev', 'config', 'export', '--include-credentials']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const exported = JSON.parse(output);
      expect(exported.credentials).toEqual(credentials);
    });

    it('does not include credentials when loadCredentials returns null', async () => {
      mockLoadConfig.mockReturnValue({});
      mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
      mockGetActiveContext.mockReturnValue(null);
      mockLoadCredentials.mockReturnValue(null);

      await run(['dev', 'config', 'export', '--include-credentials']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const exported = JSON.parse(output);
      expect(exported.credentials).toBeUndefined();
    });

    it('includes active context when present', async () => {
      mockLoadConfig.mockReturnValue({});
      mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
      mockGetActiveContext.mockReturnValue({
        projectId: 'proj-1',
        projectName: 'My Project',
        hyveId: 'app-builder',
      });

      await run(['dev', 'config', 'export']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const exported = JSON.parse(output);
      expect(exported.context).toEqual({
        projectId: 'proj-1',
        projectName: 'My Project',
        hyveId: 'app-builder',
      });
    });

    it('does not include context when no active context', async () => {
      mockLoadConfig.mockReturnValue({});
      mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'export']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const exported = JSON.parse(output);
      expect(exported.context).toBeUndefined();
    });
  });

  // ==========================================================================
  // CONFIG IMPORT
  // ==========================================================================

  describe('dev config import', () => {
    it('imports a valid config file', async () => {
      const exportData = {
        config: { server: { baseUrl: 'https://example.com' } },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(exportData));
      const parsedConfig = { server: { baseUrl: 'https://example.com' } };
      mockRelayConfigSchemaParse.mockReturnValue(parsedConfig);

      await run(['dev', 'config', 'import', '/tmp/export.json']);

      expect(mockExistsSync).toHaveBeenCalledWith('/tmp/export.json');
      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/export.json', 'utf-8');
      expect(mockRelayConfigSchemaParse).toHaveBeenCalledWith(exportData.config);
      expect(mockSaveConfig).toHaveBeenCalledWith(parsedConfig);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Configuration imported successfully');
    });

    it('restores context from export', async () => {
      const exportData = {
        config: { server: { baseUrl: 'https://example.com' } },
        context: { projectId: 'proj-1', projectName: 'Test', hyveId: 'app-builder' },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(exportData));
      mockRelayConfigSchemaParse.mockReturnValue(exportData.config);
      mockGetCliDir.mockReturnValue('/home/user/.myndhyve-cli');

      await run(['dev', 'config', 'import', '/tmp/export.json']);

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/home/user/.myndhyve-cli/context.json',
        JSON.stringify(exportData.context, null, 2),
        { mode: 0o600 },
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Active context restored');
    });

    it('does not write context file when context is absent', async () => {
      const exportData = {
        config: { server: { baseUrl: 'https://example.com' } },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(exportData));
      mockRelayConfigSchemaParse.mockReturnValue(exportData.config);

      await run(['dev', 'config', 'import', '/tmp/export.json']);

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('errors when file not found', async () => {
      mockExistsSync.mockReturnValue(false);

      await run(['dev', 'config', 'import', '/tmp/missing.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('File not found');
      expect(errOutput).toContain('/tmp/missing.json');
      expect(process.exitCode).toBe(1);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('errors when file contains invalid JSON', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{{broken');

      await run(['dev', 'config', 'import', '/tmp/broken.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Invalid JSON');
      expect(process.exitCode).toBe(1);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('errors when config section is missing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ _meta: {} }));

      await run(['dev', 'config', 'import', '/tmp/noconfig.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('missing "config" section');
      expect(process.exitCode).toBe(1);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('errors when config validation fails', async () => {
      const exportData = {
        config: { server: { baseUrl: 'not-a-url' } },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(exportData));
      mockRelayConfigSchemaParse.mockImplementation(() => {
        throw new Error('Invalid url');
      });

      await run(['dev', 'config', 'import', '/tmp/bad-config.json']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Invalid configuration');
      expect(errOutput).toContain('Invalid url');
      expect(process.exitCode).toBe(1);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CONFIG VALIDATE
  // ==========================================================================

  describe('dev config validate', () => {
    it('validates all config files successfully', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      // Config file exists and is valid
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('credentials.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ server: {} }));
      mockRelayConfigSchemaParse.mockReturnValue({ server: {} });
      mockLoadCredentials.mockReturnValue({ idToken: 'tok', email: 'a@b.com' });
      mockGetActiveContext.mockReturnValue({
        projectId: 'proj-1',
        projectName: 'My Project',
      });

      await run(['dev', 'config', 'validate']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Configuration Validation');
      expect(output).toContain('config.json');
      expect(output).toContain('credentials.json');
      expect(output).toContain('context.json');
      expect(process.exitCode).toBeUndefined();
    });

    it('reports missing config files', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');
      mockExistsSync.mockReturnValue(false);
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('config.json');
      expect(output).toContain('missing');
      expect(output).toContain('using defaults');
      expect(output).toContain('credentials.json');
      expect(output).toContain('context.json');
      expect(output).toContain('No active project');
    });

    it('reports invalid config files and sets exitCode=1', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        if (path.includes('credentials.json')) return true;
        return false;
      });
      // Config file has invalid JSON
      mockReadFileSync.mockReturnValue('{{invalid');
      // loadCredentials returns null for corrupt file
      mockLoadCredentials.mockReturnValue(null);
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate']);

      // config.json parse will throw from JSON.parse inside the action
      const allOutput = [...consoleSpy.mock.calls, ...consoleErrSpy.mock.calls]
        .map((c) => String(c[0]))
        .join('\n');
      expect(allOutput).toContain('invalid');
      expect(process.exitCode).toBe(1);
    });

    it('reports invalid credentials file', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return false;
        if (path.includes('credentials.json')) return true;
        return false;
      });
      mockLoadCredentials.mockReturnValue(null);
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('credentials.json');
      expect(output).toContain('Corrupt or invalid');
      expect(process.exitCode).toBe(1);
    });

    it('supports --format=json', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');
      mockExistsSync.mockReturnValue(false);
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.checks).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.valid).toBeDefined();
    });

    it('sets exitCode=1 for invalid files with --format=json', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('credentials.json')) return true;
        return false;
      });
      mockLoadCredentials.mockReturnValue(null);
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      expect(result.valid).toBe(false);
      expect(process.exitCode).toBe(1);
    });

    it('shows valid credentials when loadCredentials succeeds', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('credentials.json')) return true;
        return false;
      });
      mockLoadCredentials.mockReturnValue({ idToken: 'tok', email: 'a@b.com' });
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      const credCheck = result.checks.find((c: { file: string }) => c.file === 'credentials.json');
      expect(credCheck.status).toBe('valid');
      expect(credCheck.message).toBe('Schema valid');
    });

    it('includes project name in context check message', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');
      mockExistsSync.mockReturnValue(false);
      mockGetActiveContext.mockReturnValue({
        projectId: 'proj-1',
        projectName: 'Marketing Site',
        hyveId: 'landing-page',
      });

      await run(['dev', 'config', 'validate', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      const ctxCheck = result.checks.find((c: { file: string }) => c.file === 'context.json');
      expect(ctxCheck.status).toBe('valid');
      expect(ctxCheck.message).toContain('Marketing Site');
    });

    it('shows Schema valid message for valid config file', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ server: {} }));
      mockRelayConfigSchemaParse.mockReturnValue({ server: {} });
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      const configCheck = result.checks.find((c: { file: string }) => c.file === 'config.json');
      expect(configCheck.status).toBe('valid');
      expect(configCheck.message).toBe('Schema valid');
    });

    it('reports config schema validation error', async () => {
      mockGetConfigPath.mockReturnValue('/home/user/.myndhyve-cli/config.json');
      mockGetCredentialsPath.mockReturnValue('/home/user/.myndhyve-cli/credentials.json');

      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('config.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ server: { baseUrl: 'bad' } }));
      mockRelayConfigSchemaParse.mockImplementation(() => {
        throw new Error('Invalid URL');
      });
      mockGetActiveContext.mockReturnValue(null);

      await run(['dev', 'config', 'validate', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const result = JSON.parse(output);
      const configCheck = result.checks.find((c: { file: string }) => c.file === 'config.json');
      expect(configCheck.status).toBe('invalid');
      expect(configCheck.message).toContain('Invalid URL');
      expect(result.valid).toBe(false);
      expect(process.exitCode).toBe(1);
    });
  });

  // ==========================================================================
  // CHANNEL VALIDATION (shared helper)
  // ==========================================================================

  describe('channel validation', () => {
    it('accepts whatsapp as valid channel for envelope create', async () => {
      mockCreateTestEnvelope.mockReturnValue({});

      await run(['dev', 'envelope', 'create', '--channel', 'whatsapp']);

      expect(mockCreateTestEnvelope).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('accepts signal as valid channel for envelope create', async () => {
      mockCreateTestEnvelope.mockReturnValue({});

      await run(['dev', 'envelope', 'create', '--channel', 'signal']);

      expect(mockCreateTestEnvelope).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('accepts imessage as valid channel for envelope create', async () => {
      mockCreateTestEnvelope.mockReturnValue({});

      await run(['dev', 'envelope', 'create', '--channel', 'imessage']);

      expect(mockCreateTestEnvelope).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('rejects discord as invalid channel', async () => {
      await run(['dev', 'envelope', 'create', '--channel', 'discord']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Unknown channel "discord"');
      expect(process.exitCode).toBe(1);
    });

    it('rejects slack as invalid channel', async () => {
      await run(['dev', 'envelope', 'create', '--channel', 'slack']);

      const errOutput = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errOutput).toContain('Unknown channel "slack"');
      expect(process.exitCode).toBe(1);
    });
  });
});
