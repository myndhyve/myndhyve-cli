/**
 * MyndHyve CLI — Entity Commands
 *
 * Commander subcommand group for entity management:
 *   myndhyve-cli entities list <entity-type-id>
 *   myndhyve-cli entities get <entity-type-id> <entity-id>
 *   myndhyve-cli entities create <entity-type-id> --title <t> --data <json>
 *   myndhyve-cli entities update <entity-type-id> <entity-id> --data <json>
 *   myndhyve-cli entities delete <entity-type-id> <entity-id>
 *   myndhyve-cli entities export <entity-type-id>
 *   myndhyve-cli entities import <entity-type-id> --file <path>
 */

import type { Command } from 'commander';
import {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  exportEntities,
  importEntities,
} from '../api/entities.js';
import { getActiveContext } from '../context.js';
import {
  requireAuth,
  formatRelativeTime,
  formatTableRow,
  printError,
} from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerEntityCommands(program: Command): void {
  const entities = program
    .command('entities')
    .description('Manage structured entities within projects')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli entities list products
  $ myndhyve-cli entities get products prod-123
  $ myndhyve-cli entities create products --title "Widget" --data '{"price":9.99}'
  $ myndhyve-cli entities export products --output products.json
  $ myndhyve-cli entities import products --file products.json`);

  // ── List ────────────────────────────────────────────────────────────

  entities
    .command('list <entity-type-id>')
    .description('List entities of a given type')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .option('--status <status>', 'Filter by status (draft, published, archived)')
    .option('--search <query>', 'Full-text search')
    .option('--page <page>', 'Page number', '1')
    .option('--limit <limit>', 'Results per page', '20')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (entityTypeId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading entities...', stream: process.stderr }).start();

      try {
        const result = await listEntities(projectId, entityTypeId, {
          status: opts.status,
          search: opts.search,
          page: parseInt(opts.page, 10),
          limit: parseInt(opts.limit, 10),
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.data.length === 0) {
          console.log(`\n  No ${entityTypeId} entities found.\n`);
          return;
        }

        const { pagination } = result;
        console.log(`\n  ${entityTypeId} (${pagination.total} total, page ${pagination.page}/${pagination.totalPages})\n`);

        const cols: Array<[string, number]> = [
          ['ID', 24],
          ['Title', 30],
          ['Status', 12],
          ['Updated', 14],
        ];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(80, (process.stdout.columns || 80) - 4)));

        for (const entity of result.data) {
          console.log(formatTableRow([
            [entity.id, 24],
            [entity.title, 30],
            [entity.status, 12],
            [formatRelativeTime(entity.updatedAt), 14],
          ]));
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to list entities', error);
      }
    });

  // ── Get ─────────────────────────────────────────────────────────────

  entities
    .command('get <entity-type-id> <entity-id>')
    .description('Show details of a specific entity')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (entityTypeId: string, entityId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading entity...', stream: process.stderr }).start();

      try {
        const entity = await getEntity(projectId, entityTypeId, entityId);
        spinner.stop();

        if (!entity) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Entity "${entityId}" not found in ${entityTypeId}.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  ${entityTypeId}: ${entity.title}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ID:       ${entity.id}`);
        console.log(`  Slug:     ${entity.slug}`);
        console.log(`  Status:   ${entity.status}`);
        console.log(`  Created:  ${formatRelativeTime(entity.createdAt)}`);
        console.log(`  Updated:  ${formatRelativeTime(entity.updatedAt)}`);

        if (entity.data && Object.keys(entity.data).length > 0) {
          console.log('');
          console.log('  Data:');
          for (const [key, value] of Object.entries(entity.data)) {
            const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
            console.log(`    ${key}: ${display}`);
          }
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to get entity', error);
      }
    });

  // ── Create ──────────────────────────────────────────────────────────

  entities
    .command('create <entity-type-id>')
    .description('Create a new entity')
    .requiredOption('--title <title>', 'Entity title')
    .option('--data <json>', 'Entity data as JSON')
    .option('--status <status>', 'Initial status (draft, published)', 'draft')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (entityTypeId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      let data: Record<string, unknown> = {};
      if (opts.data) {
        try {
          data = JSON.parse(opts.data);
        } catch {
          printErrorResult({
            code: 'INVALID_JSON',
            message: 'Failed to parse --data JSON.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Creating entity...', stream: process.stderr }).start();

      try {
        const entity = await createEntity(projectId, entityTypeId, {
          title: opts.title,
          data,
          status: opts.status,
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Entity created!`);
        console.log(`  ID:     ${entity.id}`);
        console.log(`  Title:  ${entity.title}`);
        console.log(`  Slug:   ${entity.slug}`);
        console.log(`  Status: ${entity.status}\n`);
      } catch (error) {
        spinner.stop();
        printError('Failed to create entity', error);
      }
    });

  // ── Update ──────────────────────────────────────────────────────────

  entities
    .command('update <entity-type-id> <entity-id>')
    .description('Update an existing entity')
    .option('--title <title>', 'New title')
    .option('--data <json>', 'Updated data as JSON (merged with existing)')
    .option('--status <status>', 'New status')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (entityTypeId: string, entityId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      const updates: Record<string, unknown> = {};
      if (opts.title) updates.title = opts.title;
      if (opts.status) updates.status = opts.status;

      if (opts.data) {
        try {
          updates.data = JSON.parse(opts.data);
        } catch {
          printErrorResult({
            code: 'INVALID_JSON',
            message: 'Failed to parse --data JSON.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }
      }

      if (Object.keys(updates).length === 0) {
        printErrorResult({
          code: 'NO_CHANGES',
          message: 'No update fields provided.',
          suggestion: 'Use --title, --data, or --status to specify changes.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Updating entity...', stream: process.stderr }).start();

      try {
        const entity = await updateEntity(projectId, entityTypeId, entityId, updates);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
          return;
        }

        console.log(`\n  Entity updated!`);
        console.log(`  ID:     ${entity.id}`);
        console.log(`  Title:  ${entity.title}`);
        console.log(`  Status: ${entity.status}\n`);
      } catch (error) {
        spinner.stop();
        printError('Failed to update entity', error);
      }
    });

  // ── Delete ──────────────────────────────────────────────────────────

  entities
    .command('delete <entity-type-id> <entity-id>')
    .description('Delete an entity')
    .option('--force', 'Skip confirmation prompt')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .action(async (entityTypeId: string, entityId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      if (!opts.force) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`\n  Delete ${entityTypeId}/${entityId}? This cannot be undone. [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('  Cancelled.\n');
          return;
        }
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Deleting entity...', stream: process.stderr }).start();

      try {
        await deleteEntity(projectId, entityTypeId, entityId);
        spinner.stop();
        console.log(`\n  Entity "${entityId}" deleted.\n`);
      } catch (error) {
        spinner.stop();
        printError('Failed to delete entity', error);
      }
    });

  // ── Export ──────────────────────────────────────────────────────────

  entities
    .command('export <entity-type-id>')
    .description('Export all entities of a type')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .option('--output <file>', 'Write to file instead of stdout')
    .action(async (entityTypeId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Exporting entities...', stream: process.stderr }).start();

      try {
        const data = await exportEntities(projectId, entityTypeId);
        spinner.stop();

        const json = JSON.stringify(data, null, 2);

        if (opts.output) {
          const fs = await import('node:fs');
          fs.writeFileSync(opts.output, json, 'utf-8');
          console.log(`\n  Exported ${Array.isArray(data) ? data.length : '?'} entities to ${opts.output}\n`);
        } else {
          process.stdout.write(json + '\n');
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to export entities', error);
      }
    });

  // ── Import ──────────────────────────────────────────────────────────

  entities
    .command('import <entity-type-id>')
    .description('Import entities from a JSON file')
    .requiredOption('--file <path>', 'Path to JSON file containing an array of entities')
    .option('--project <projectId>', 'Project ID (uses active project if not set)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (entityTypeId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const projectId = resolveProjectId(opts.project);
      if (!projectId) return;

      let data: unknown[];
      try {
        const fs = await import('node:fs');
        const content = fs.readFileSync(opts.file, 'utf-8');
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
          throw new Error('Expected a JSON array of entities.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printErrorResult({
          code: 'INVALID_FILE',
          message: `Failed to read import file: ${message}`,
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: `Importing ${data.length} entities...`, stream: process.stderr }).start();

      try {
        const result = await importEntities(projectId, entityTypeId, data);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`\n  Import complete!`);
        console.log(`  Imported: ${result.imported}`);
        if (result.errors > 0) {
          console.log(`  Errors:   ${result.errors}`);
        }
        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to import entities', error);
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

function resolveProjectId(explicit?: string): string | null {
  if (explicit) return explicit;

  const context = getActiveContext();
  if (context?.projectId) return context.projectId;

  printErrorResult({
    code: 'NO_PROJECT',
    message: 'No project specified.',
    suggestion: 'Use --project <id> or set an active project with: myndhyve-cli use <project-id>',
  });
  process.exitCode = ExitCode.USAGE_ERROR;
  return null;
}
