/**
 * MyndHyve CLI — Canvas Type Commands
 *
 * Commander subcommand group for canvas type management and context:
 *   myndhyve-cli canvas-types list
 *   myndhyve-cli canvas-types info <canvas-type-id>
 *   myndhyve-cli canvas-types docs [--canvas-type=<canvasTypeId>]
 *   myndhyve-cli use <project-id>
 *   myndhyve-cli whoami
 */

import type { Command } from 'commander';
import { getAuthStatus } from '../auth/index.js';
import {
  listCanvasTypes,
  getCanvasType,
  listCanvases,
} from '../api/canvasTypes.js';
import { getProject } from '../api/projects.js';
import {
  getActiveContext,
  setActiveContext,
  clearActiveContext,
} from '../context.js';
import {
  requireAuth,
  truncate,
  printError,
} from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerCanvasTypeCommands(program: Command): void {
  const canvasTypes = program
    .command('canvas-types')
    .description('Explore MyndHyve canvas types');

  // ── List ──────────────────────────────────────────────────────────────

  canvasTypes
    .command('list')
    .description('List available canvas types')
    .option('--all', 'Include internal-visibility canvas types')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((opts) => {
      const canvasTypeList = listCanvasTypes(opts.all);

      if (opts.format === 'json') {
        console.log(JSON.stringify(canvasTypeList, null, 2));
        return;
      }

      console.log(`\n  Canvas Types (${canvasTypeList.length})\n`);
      console.log(
        '  ' +
          'ID'.padEnd(18) +
          'Name'.padEnd(22) +
          'Description'
      );
      console.log('  ' + '\u2500'.repeat(90));

      for (const canvasType of canvasTypeList) {
        console.log(
          '  ' +
            canvasType.canvasTypeId.padEnd(18) +
            canvasType.name.padEnd(22) +
            truncate(canvasType.description, 50)
        );
      }

      console.log('');
    });

  // ── Info ──────────────────────────────────────────────────────────────

  canvasTypes
    .command('info <canvas-type-id>')
    .description('Show detailed information about a canvas type')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((canvasTypeId: string, opts) => {
      const canvasType = getCanvasType(canvasTypeId);

      if (!canvasType) {
        printErrorResult({
          code: 'NOT_FOUND',
          message: `Unknown canvas type "${canvasTypeId}".`,
          suggestion: 'Run `myndhyve-cli canvas-types list` to see available canvas types.',
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(canvasType, null, 2));
        return;
      }

      console.log(`\n  ${canvasType.name}`);
      console.log('  ' + '\u2500'.repeat(50));
      console.log(`  ID:          ${canvasType.canvasTypeId}`);
      console.log(`  Description: ${canvasType.description}`);
      console.log(`  Icon:        ${canvasType.icon}`);
      console.log(`  Visibility:  ${canvasType.visibility}`);
      console.log(`  Color:       ${canvasType.primaryColor}`);
      console.log(`  Tags:        ${canvasType.tags.join(', ')}`);
      console.log('');
      console.log(`  Create a project: myndhyve-cli projects create "My Project" --canvas-type=${canvasType.canvasTypeId}`);
      console.log('');
    });

  // ── Docs ──────────────────────────────────────────────────────────────

  canvasTypes
    .command('docs')
    .description('List your canvases (work items within canvas types)')
    .option('--canvas-type <canvasTypeId>', 'Filter by canvas type')
    .option('--pinned', 'Show only pinned documents')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const docs = await listCanvases(auth.uid, {
          canvasTypeId: opts.canvasType,
          pinned: opts.pinned || undefined,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(docs, null, 2));
          return;
        }

        if (docs.length === 0) {
          console.log('\n  No canvases found.');
          console.log('  Create a project first, or open the web app to create documents.\n');
          return;
        }

        console.log(`\n  Canvases (${docs.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(28) +
            'Canvas Type'.padEnd(18) +
            'Status'.padEnd(12) +
            'Pinned'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const doc of docs) {
          const canvasType = getCanvasType(doc.canvasTypeId);
          const canvasTypeName = canvasType?.name || doc.canvasTypeId;
          const pinnedIcon = doc.pinned ? '\u2605' : '';

          console.log(
            '  ' +
              doc.id.padEnd(24) +
              truncate(doc.name, 26).padEnd(28) +
              truncate(canvasTypeName, 16).padEnd(18) +
              doc.status.padEnd(12) +
              pinnedIcon
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list canvases', error);
      }
    });
}

/**
 * Register the `use`, `unuse`, and `whoami` top-level commands.
 */
export function registerContextCommands(program: Command): void {
  // ── Use (Set Active Project) ──────────────────────────────────────────

  program
    .command('use <project-id>')
    .description('Set the active project for subsequent commands')
    .action(async (projectId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        // Fetch the project to validate it exists and get details
        const project = await getProject(projectId);

        if (!project) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Project "${projectId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        // Verify ownership
        if (project.ownerId !== auth.uid) {
          printErrorResult({
            code: 'UNAUTHORIZED',
            message: `You do not own project "${projectId}".`,
          });
          process.exitCode = ExitCode.UNAUTHORIZED;
          return;
        }

        const canvasType = getCanvasType(project.canvasTypeId);

        setActiveContext({
          projectId: project.id,
          projectName: project.name,
          canvasTypeId: project.canvasTypeId,
          canvasTypeName: canvasType?.name,
        });

        console.log(`\n  Active project set:`);
        console.log(`  Project:      ${project.name}`);
        console.log(`  ID:           ${project.id}`);
        console.log(`  Canvas Type:  ${canvasType?.name || project.canvasTypeId}\n`);
      } catch (error) {
        printError('Failed to set active project', error);
      }
    });

  // ── Unuse (Clear Active Project) ──────────────────────────────────────

  program
    .command('unuse')
    .description('Clear the active project')
    .action(() => {
      clearActiveContext();
      console.log('\n  Active project cleared.\n');
    });

  // ── Whoami ────────────────────────────────────────────────────────────

  program
    .command('whoami')
    .description('Show current user and active project')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((opts) => {
      const auth = getAuthStatus();
      const context = getActiveContext();

      if (opts.format === 'json') {
        console.log(
          JSON.stringify(
            {
              auth: {
                authenticated: auth.authenticated,
                email: auth.email,
                uid: auth.uid,
                source: auth.source,
                expired: auth.expired,
              },
              activeProject: context,
            },
            null,
            2
          )
        );
        return;
      }

      console.log('');

      // Auth info
      if (auth.authenticated) {
        console.log(`  User:     ${auth.email || '(env token)'}`);
        if (auth.uid) console.log(`  UID:      ${auth.uid}`);
        console.log(`  Auth:     ${auth.source === 'env' ? 'MYNDHYVE_TOKEN' : 'credentials'}`);

        if (auth.expired) {
          console.log('  Status:   Expired (run `myndhyve-cli auth login` to refresh)');
        } else {
          console.log('  Status:   Active');
        }
      } else {
        console.log('  Not authenticated. Run `myndhyve-cli auth login` to sign in.');
      }

      // Active project
      console.log('');
      if (context) {
        console.log(`  Project:      ${context.projectName}`);
        console.log(`  ID:           ${context.projectId}`);
        console.log(`  Canvas Type:  ${context.canvasTypeName || context.canvasTypeId}`);
      } else {
        console.log('  No active project. Run `myndhyve-cli use <project-id>` to set one.');
      }

      console.log('');
    });
}
