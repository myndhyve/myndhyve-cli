/**
 * MyndHyve CLI — Hyve Commands
 *
 * Commander subcommand group for hyve management and context:
 *   myndhyve-cli hyves list
 *   myndhyve-cli hyves info <hyve-id>
 *   myndhyve-cli hyves docs [--hyve=<hyveId>]
 *   myndhyve-cli use <project-id>
 *   myndhyve-cli whoami
 */

import type { Command } from 'commander';
import { getAuthStatus } from '../auth/index.js';
import {
  listSystemHyves,
  getSystemHyve,
  listHyveDocuments,
} from '../api/hyves.js';
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

export function registerHyveCommands(program: Command): void {
  const hyves = program
    .command('hyves')
    .description('Explore MyndHyve system hyves (app templates)');

  // ── List ──────────────────────────────────────────────────────────────

  hyves
    .command('list')
    .description('List available system hyves')
    .option('--all', 'Include internal-visibility hyves')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((opts) => {
      const hyveList = listSystemHyves(opts.all);

      if (opts.format === 'json') {
        console.log(JSON.stringify(hyveList, null, 2));
        return;
      }

      console.log(`\n  System Hyves (${hyveList.length})\n`);
      console.log(
        '  ' +
          'ID'.padEnd(18) +
          'Name'.padEnd(22) +
          'Description'
      );
      console.log('  ' + '\u2500'.repeat(90));

      for (const hyve of hyveList) {
        console.log(
          '  ' +
            hyve.hyveId.padEnd(18) +
            hyve.name.padEnd(22) +
            truncate(hyve.description, 50)
        );
      }

      console.log('');
    });

  // ── Info ──────────────────────────────────────────────────────────────

  hyves
    .command('info <hyve-id>')
    .description('Show detailed information about a system hyve')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action((hyveId: string, opts) => {
      const hyve = getSystemHyve(hyveId);

      if (!hyve) {
        printErrorResult({
          code: 'NOT_FOUND',
          message: `Unknown hyve "${hyveId}".`,
          suggestion: 'Run `myndhyve-cli hyves list` to see available hyves.',
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(hyve, null, 2));
        return;
      }

      console.log(`\n  ${hyve.name}`);
      console.log('  ' + '\u2500'.repeat(50));
      console.log(`  ID:          ${hyve.hyveId}`);
      console.log(`  Description: ${hyve.description}`);
      console.log(`  Icon:        ${hyve.icon}`);
      console.log(`  Visibility:  ${hyve.visibility}`);
      console.log(`  Color:       ${hyve.primaryColor}`);
      console.log(`  Tags:        ${hyve.tags.join(', ')}`);
      console.log('');
      console.log(`  Create a project: myndhyve-cli projects create "My Project" --hyve=${hyve.hyveId}`);
      console.log('');
    });

  // ── Docs ──────────────────────────────────────────────────────────────

  hyves
    .command('docs')
    .description('List your hyve documents (work items within system hyves)')
    .option('--hyve <hyveId>', 'Filter by hyve type')
    .option('--pinned', 'Show only pinned documents')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const docs = await listHyveDocuments(auth.uid, {
          hyveId: opts.hyve,
          pinned: opts.pinned || undefined,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(docs, null, 2));
          return;
        }

        if (docs.length === 0) {
          console.log('\n  No hyve documents found.');
          console.log('  Create a project first, or open the web app to create documents.\n');
          return;
        }

        console.log(`\n  Hyve Documents (${docs.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(28) +
            'Hyve'.padEnd(18) +
            'Status'.padEnd(12) +
            'Pinned'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const doc of docs) {
          const hyve = getSystemHyve(doc.hyveId);
          const hyveName = hyve?.name || doc.hyveId;
          const pinnedIcon = doc.pinned ? '\u2605' : '';

          console.log(
            '  ' +
              doc.id.padEnd(24) +
              truncate(doc.name, 26).padEnd(28) +
              truncate(hyveName, 16).padEnd(18) +
              doc.status.padEnd(12) +
              pinnedIcon
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list hyve documents', error);
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

        const hyve = getSystemHyve(project.hyveId);

        setActiveContext({
          projectId: project.id,
          projectName: project.name,
          hyveId: project.hyveId,
          hyveName: hyve?.name,
        });

        console.log(`\n  Active project set:`);
        console.log(`  Project: ${project.name}`);
        console.log(`  ID:      ${project.id}`);
        console.log(`  Hyve:    ${hyve?.name || project.hyveId}\n`);
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
        console.log(`  Project:  ${context.projectName}`);
        console.log(`  ID:       ${context.projectId}`);
        console.log(`  Hyve:     ${context.hyveName || context.hyveId}`);
      } else {
        console.log('  No active project. Run `myndhyve-cli use <project-id>` to set one.');
      }

      console.log('');
    });
}
