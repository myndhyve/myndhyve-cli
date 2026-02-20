/**
 * MyndHyve CLI — Project Commands
 *
 * Commander subcommand group for project management:
 *   myndhyve-cli projects list
 *   myndhyve-cli projects create <name> --hyve=<hyveId>
 *   myndhyve-cli projects info <project-id>
 *   myndhyve-cli projects open <project-id>
 *   myndhyve-cli projects delete <project-id>
 */

import type { Command } from 'commander';
import {
  listProjects,
  getProject,
  createProject,
  deleteProjectById,
} from '../api/projects.js';
import { listSystemHyves, getSystemHyve, isValidSystemHyveId } from '../api/hyves.js';
import { setActiveContext } from '../context.js';
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

export function registerProjectCommands(program: Command): void {
  const projects = program
    .command('projects')
    .description('Manage MyndHyve projects')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli projects list
  $ myndhyve-cli projects create "My App" --hyve=app-builder
  $ myndhyve-cli projects info <project-id>
  $ myndhyve-cli projects delete <project-id>`);

  // ── List ─────────────────────────────────────────────────────────────

  projects
    .command('list')
    .description('List all your projects')
    .option('--hyve <hyveId>', 'Filter by hyve type')
    .option('--status <status>', 'Filter by status (draft, in_progress, completed)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading projects...', stream: process.stderr }).start();

      try {
        const results = await listProjects(auth.uid, {
          hyveId: opts.hyve,
          status: opts.status,
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log('\n  No projects found.');
          console.log('  Create one with: myndhyve-cli projects create "My Project" --hyve=app-builder\n');
          return;
        }

        console.log(`\n  Projects (${results.length})\n`);
        const cols: Array<[string, number]> = [['ID', 24], ['Name', 30], ['Hyve', 18], ['Status', 14], ['Updated', 14]];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(100, (process.stdout.columns || 100) - 4)));

        for (const proj of results) {
          const hyve = getSystemHyve(proj.hyveId);
          const hyveName = hyve?.name || proj.hyveId;
          const updated = proj.updatedAt
            ? formatRelativeTime(proj.updatedAt)
            : '\u2014';

          console.log(formatTableRow([
            [proj.id, 24],
            [proj.name, 30],
            [hyveName, 18],
            [proj.status, 14],
            [updated, 14],
          ]));
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to list projects', error);
      }
    });

  // ── Create ───────────────────────────────────────────────────────────

  projects
    .command('create <name>')
    .description('Create a new project')
    .requiredOption('--hyve <hyveId>', 'Hyve type (e.g., app-builder, landing-page)')
    .option('--description <desc>', 'Project description')
    .option('--type <type>', 'Project type (general, app, design, etc.)', 'general')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--use', 'Set as active project after creation')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (name: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Validate hyve ID
      if (!isValidSystemHyveId(opts.hyve)) {
        const available = listSystemHyves().map((h) => h.hyveId).join(', ');
        printErrorResult({
          code: 'INVALID_HYVE',
          message: `Unknown hyve "${opts.hyve}".`,
          suggestion: `Available hyves: ${available}. Run \`myndhyve-cli hyves list\` to see all options.`,
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }

      try {
        const tags = opts.tags
          ? opts.tags.split(',').map((t: string) => t.trim())
          : undefined;

        const project = await createProject(auth.uid, {
          name,
          hyveId: opts.hyve,
          description: opts.description,
          type: opts.type,
          tags,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(project, null, 2));
        } else {
          const hyve = getSystemHyve(opts.hyve);
          console.log(`\n  Project created successfully!`);
          console.log(`  ID:    ${project.id}`);
          console.log(`  Name:  ${project.name}`);
          console.log(`  Hyve:  ${hyve?.name || opts.hyve}`);
          console.log(`  Slug:  ${project.slug}`);
        }

        // Optionally set as active project
        if (opts.use) {
          const hyve = getSystemHyve(opts.hyve);
          setActiveContext({
            projectId: project.id,
            projectName: project.name,
            hyveId: opts.hyve,
            hyveName: hyve?.name,
          });
          console.log(`  Active: Yes (set as current project)`);
        }

        if (opts.format !== 'json') {
          console.log('');
        }
      } catch (error) {
        printError('Failed to create project', error);
      }
    });

  // ── Info ──────────────────────────────────────────────────────────────

  projects
    .command('info <project-id>')
    .description('Show detailed project information')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (projectId: string, opts) => {
      requireAuth();

      try {
        const project = await getProject(projectId);

        if (!project) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Project "${projectId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(project, null, 2));
          return;
        }

        const hyve = getSystemHyve(project.hyveId);
        const metadata = project.metadata as Record<string, unknown>;

        console.log(`\n  Project: ${project.name}`);
        console.log('  ' + '─'.repeat(50));
        console.log(`  ID:            ${project.id}`);
        console.log(`  Slug:          ${project.slug}`);
        console.log(`  Hyve:          ${hyve?.name || project.hyveId}`);
        console.log(`  Type:          ${project.type}`);
        console.log(`  Status:        ${project.status}`);

        if (project.description) {
          console.log(`  Description:   ${project.description}`);
        }

        if (project.tags && project.tags.length > 0) {
          console.log(`  Tags:          ${project.tags.join(', ')}`);
        }

        console.log('');
        console.log(`  Visibility:    ${metadata.visibility || 'private'}`);
        console.log(`  Documents:     ${metadata.documentCount || 0}`);
        console.log(`  Workflows:     ${metadata.workflowCount || 0}`);
        console.log(`  Artifacts:     ${metadata.artifactCount || 0}`);
        console.log(`  Collaborators: ${project.collaboratorIds.length}`);

        if (typeof metadata.createdAt === 'string') {
          console.log(`  Created:       ${formatRelativeTime(metadata.createdAt)}`);
        }
        if (typeof metadata.updatedAt === 'string') {
          console.log(`  Updated:       ${formatRelativeTime(metadata.updatedAt)}`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to get project info', error);
      }
    });

  // ── Open ─────────────────────────────────────────────────────────────

  projects
    .command('open <project-id>')
    .description('Open project in the web browser')
    .action(async (projectId: string) => {
      requireAuth();

      try {
        const project = await getProject(projectId);

        if (!project) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Project "${projectId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        const hyve = getSystemHyve(project.hyveId);
        const url = `https://app.myndhyve.com/hyve/${project.hyveId}/docs/${project.id}`;

        console.log(`\n  Opening "${project.name}" (${hyve?.name || project.hyveId})...`);
        console.log(`  URL: ${url}\n`);

        // Open in default browser (execFile avoids shell injection)
        const { execFile } = await import('node:child_process');
        const openCmd =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open';
        execFile(openCmd, [url]);
      } catch (error) {
        printError('Failed to open project', error);
      }
    });

  // ── Delete ───────────────────────────────────────────────────────────

  projects
    .command('delete <project-id>')
    .description('Delete a project (with confirmation)')
    .option('--force', 'Skip confirmation prompt')
    .action(async (projectId: string, opts) => {
      requireAuth();

      try {
        // Get project info first
        const project = await getProject(projectId);

        if (!project) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Project "${projectId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        // Confirm unless --force
        if (!opts.force) {
          const metadata = project.metadata as Record<string, unknown>;
          console.log(`\n  About to delete project "${project.name}":`);
          console.log(`    - ${metadata.documentCount || 0} documents`);
          console.log(`    - ${metadata.workflowCount || 0} workflows`);
          console.log(`    - ${metadata.artifactCount || 0} artifacts`);
          console.log(`    - ${project.collaboratorIds.length} collaborator(s)`);

          const readline = await import('node:readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question(
              `\n  This cannot be undone. Delete? [y/N] `,
              resolve
            );
          });

          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log('  Cancelled.\n');
            return;
          }
        }

        await deleteProjectById(projectId);
        console.log(`\n  Project "${project.name}" deleted.\n`);
      } catch (error) {
        printError('Failed to delete project', error);
      }
    });
}
