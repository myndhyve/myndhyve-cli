/**
 * MyndHyve CLI — Commerce Commands
 *
 * Commander subcommand group for standalone e-commerce management:
 *   myndhyve-cli commerce list <collection>
 *   myndhyve-cli commerce get <collection> <id>
 *   myndhyve-cli commerce create <collection> --data '{...}'
 *   myndhyve-cli commerce update <collection> <id> --data '{...}'
 *   myndhyve-cli commerce delete <collection> <id>
 *   myndhyve-cli commerce fulfill <orderId> [--tracking <number>]
 *   myndhyve-cli commerce refund <orderId>
 *   myndhyve-cli commerce cancel <orderId>
 *   myndhyve-cli commerce stats
 *   myndhyve-cli commerce low-stock
 *   myndhyve-cli commerce collections
 */

import type { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import {
  listCommerceEntities,
  getCommerceEntity,
  createCommerceEntity,
  updateCommerceEntity,
  deleteCommerceEntity,
  fulfillOrder,
  refundOrder,
  cancelOrder,
  getCommerceStats,
  getLowStockProducts,
  isValidCommerceCollection,
  formatPrice,
  COMMERCE_COLLECTIONS,
  type CommerceCollection,
} from '../api/commerce.js';
import { requireAuth, truncate, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

/** Singular display name for each commerce collection. */
const COLLECTION_SINGULAR: Record<CommerceCollection, string> = {
  products: 'Product',
  orders: 'Order',
  customers: 'Customer',
  coupons: 'Coupon',
  affiliates: 'Affiliate',
};

// ============================================================================
// REGISTER
// ============================================================================

export function registerCommerceCommands(program: Command): void {
  const commerce = program
    .command('commerce')
    .description('Manage e-commerce (products, orders, customers, coupons, affiliates)');

  // ── List ──────────────────────────────────────────────────────────────

  commerce
    .command('list <collection>')
    .description('List entities in a commerce collection')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Max results', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCommerceCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown commerce collection "${collection}".`,
          suggestion: `Valid collections: ${COMMERCE_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const limit = parseInt(opts.limit, 10);
        const entities = await listCommerceEntities(auth.uid, collection as CommerceCollection, {
          status: opts.status,
          limit: isNaN(limit) || limit < 1 ? 50 : limit,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(entities, null, 2));
          return;
        }

        if (entities.length === 0) {
          console.log(`\n  No ${collection} found.`);
          console.log(`  Create one: myndhyve-cli commerce create ${collection} --data '{"name": "..."}'`);
          console.log('');
          return;
        }

        console.log(`\n  ${capitalize(collection)} (${entities.length})\n`);
        printGenericTable(entities);

        console.log('');
      } catch (error) {
        printError(`Failed to list ${collection}`, error);
      }
    });

  // ── Get ───────────────────────────────────────────────────────────────

  commerce
    .command('get <collection> <id>')
    .description('Get detailed information about a commerce entity')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCommerceCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown commerce collection "${collection}".`,
          suggestion: `Valid collections: ${COMMERCE_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entity = await getCommerceEntity(auth.uid, collection as CommerceCollection, id);

        if (!entity) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `${COLLECTION_SINGULAR[collection as CommerceCollection]} "${id}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  ${COLLECTION_SINGULAR[collection as CommerceCollection]}: ${entity.name}`);
        console.log('  ' + '\u2500'.repeat(50));

        const skipFields = new Set(['collection']);
        for (const [key, value] of Object.entries(entity)) {
          if (skipFields.has(key)) continue;
          if (value === undefined || value === null) continue;

          let displayValue: string;
          if ((key === 'total' || key === 'price' || key === 'subtotal' || key === 'revenue') && typeof value === 'number') {
            displayValue = formatPrice(value, (entity.currency as string) || 'usd');
          } else if (typeof value === 'object') {
            displayValue = JSON.stringify(value);
          } else {
            displayValue = String(value);
          }

          console.log(`  ${key.padEnd(22)} ${truncate(displayValue, 56)}`);
        }

        console.log('');
      } catch (error) {
        printError(`Failed to get ${collection} entity`, error);
      }
    });

  // ── Create ────────────────────────────────────────────────────────────

  commerce
    .command('create <collection>')
    .description('Create a new commerce entity')
    .requiredOption('--data <json>', 'Entity data as JSON string')
    .option('--id <id>', 'Custom entity ID (auto-generated if not provided)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCommerceCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown commerce collection "${collection}".`,
          suggestion: `Valid collections: ${COMMERCE_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(opts.data);
      } catch {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid JSON in --data option.',
          suggestion: 'Example: --data \'{"name": "T-Shirt", "price": 2999, "type": "physical"}\'',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entityId = opts.id || generateId(collection);
        const entity = await createCommerceEntity(
          auth.uid,
          collection as CommerceCollection,
          entityId,
          data
        );

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Created ${COLLECTION_SINGULAR[collection as CommerceCollection].toLowerCase()}:`);
        console.log(`  ID:   ${entity.id}`);
        console.log(`  Name: ${entity.name}`);
        console.log('');
      } catch (error) {
        printError(`Failed to create ${collection} entity`, error);
      }
    });

  // ── Update ────────────────────────────────────────────────────────────

  commerce
    .command('update <collection> <id>')
    .description('Update a commerce entity')
    .requiredOption('--data <json>', 'Fields to update as JSON string')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCommerceCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown commerce collection "${collection}".`,
          suggestion: `Valid collections: ${COMMERCE_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(opts.data);
      } catch {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: 'Invalid JSON in --data option.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entity = await updateCommerceEntity(
          auth.uid,
          collection as CommerceCollection,
          id,
          data
        );

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Updated ${COLLECTION_SINGULAR[collection as CommerceCollection].toLowerCase()} "${id}".`);
        console.log('');
      } catch (error) {
        printError(`Failed to update ${collection} entity`, error);
      }
    });

  // ── Delete ────────────────────────────────────────────────────────────

  commerce
    .command('delete <collection> <id>')
    .description('Delete a commerce entity (orders cannot be deleted)')
    .option('--force', 'Skip confirmation')
    .action(async (collection: string, id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCommerceCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown commerce collection "${collection}".`,
          suggestion: `Valid collections: ${COMMERCE_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      if (collection === 'orders') {
        printErrorResult({
          code: 'NOT_ALLOWED',
          message: 'Orders cannot be deleted (audit trail enforcement).',
          suggestion: 'Use `commerce cancel <orderId>` or `commerce refund <orderId>` instead.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      if (!opts.force) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm deletion of ${COLLECTION_SINGULAR[collection as CommerceCollection].toLowerCase()} "${id}".`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        await deleteCommerceEntity(auth.uid, collection as CommerceCollection, id);
        console.log(`\n  Deleted ${COLLECTION_SINGULAR[collection as CommerceCollection].toLowerCase()} "${id}".`);
        console.log('');
      } catch (error) {
        printError(`Failed to delete ${collection} entity`, error);
      }
    });

  // ── Fulfill ──────────────────────────────────────────────────────────

  commerce
    .command('fulfill <orderId>')
    .description('Mark an order as fulfilled/shipped')
    .option('--tracking <number>', 'Tracking number')
    .option('--tracking-url <url>', 'Tracking URL')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (orderId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const entity = await fulfillOrder(auth.uid, orderId, {
          trackingNumber: opts.tracking,
          trackingUrl: opts.trackingUrl,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Order "${orderId}" marked as fulfilled.`);
        if (opts.tracking) {
          console.log(`  Tracking: ${opts.tracking}`);
        }
        console.log('');
      } catch (error) {
        printError(`Failed to fulfill order "${orderId}"`, error);
      }
    });

  // ── Refund ──────────────────────────────────────────────────────────

  commerce
    .command('refund <orderId>')
    .description('Refund an order')
    .option('--force', 'Skip confirmation')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (orderId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm refund of order "${orderId}".`,
          suggestion: 'This will mark the order as refunded.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entity = await refundOrder(auth.uid, orderId);

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Order "${orderId}" refunded.`);
        console.log('');
      } catch (error) {
        printError(`Failed to refund order "${orderId}"`, error);
      }
    });

  // ── Cancel ──────────────────────────────────────────────────────────

  commerce
    .command('cancel <orderId>')
    .description('Cancel an order')
    .option('--force', 'Skip confirmation')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (orderId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm cancellation of order "${orderId}".`,
          suggestion: 'This will mark the order as canceled.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entity = await cancelOrder(auth.uid, orderId);

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Order "${orderId}" canceled.`);
        console.log('');
      } catch (error) {
        printError(`Failed to cancel order "${orderId}"`, error);
      }
    });

  // ── Stats ─────────────────────────────────────────────────────────────

  commerce
    .command('stats')
    .description('Show commerce dashboard statistics')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const stats = await getCommerceStats(auth.uid);

        if (opts.format === 'json') {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }

        console.log('\n  Commerce Dashboard\n');
        console.log('  ' + '\u2500'.repeat(34));
        console.log(`  Revenue:        ${stats.revenue > 0 ? formatPrice(stats.revenue) : '$0.00'}`);
        console.log(`  Orders:         ${stats.orders}`);
        console.log(`  Pending:        ${stats.pendingOrders}`);
        console.log(`  Products:       ${stats.products}`);
        console.log(`  Customers:      ${stats.customers}`);
        console.log(`  Coupons:        ${stats.coupons}`);
        console.log(`  Affiliates:     ${stats.affiliates}`);
        if (stats.truncated) {
          console.log('');
          console.log('  Note: Stats based on most recent 200 entries per collection.');
        }
        console.log('');
      } catch (error) {
        printError('Failed to get commerce stats', error);
      }
    });

  // ── Low-Stock ─────────────────────────────────────────────────────────

  commerce
    .command('low-stock')
    .description('Show products with low inventory')
    .option('--limit <n>', 'Max results', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const limit = parseInt(opts.limit, 10);
        const products = await getLowStockProducts(auth.uid, {
          limit: isNaN(limit) || limit < 1 ? 50 : limit,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(products, null, 2));
          return;
        }

        if (products.length === 0) {
          console.log('\n  No low-stock products found.');
          console.log('');
          return;
        }

        console.log(`\n  Low-Stock Products (${products.length})\n`);
        console.log(
          '  ' +
            'Name'.padEnd(28) +
            'Stock'.padEnd(10) +
            'Threshold'.padEnd(12) +
            'Price'
        );
        console.log('  ' + '\u2500'.repeat(64));

        for (const p of products) {
          const inv = p.inventory as number ?? 0;
          const threshold = (p.lowInventoryThreshold as number) || 10;
          const price = typeof p.price === 'number' ? formatPrice(p.price, (p.currency as string) || 'usd') : '-';
          console.log(
            '  ' +
              truncate(p.name, 26).padEnd(28) +
              String(inv).padEnd(10) +
              String(threshold).padEnd(12) +
              price
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to get low-stock products', error);
      }
    });

  // ── Collections ───────────────────────────────────────────────────────

  commerce
    .command('collections')
    .description('List available commerce collections')
    .action(() => {
      console.log('\n  Available Commerce Collections\n');
      console.log('  ' + '\u2500'.repeat(40));
      for (const col of COMMERCE_COLLECTIONS) {
        console.log(`  ${col}`);
      }
      console.log('');
      console.log('  Usage: myndhyve-cli commerce list <collection>');
      console.log('');
    });
}

// ============================================================================
// TABLE FORMATTERS
// ============================================================================

function printGenericTable(entities: Array<{ id: string; name: string; status?: string; updatedAt?: string }>): void {
  console.log(
    '  ' +
      'ID'.padEnd(24) +
      'Name'.padEnd(28) +
      'Status'.padEnd(14) +
      'Updated'
  );
  console.log('  ' + '\u2500'.repeat(80));

  for (const entity of entities) {
    console.log(
      '  ' +
        truncate(entity.id, 22).padEnd(24) +
        truncate(entity.name, 26).padEnd(28) +
        (entity.status || '-').padEnd(14) +
        (entity.updatedAt ? formatDate(entity.updatedAt) : '-')
    );
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function generateId(collection: string): string {
  const prefixes: Record<string, string> = {
    products: 'prod',
    orders: 'ord',
    customers: 'cust',
    coupons: 'cpn',
    affiliates: 'aff',
  };
  const prefix = prefixes[collection] || 'ent';
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}
