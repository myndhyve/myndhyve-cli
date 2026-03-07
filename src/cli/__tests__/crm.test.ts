import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  MOCK_COLLECTIONS,
  mockRequireAuth,
  mockTruncate,
  mockPrintError,
  mockListCrmEntities,
  mockGetCrmEntity,
  mockCreateCrmEntity,
  mockUpdateCrmEntity,
  mockDeleteCrmEntity,
  mockGetCrmStats,
} = vi.hoisted(() => ({
  MOCK_COLLECTIONS: [
    'contacts',
    'activities',
    'tasks',
    'deals',
    'sequences',
    'customers',
    'orders',
    'products',
    'coupons',
    'affiliates',
  ],
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockPrintError: vi.fn(),
  mockListCrmEntities: vi.fn(),
  mockGetCrmEntity: vi.fn(),
  mockCreateCrmEntity: vi.fn(),
  mockUpdateCrmEntity: vi.fn(),
  mockDeleteCrmEntity: vi.fn(),
  mockGetCrmStats: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/crm.js', () => ({
  listCrmEntities: (...args: unknown[]) => mockListCrmEntities(...args),
  getCrmEntity: (...args: unknown[]) => mockGetCrmEntity(...args),
  createCrmEntity: (...args: unknown[]) => mockCreateCrmEntity(...args),
  updateCrmEntity: (...args: unknown[]) => mockUpdateCrmEntity(...args),
  deleteCrmEntity: (...args: unknown[]) => mockDeleteCrmEntity(...args),
  getCrmStats: (...args: unknown[]) => mockGetCrmStats(...args),
  isValidCrmCollection: (v: string) => MOCK_COLLECTIONS.includes(v),
  CRM_COLLECTIONS: MOCK_COLLECTIONS,
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: (...args: unknown[]) => {
    const err = args[0] as { code: string; message: string; suggestion?: string };
    process.stderr.write(`\n  Error: ${err.message}\n`);
    if (err.suggestion) process.stderr.write(`  ${err.suggestion}\n`);
    process.stderr.write('\n');
  },
}));

import { registerCrmCommands } from '../crm.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

const SAMPLE_ENTITY = {
  id: 'contact-1',
  collection: 'contacts',
  name: 'Acme Corp',
  status: 'active',
  email: 'hello@acme.com',
  tags: ['enterprise'],
  createdAt: '2026-01-10T08:00:00Z',
  updatedAt: '2026-02-15T10:30:00Z',
};

const SAMPLE_ENTITY_2 = {
  id: 'contact-2',
  collection: 'contacts',
  name: 'Globex Inc',
  status: 'lead',
  email: 'info@globex.com',
  tags: ['smb'],
  createdAt: '2026-01-20T12:00:00Z',
  updatedAt: '2026-03-01T09:00:00Z',
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerCrmCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerCrmCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockPrintError.mockReset();
    mockListCrmEntities.mockReset();
    mockGetCrmEntity.mockReset();
    mockCreateCrmEntity.mockReset();
    mockUpdateCrmEntity.mockReset();
    mockDeleteCrmEntity.mockReset();
    mockGetCrmStats.mockReset();

    // Default: auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // truncate passthrough
    mockTruncate.mockImplementation((s: string) => s);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the crm command group on the program', () => {
      const program = new Command();
      registerCrmCommands(program);
      const crm = program.commands.find((c) => c.name() === 'crm');
      expect(crm).toBeDefined();
    });

    it('registers all subcommands under crm', () => {
      const program = new Command();
      registerCrmCommands(program);
      const crm = program.commands.find((c) => c.name() === 'crm')!;
      const subNames = crm.commands.map((c) => c.name());

      expect(subNames).toContain('list');
      expect(subNames).toContain('get');
      expect(subNames).toContain('create');
      expect(subNames).toContain('update');
      expect(subNames).toContain('delete');
      expect(subNames).toContain('stats');
      expect(subNames).toContain('collections');
    });
  });

  // ==========================================================================
  // CRM LIST
  // ==========================================================================

  describe('crm list', () => {
    it('lists entities with table output', async () => {
      mockListCrmEntities.mockResolvedValue([SAMPLE_ENTITY, SAMPLE_ENTITY_2]);

      await run(['crm', 'list', 'contacts']);

      expect(mockListCrmEntities).toHaveBeenCalledWith('user_abc', 'contacts', {
        status: undefined,
        tag: undefined,
        limit: 50,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Contacts (2)');
      expect(output).toContain('contact-1');
      expect(output).toContain('Acme Corp');
    });

    it('outputs JSON format', async () => {
      const entities = [SAMPLE_ENTITY];
      mockListCrmEntities.mockResolvedValue(entities);

      await run(['crm', 'list', 'contacts', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(entities);
    });

    it('shows create hint when result is empty', async () => {
      mockListCrmEntities.mockResolvedValue([]);

      await run(['crm', 'list', 'deals']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No deals found');
      expect(output).toContain('myndhyve-cli crm create deals');
    });

    it('rejects invalid collection name with USAGE_ERROR', async () => {
      await run(['crm', 'list', 'widgets']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown CRM collection "widgets"');
      expect(output).toContain('Valid collections:');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockListCrmEntities).not.toHaveBeenCalled();
    });

    it('passes --status and --tag filters to API', async () => {
      mockListCrmEntities.mockResolvedValue([]);

      await run(['crm', 'list', 'contacts', '--status', 'active', '--tag', 'vip']);

      expect(mockListCrmEntities).toHaveBeenCalledWith('user_abc', 'contacts', {
        status: 'active',
        tag: 'vip',
        limit: 50,
      });
    });

    it('passes --limit to API', async () => {
      mockListCrmEntities.mockResolvedValue([]);

      await run(['crm', 'list', 'contacts', '--limit', '10']);

      expect(mockListCrmEntities).toHaveBeenCalledWith('user_abc', 'contacts', {
        status: undefined,
        tag: undefined,
        limit: 10,
      });
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'list', 'contacts']);

      expect(mockListCrmEntities).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockListCrmEntities.mockRejectedValue(new Error('Network timeout'));

      await run(['crm', 'list', 'contacts']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list contacts', expect.any(Error));
    });
  });

  // ==========================================================================
  // CRM GET
  // ==========================================================================

  describe('crm get', () => {
    it('shows entity detail', async () => {
      mockGetCrmEntity.mockResolvedValue(SAMPLE_ENTITY);

      await run(['crm', 'get', 'contacts', 'contact-1']);

      expect(mockGetCrmEntity).toHaveBeenCalledWith('user_abc', 'contacts', 'contact-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Contact: Acme Corp');
    });

    it('sets NOT_FOUND exitCode for missing entity', async () => {
      mockGetCrmEntity.mockResolvedValue(null);

      await run(['crm', 'get', 'contacts', 'nonexistent']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Contact "nonexistent" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('rejects invalid collection name', async () => {
      await run(['crm', 'get', 'bogus', 'id-1']);

      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockGetCrmEntity).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      mockGetCrmEntity.mockResolvedValue(SAMPLE_ENTITY);

      await run(['crm', 'get', 'contacts', 'contact-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_ENTITY);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'get', 'contacts', 'contact-1']);

      expect(mockGetCrmEntity).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetCrmEntity.mockRejectedValue(new Error('Server error'));

      await run(['crm', 'get', 'contacts', 'contact-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get contacts entity', expect.any(Error));
    });
  });

  // ==========================================================================
  // CRM CREATE
  // ==========================================================================

  describe('crm create', () => {
    it('creates entity and shows confirmation', async () => {
      const created = { id: 'new-id', name: 'New Contact', collection: 'contacts' };
      mockCreateCrmEntity.mockResolvedValue(created);

      await run(['crm', 'create', 'contacts', '--data', '{"name": "New Contact"}']);

      expect(mockCreateCrmEntity).toHaveBeenCalledWith(
        'user_abc',
        'contacts',
        expect.any(String), // auto-generated ID
        { name: 'New Contact' }
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Created contact');
      expect(output).toContain('new-id');
      expect(output).toContain('New Contact');
    });

    it('uses custom --id when provided', async () => {
      const created = { id: 'custom-id', name: 'Custom', collection: 'contacts' };
      mockCreateCrmEntity.mockResolvedValue(created);

      await run(['crm', 'create', 'contacts', '--data', '{"name": "Custom"}', '--id', 'custom-id']);

      expect(mockCreateCrmEntity).toHaveBeenCalledWith(
        'user_abc',
        'contacts',
        'custom-id',
        { name: 'Custom' }
      );
    });

    it('rejects invalid JSON in --data', async () => {
      await run(['crm', 'create', 'contacts', '--data', '{bad json}']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid JSON');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockCreateCrmEntity).not.toHaveBeenCalled();
    });

    it('rejects invalid collection name', async () => {
      await run(['crm', 'create', 'widgets', '--data', '{"name": "X"}']);

      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockCreateCrmEntity).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      const created = { id: 'json-id', name: 'JSON Entity', collection: 'deals' };
      mockCreateCrmEntity.mockResolvedValue(created);

      await run(['crm', 'create', 'deals', '--data', '{"name": "JSON Entity"}', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(created);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'create', 'contacts', '--data', '{"name": "X"}']);

      expect(mockCreateCrmEntity).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockCreateCrmEntity.mockRejectedValue(new Error('Write failed'));

      await run(['crm', 'create', 'contacts', '--data', '{"name": "X"}']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to create contacts entity', expect.any(Error));
    });
  });

  // ==========================================================================
  // CRM UPDATE
  // ==========================================================================

  describe('crm update', () => {
    it('updates entity and shows confirmation', async () => {
      const updated = { id: 'contact-1', name: 'Updated Corp', collection: 'contacts' };
      mockUpdateCrmEntity.mockResolvedValue(updated);

      await run(['crm', 'update', 'contacts', 'contact-1', '--data', '{"name": "Updated Corp"}']);

      expect(mockUpdateCrmEntity).toHaveBeenCalledWith(
        'user_abc',
        'contacts',
        'contact-1',
        { name: 'Updated Corp' }
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Updated contact "contact-1"');
    });

    it('rejects invalid JSON in --data', async () => {
      await run(['crm', 'update', 'contacts', 'contact-1', '--data', 'not-json']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid JSON');
      expect(process.exitCode).toBe(2);
      expect(mockUpdateCrmEntity).not.toHaveBeenCalled();
    });

    it('rejects invalid collection name', async () => {
      await run(['crm', 'update', 'bogus', 'id-1', '--data', '{"x":1}']);

      expect(process.exitCode).toBe(2);
      expect(mockUpdateCrmEntity).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      const updated = { id: 'contact-1', name: 'Updated', collection: 'contacts' };
      mockUpdateCrmEntity.mockResolvedValue(updated);

      await run(['crm', 'update', 'contacts', 'contact-1', '--data', '{"name": "Updated"}', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(updated);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'update', 'contacts', 'contact-1', '--data', '{"x":1}']);

      expect(mockUpdateCrmEntity).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockUpdateCrmEntity.mockRejectedValue(new Error('Conflict'));

      await run(['crm', 'update', 'contacts', 'contact-1', '--data', '{"x":1}']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to update contacts entity', expect.any(Error));
    });
  });

  // ==========================================================================
  // CRM DELETE
  // ==========================================================================

  describe('crm delete', () => {
    it('requires --force flag for deletion', async () => {
      await run(['crm', 'delete', 'contacts', 'contact-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Use --force to confirm deletion');
      expect(output).toContain('contact-1');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockDeleteCrmEntity).not.toHaveBeenCalled();
    });

    it('deletes entity when --force is provided', async () => {
      mockDeleteCrmEntity.mockResolvedValue(undefined);

      await run(['crm', 'delete', 'contacts', 'contact-1', '--force']);

      expect(mockDeleteCrmEntity).toHaveBeenCalledWith('user_abc', 'contacts', 'contact-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Deleted contact "contact-1"');
    });

    it('mentions restricted deletion for orders in confirmation prompt', async () => {
      await run(['crm', 'delete', 'orders', 'order-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('restricted deletion');
      expect(output).toContain('audit trail');
    });

    it('rejects invalid collection name', async () => {
      await run(['crm', 'delete', 'widgets', 'id-1', '--force']);

      expect(process.exitCode).toBe(2);
      expect(mockDeleteCrmEntity).not.toHaveBeenCalled();
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'delete', 'contacts', 'contact-1', '--force']);

      expect(mockDeleteCrmEntity).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockDeleteCrmEntity.mockRejectedValue(new Error('PERMISSION_DENIED'));

      await run(['crm', 'delete', 'contacts', 'contact-1', '--force']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to delete contacts entity', expect.any(Error));
    });
  });

  // ==========================================================================
  // CRM STATS
  // ==========================================================================

  describe('crm stats', () => {
    it('shows overview in table format', async () => {
      mockGetCrmStats.mockResolvedValue({
        contacts: -1,
        deals: 0,
        orders: -1,
        products: 0,
        customers: -1,
      });

      await run(['crm', 'stats']);

      expect(mockGetCrmStats).toHaveBeenCalledWith('user_abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('CRM Overview');
      expect(output).toContain('Contacts:  Yes');
      expect(output).toContain('Deals:     None');
      expect(output).toContain('Orders:    Yes');
      expect(output).toContain('Products:  None');
      expect(output).toContain('Customers: Yes');
    });

    it('outputs has_data/empty in JSON format', async () => {
      mockGetCrmStats.mockResolvedValue({
        contacts: -1,
        deals: 0,
        orders: -1,
        products: 0,
        customers: 0,
      });

      await run(['crm', 'stats', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.contacts).toBe('has_data');
      expect(parsed.deals).toBe('empty');
      expect(parsed.orders).toBe('has_data');
      expect(parsed.products).toBe('empty');
      expect(parsed.customers).toBe('empty');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'stats']);

      expect(mockGetCrmStats).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetCrmStats.mockRejectedValue(new Error('Timeout'));

      await run(['crm', 'stats']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get CRM stats', expect.any(Error));
    });
  });

  // ==========================================================================
  // CRM COLLECTIONS
  // ==========================================================================

  describe('crm collections', () => {
    it('lists all 10 available collections', async () => {
      await run(['crm', 'collections']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Available CRM Collections');
      for (const col of MOCK_COLLECTIONS) {
        expect(output).toContain(col);
      }
    });

    it('shows usage hint', async () => {
      await run(['crm', 'collections']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('myndhyve-cli crm list <collection>');
    });

    it('does not require authentication', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['crm', 'collections']);

      // collections command does not call requireAuth at all
      expect(mockRequireAuth).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Available CRM Collections');
    });
  });
});
