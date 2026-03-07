/**
 * MyndHyve CLI — CRM Commands
 *
 * Commander subcommand group for CRM entity management:
 *   myndhyve-cli crm list <collection>
 *   myndhyve-cli crm get <collection> <id>
 *   myndhyve-cli crm create <collection> --data '{...}'
 *   myndhyve-cli crm update <collection> <id> --data '{...}'
 *   myndhyve-cli crm delete <collection> <id>
 *   myndhyve-cli crm stats
 */

import type { Command } from 'commander';
import { randomBytes } from 'node:crypto';
import {
  listCrmEntities,
  getCrmEntity,
  createCrmEntity,
  updateCrmEntity,
  deleteCrmEntity,
  getCrmStats,
  isValidCrmCollection,
  CRM_COLLECTIONS,
  type CrmCollection,
} from '../api/crm.js';
import { requireAuth, truncate, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

/** Singular display name for each CRM collection. */
const COLLECTION_SINGULAR: Record<CrmCollection, string> = {
  contacts: 'Contact',
  activities: 'Activity',
  tasks: 'Task',
  deals: 'Deal',
  sequences: 'Sequence',
  customers: 'Customer',
  orders: 'Order',
  products: 'Product',
  coupons: 'Coupon',
  affiliates: 'Affiliate',
};

// ============================================================================
// REGISTER
// ============================================================================

export function registerCrmCommands(program: Command): void {
  const crm = program
    .command('crm')
    .description('Manage CRM entities (contacts, deals, orders, etc.)');

  // ── List ──────────────────────────────────────────────────────────────

  crm
    .command('list <collection>')
    .description('List entities in a CRM collection')
    .option('--status <status>', 'Filter by status')
    .option('--tag <tag>', 'Filter by tag')
    .option('--limit <n>', 'Max results', '50')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCrmCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown CRM collection "${collection}".`,
          suggestion: `Valid collections: ${CRM_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const limit = parseInt(opts.limit, 10);
        const entities = await listCrmEntities(auth.uid, collection as CrmCollection, {
          status: opts.status,
          tag: opts.tag,
          limit: isNaN(limit) || limit < 1 ? 50 : limit,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(entities, null, 2));
          return;
        }

        if (entities.length === 0) {
          console.log(`\n  No ${collection} found.`);
          console.log(`  Create one: myndhyve-cli crm create ${collection} --data '{"name": "..."}'`);
          console.log('');
          return;
        }

        console.log(`\n  ${capitalize(collection)} (${entities.length})\n`);
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

        console.log('');
      } catch (error) {
        printError(`Failed to list ${collection}`, error);
      }
    });

  // ── Get ───────────────────────────────────────────────────────────────

  crm
    .command('get <collection> <id>')
    .description('Get detailed information about a CRM entity')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCrmCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown CRM collection "${collection}".`,
          suggestion: `Valid collections: ${CRM_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entity = await getCrmEntity(auth.uid, collection as CrmCollection, id);

        if (!entity) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `${COLLECTION_SINGULAR[collection as CrmCollection]} "${id}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  ${COLLECTION_SINGULAR[collection as CrmCollection]}: ${entity.name}`);
        console.log('  ' + '\u2500'.repeat(50));

        // Print all fields except internal ones
        const skipFields = new Set(['collection']);
        for (const [key, value] of Object.entries(entity)) {
          if (skipFields.has(key)) continue;
          if (value === undefined || value === null) continue;

          const displayValue = typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);

          console.log(`  ${key.padEnd(18)} ${truncate(displayValue, 60)}`);
        }

        console.log('');
      } catch (error) {
        printError(`Failed to get ${collection} entity`, error);
      }
    });

  // ── Create ────────────────────────────────────────────────────────────

  crm
    .command('create <collection>')
    .description('Create a new CRM entity')
    .requiredOption('--data <json>', 'Entity data as JSON string')
    .option('--id <id>', 'Custom entity ID (auto-generated if not provided)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCrmCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown CRM collection "${collection}".`,
          suggestion: `Valid collections: ${CRM_COLLECTIONS.join(', ')}`,
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
          suggestion: 'Example: --data \'{"name": "Acme Corp", "email": "hello@acme.com"}\'',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        const entityId = opts.id || generateId();
        const entity = await createCrmEntity(
          auth.uid,
          collection as CrmCollection,
          entityId,
          data
        );

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Created ${COLLECTION_SINGULAR[collection as CrmCollection].toLowerCase()}:`);
        console.log(`  ID:   ${entity.id}`);
        console.log(`  Name: ${entity.name}`);
        console.log('');
      } catch (error) {
        printError(`Failed to create ${collection} entity`, error);
      }
    });

  // ── Update ────────────────────────────────────────────────────────────

  crm
    .command('update <collection> <id>')
    .description('Update a CRM entity')
    .requiredOption('--data <json>', 'Fields to update as JSON string')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (collection: string, id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCrmCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown CRM collection "${collection}".`,
          suggestion: `Valid collections: ${CRM_COLLECTIONS.join(', ')}`,
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
        const entity = await updateCrmEntity(
          auth.uid,
          collection as CrmCollection,
          id,
          data
        );

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Updated ${COLLECTION_SINGULAR[collection as CrmCollection].toLowerCase()} "${id}".`);
        console.log('');
      } catch (error) {
        printError(`Failed to update ${collection} entity`, error);
      }
    });

  // ── Delete ────────────────────────────────────────────────────────────

  crm
    .command('delete <collection> <id>')
    .description('Delete a CRM entity')
    .option('--force', 'Skip confirmation')
    .action(async (collection: string, id: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!isValidCrmCollection(collection)) {
        printErrorResult({
          code: 'INVALID_ARGUMENT',
          message: `Unknown CRM collection "${collection}".`,
          suggestion: `Valid collections: ${CRM_COLLECTIONS.join(', ')}`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      if (!opts.force) {
        // In a real CLI you'd use inquirer here for confirmation.
        // For now, require --force for safety.
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm deletion of ${COLLECTION_SINGULAR[collection as CrmCollection].toLowerCase()} "${id}".`,
          suggestion: `Note: Orders and activities have restricted deletion (audit trail).`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        await deleteCrmEntity(auth.uid, collection as CrmCollection, id);
        console.log(`\n  Deleted ${COLLECTION_SINGULAR[collection as CrmCollection].toLowerCase()} "${id}".`);
        console.log('');
      } catch (error) {
        printError(`Failed to delete ${collection} entity`, error);
      }
    });

  // ── Stats ─────────────────────────────────────────────────────────────

  crm
    .command('stats')
    .description('Show CRM overview statistics')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const stats = await getCrmStats(auth.uid);

        if (opts.format === 'json') {
          const formatted = Object.fromEntries(
            Object.entries(stats).map(([k, v]) => [k, v === -1 ? 'has_data' : 'empty'])
          );
          console.log(JSON.stringify(formatted, null, 2));
          return;
        }

        console.log('\n  CRM Overview\n');
        console.log('  ' + '\u2500'.repeat(30));
        console.log(`  Contacts:  ${stats.contacts === -1 ? 'Yes' : 'None'}`);
        console.log(`  Deals:     ${stats.deals === -1 ? 'Yes' : 'None'}`);
        console.log(`  Orders:    ${stats.orders === -1 ? 'Yes' : 'None'}`);
        console.log(`  Products:  ${stats.products === -1 ? 'Yes' : 'None'}`);
        console.log(`  Customers: ${stats.customers === -1 ? 'Yes' : 'None'}`);
        console.log('');
      } catch (error) {
        printError('Failed to get CRM stats', error);
      }
    });

  // ── Collections ───────────────────────────────────────────────────────

  crm
    .command('collections')
    .description('List available CRM collections')
    .action(() => {
      console.log('\n  Available CRM Collections\n');
      console.log('  ' + '\u2500'.repeat(40));
      for (const col of CRM_COLLECTIONS) {
        console.log(`  ${col}`);
      }
      console.log('');
      console.log('  Usage: myndhyve-cli crm list <collection>');
      console.log('');
    });
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

function generateId(): string {
  return randomBytes(10).toString('hex');
}
