import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  MOCK_COLLECTIONS,
  mockRequireAuth,
  mockTruncate,
  mockPrintError,
  mockListCommerceEntities,
  mockGetCommerceEntity,
  mockCreateCommerceEntity,
  mockUpdateCommerceEntity,
  mockDeleteCommerceEntity,
  mockFulfillOrder,
  mockRefundOrder,
  mockCancelOrder,
  mockGetCommerceStats,
  mockGetLowStockProducts,
} = vi.hoisted(() => ({
  MOCK_COLLECTIONS: ['products', 'orders', 'customers', 'coupons', 'affiliates'],
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockPrintError: vi.fn(),
  mockListCommerceEntities: vi.fn(),
  mockGetCommerceEntity: vi.fn(),
  mockCreateCommerceEntity: vi.fn(),
  mockUpdateCommerceEntity: vi.fn(),
  mockDeleteCommerceEntity: vi.fn(),
  mockFulfillOrder: vi.fn(),
  mockRefundOrder: vi.fn(),
  mockCancelOrder: vi.fn(),
  mockGetCommerceStats: vi.fn(),
  mockGetLowStockProducts: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/commerce.js', () => ({
  listCommerceEntities: (...args: unknown[]) => mockListCommerceEntities(...args),
  getCommerceEntity: (...args: unknown[]) => mockGetCommerceEntity(...args),
  createCommerceEntity: (...args: unknown[]) => mockCreateCommerceEntity(...args),
  updateCommerceEntity: (...args: unknown[]) => mockUpdateCommerceEntity(...args),
  deleteCommerceEntity: (...args: unknown[]) => mockDeleteCommerceEntity(...args),
  fulfillOrder: (...args: unknown[]) => mockFulfillOrder(...args),
  refundOrder: (...args: unknown[]) => mockRefundOrder(...args),
  cancelOrder: (...args: unknown[]) => mockCancelOrder(...args),
  getCommerceStats: (...args: unknown[]) => mockGetCommerceStats(...args),
  getLowStockProducts: (...args: unknown[]) => mockGetLowStockProducts(...args),
  isValidCommerceCollection: (v: string) => MOCK_COLLECTIONS.includes(v),
  formatPrice: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  COMMERCE_COLLECTIONS: MOCK_COLLECTIONS,
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

import { registerCommerceCommands } from '../commerce.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

const SAMPLE_PRODUCT = {
  id: 'prod-1',
  collection: 'products',
  name: 'T-Shirt',
  price: 2999,
  type: 'physical',
  isActive: true,
  inventory: 50,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-10T00:00:00Z',
};

const SAMPLE_ORDER = {
  id: 'ord-1',
  collection: 'orders',
  name: 'ORD-001',
  orderNumber: 'ORD-001',
  customerEmail: 'alice@example.com',
  total: 4999,
  currency: 'usd',
  status: 'paid',
  createdAt: '2026-03-15T00:00:00Z',
  updatedAt: '2026-03-15T00:00:00Z',
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerCommerceCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerCommerceCommands', () => {
  let consoleSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockPrintError.mockReset();
    mockListCommerceEntities.mockReset();
    mockGetCommerceEntity.mockReset();
    mockCreateCommerceEntity.mockReset();
    mockUpdateCommerceEntity.mockReset();
    mockDeleteCommerceEntity.mockReset();
    mockFulfillOrder.mockReset();
    mockRefundOrder.mockReset();
    mockCancelOrder.mockReset();
    mockGetCommerceStats.mockReset();
    mockGetLowStockProducts.mockReset();

    mockRequireAuth.mockReturnValue(AUTH_USER);
    mockTruncate.mockImplementation((s: string) => s);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the commerce command group on the program', () => {
      const program = new Command();
      registerCommerceCommands(program);
      const commerce = program.commands.find((c) => c.name() === 'commerce');
      expect(commerce).toBeDefined();
    });

    it('registers all subcommands under commerce', () => {
      const program = new Command();
      registerCommerceCommands(program);
      const commerce = program.commands.find((c) => c.name() === 'commerce')!;
      const subNames = commerce.commands.map((c) => c.name());

      expect(subNames).toContain('list');
      expect(subNames).toContain('get');
      expect(subNames).toContain('create');
      expect(subNames).toContain('update');
      expect(subNames).toContain('delete');
      expect(subNames).toContain('fulfill');
      expect(subNames).toContain('refund');
      expect(subNames).toContain('cancel');
      expect(subNames).toContain('stats');
      expect(subNames).toContain('low-stock');
      expect(subNames).toContain('collections');
    });
  });

  // ==========================================================================
  // COMMERCE LIST
  // ==========================================================================

  describe('commerce list', () => {
    it('lists entities with table output', async () => {
      mockListCommerceEntities.mockResolvedValue([SAMPLE_PRODUCT]);

      await run(['commerce', 'list', 'products']);

      expect(mockListCommerceEntities).toHaveBeenCalledWith('user_abc', 'products', {
        status: undefined,
        limit: 50,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Products (1)');
    });

    it('outputs JSON format', async () => {
      mockListCommerceEntities.mockResolvedValue([SAMPLE_PRODUCT]);

      await run(['commerce', 'list', 'products', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual([SAMPLE_PRODUCT]);
    });

    it('shows create hint when result is empty', async () => {
      mockListCommerceEntities.mockResolvedValue([]);

      await run(['commerce', 'list', 'products']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No products found');
      expect(output).toContain('myndhyve-cli commerce create products');
    });

    it('rejects invalid collection name', async () => {
      await run(['commerce', 'list', 'contacts']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown commerce collection "contacts"');
      expect(process.exitCode).toBe(2);
      expect(mockListCommerceEntities).not.toHaveBeenCalled();
    });

    it('passes --status filter to API', async () => {
      mockListCommerceEntities.mockResolvedValue([]);

      await run(['commerce', 'list', 'orders', '--status', 'pending']);

      expect(mockListCommerceEntities).toHaveBeenCalledWith('user_abc', 'orders', {
        status: 'pending',
        limit: 50,
      });
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['commerce', 'list', 'products']);

      expect(mockListCommerceEntities).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockListCommerceEntities.mockRejectedValue(new Error('Network timeout'));

      await run(['commerce', 'list', 'products']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list products', expect.any(Error));
    });
  });

  // ==========================================================================
  // COMMERCE GET
  // ==========================================================================

  describe('commerce get', () => {
    it('shows entity detail', async () => {
      mockGetCommerceEntity.mockResolvedValue(SAMPLE_PRODUCT);

      await run(['commerce', 'get', 'products', 'prod-1']);

      expect(mockGetCommerceEntity).toHaveBeenCalledWith('user_abc', 'products', 'prod-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Product: T-Shirt');
    });

    it('sets NOT_FOUND exitCode for missing entity', async () => {
      mockGetCommerceEntity.mockResolvedValue(null);

      await run(['commerce', 'get', 'products', 'nonexistent']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Product "nonexistent" not found');
      expect(process.exitCode).toBe(3);
    });

    it('outputs JSON format', async () => {
      mockGetCommerceEntity.mockResolvedValue(SAMPLE_PRODUCT);

      await run(['commerce', 'get', 'products', 'prod-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_PRODUCT);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['commerce', 'get', 'products', 'prod-1']);

      expect(mockGetCommerceEntity).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // COMMERCE CREATE
  // ==========================================================================

  describe('commerce create', () => {
    it('creates entity and shows confirmation', async () => {
      const created = { id: 'prod-new', name: 'New Product', collection: 'products' };
      mockCreateCommerceEntity.mockResolvedValue(created);

      await run(['commerce', 'create', 'products', '--data', '{"name": "New Product", "price": 1999}']);

      expect(mockCreateCommerceEntity).toHaveBeenCalledWith(
        'user_abc',
        'products',
        expect.any(String),
        { name: 'New Product', price: 1999 }
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Created product');
      expect(output).toContain('prod-new');
    });

    it('uses custom --id when provided', async () => {
      mockCreateCommerceEntity.mockResolvedValue({ id: 'custom-id', name: 'Custom', collection: 'products' });

      await run(['commerce', 'create', 'products', '--data', '{"name": "Custom"}', '--id', 'custom-id']);

      expect(mockCreateCommerceEntity).toHaveBeenCalledWith(
        'user_abc',
        'products',
        'custom-id',
        { name: 'Custom' }
      );
    });

    it('rejects invalid JSON in --data', async () => {
      await run(['commerce', 'create', 'products', '--data', '{bad json}']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid JSON');
      expect(process.exitCode).toBe(2);
      expect(mockCreateCommerceEntity).not.toHaveBeenCalled();
    });

    it('rejects invalid collection name', async () => {
      await run(['commerce', 'create', 'widgets', '--data', '{"name": "X"}']);

      expect(process.exitCode).toBe(2);
      expect(mockCreateCommerceEntity).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // COMMERCE UPDATE
  // ==========================================================================

  describe('commerce update', () => {
    it('updates entity and shows confirmation', async () => {
      mockUpdateCommerceEntity.mockResolvedValue({ id: 'prod-1', name: 'Updated', collection: 'products' });

      await run(['commerce', 'update', 'products', 'prod-1', '--data', '{"name": "Updated"}']);

      expect(mockUpdateCommerceEntity).toHaveBeenCalledWith(
        'user_abc',
        'products',
        'prod-1',
        { name: 'Updated' }
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Updated product "prod-1"');
    });

    it('rejects invalid JSON in --data', async () => {
      await run(['commerce', 'update', 'products', 'prod-1', '--data', 'not-json']);

      expect(process.exitCode).toBe(2);
      expect(mockUpdateCommerceEntity).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // COMMERCE DELETE
  // ==========================================================================

  describe('commerce delete', () => {
    it('blocks order deletion with audit trail message', async () => {
      await run(['commerce', 'delete', 'orders', 'ord-1', '--force']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Orders cannot be deleted');
      expect(output).toContain('audit trail');
      expect(process.exitCode).toBe(2);
      expect(mockDeleteCommerceEntity).not.toHaveBeenCalled();
    });

    it('requires --force flag for deletion', async () => {
      await run(['commerce', 'delete', 'products', 'prod-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Use --force to confirm deletion');
      expect(process.exitCode).toBe(2);
      expect(mockDeleteCommerceEntity).not.toHaveBeenCalled();
    });

    it('deletes entity when --force is provided', async () => {
      mockDeleteCommerceEntity.mockResolvedValue(undefined);

      await run(['commerce', 'delete', 'products', 'prod-1', '--force']);

      expect(mockDeleteCommerceEntity).toHaveBeenCalledWith('user_abc', 'products', 'prod-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Deleted product "prod-1"');
    });
  });

  // ==========================================================================
  // ORDER LIFECYCLE
  // ==========================================================================

  describe('commerce fulfill', () => {
    it('fulfills order with tracking info', async () => {
      mockFulfillOrder.mockResolvedValue({ id: 'ord-1', status: 'fulfilled' });

      await run(['commerce', 'fulfill', 'ord-1', '--tracking', 'TRK-123']);

      expect(mockFulfillOrder).toHaveBeenCalledWith('user_abc', 'ord-1', {
        trackingNumber: 'TRK-123',
        trackingUrl: undefined,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Order "ord-1" marked as fulfilled');
      expect(output).toContain('Tracking: TRK-123');
    });

    it('fulfills order without tracking', async () => {
      mockFulfillOrder.mockResolvedValue({ id: 'ord-1', status: 'fulfilled' });

      await run(['commerce', 'fulfill', 'ord-1']);

      expect(mockFulfillOrder).toHaveBeenCalledWith('user_abc', 'ord-1', {
        trackingNumber: undefined,
        trackingUrl: undefined,
      });
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['commerce', 'fulfill', 'ord-1']);

      expect(mockFulfillOrder).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockFulfillOrder.mockRejectedValue(new Error('Not found'));

      await run(['commerce', 'fulfill', 'ord-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to fulfill order "ord-1"', expect.any(Error));
    });
  });

  describe('commerce refund', () => {
    it('requires --force flag', async () => {
      await run(['commerce', 'refund', 'ord-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Use --force to confirm refund');
      expect(process.exitCode).toBe(2);
      expect(mockRefundOrder).not.toHaveBeenCalled();
    });

    it('refunds order with --force', async () => {
      mockRefundOrder.mockResolvedValue({ id: 'ord-1', status: 'refunded' });

      await run(['commerce', 'refund', 'ord-1', '--force']);

      expect(mockRefundOrder).toHaveBeenCalledWith('user_abc', 'ord-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Order "ord-1" refunded');
    });
  });

  describe('commerce cancel', () => {
    it('requires --force flag', async () => {
      await run(['commerce', 'cancel', 'ord-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Use --force to confirm cancellation');
      expect(process.exitCode).toBe(2);
      expect(mockCancelOrder).not.toHaveBeenCalled();
    });

    it('cancels order with --force', async () => {
      mockCancelOrder.mockResolvedValue({ id: 'ord-1', status: 'canceled' });

      await run(['commerce', 'cancel', 'ord-1', '--force']);

      expect(mockCancelOrder).toHaveBeenCalledWith('user_abc', 'ord-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Order "ord-1" canceled');
    });
  });

  // ==========================================================================
  // COMMERCE STATS
  // ==========================================================================

  describe('commerce stats', () => {
    it('shows dashboard in table format', async () => {
      mockGetCommerceStats.mockResolvedValue({
        products: 12,
        orders: 45,
        customers: 30,
        coupons: 3,
        affiliates: 5,
        revenue: 149900,
        pendingOrders: 7,
        truncated: false,
      });

      await run(['commerce', 'stats']);

      expect(mockGetCommerceStats).toHaveBeenCalledWith('user_abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Commerce Dashboard');
      expect(output).toContain('$1499.00');
      expect(output).toContain('45');
      expect(output).toContain('7');
      expect(output).toContain('12');
    });

    it('outputs JSON format', async () => {
      const stats = {
        products: 2,
        orders: 5,
        customers: 3,
        coupons: 1,
        affiliates: 0,
        revenue: 9998,
        pendingOrders: 2,
        truncated: false,
      };
      mockGetCommerceStats.mockResolvedValue(stats);

      await run(['commerce', 'stats', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(stats);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['commerce', 'stats']);

      expect(mockGetCommerceStats).not.toHaveBeenCalled();
    });

    it('shows truncation warning when stats are truncated', async () => {
      mockGetCommerceStats.mockResolvedValue({
        products: 200,
        orders: 200,
        customers: 50,
        coupons: 2,
        affiliates: 1,
        revenue: 500000,
        pendingOrders: 30,
        truncated: true,
      });

      await run(['commerce', 'stats']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('most recent 200 entries');
    });

    it('calls printError on API failure', async () => {
      mockGetCommerceStats.mockRejectedValue(new Error('Timeout'));

      await run(['commerce', 'stats']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get commerce stats', expect.any(Error));
    });
  });

  // ==========================================================================
  // LOW-STOCK
  // ==========================================================================

  describe('commerce low-stock', () => {
    it('shows low-stock products', async () => {
      mockGetLowStockProducts.mockResolvedValue([
        { id: 'p1', name: 'Widget', inventory: 3, lowInventoryThreshold: 5, price: 999, currency: 'usd', collection: 'products' },
      ]);

      await run(['commerce', 'low-stock']);

      expect(mockGetLowStockProducts).toHaveBeenCalledWith('user_abc', { limit: 50 });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Low-Stock Products (1)');
      expect(output).toContain('Widget');
    });

    it('shows empty message when no low-stock products', async () => {
      mockGetLowStockProducts.mockResolvedValue([]);

      await run(['commerce', 'low-stock']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No low-stock products found');
    });

    it('outputs JSON format', async () => {
      const products = [{ id: 'p1', name: 'Widget', inventory: 2, collection: 'products' }];
      mockGetLowStockProducts.mockResolvedValue(products);

      await run(['commerce', 'low-stock', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(products);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['commerce', 'low-stock']);

      expect(mockGetLowStockProducts).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // COMMERCE COLLECTIONS
  // ==========================================================================

  describe('commerce collections', () => {
    it('lists all 5 available collections', async () => {
      await run(['commerce', 'collections']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Available Commerce Collections');
      for (const col of MOCK_COLLECTIONS) {
        expect(output).toContain(col);
      }
    });

    it('shows usage hint', async () => {
      await run(['commerce', 'collections']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('myndhyve-cli commerce list <collection>');
    });

    it('does not require authentication', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['commerce', 'collections']);

      expect(mockRequireAuth).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Available Commerce Collections');
    });
  });
});
