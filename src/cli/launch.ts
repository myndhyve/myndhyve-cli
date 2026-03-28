/**
 * MyndHyve CLI — Launch Studio Commands
 */

import type { Command } from 'commander';
import {
  listLaunchStudios,
  getLaunchStudio,
  createLaunchStudio,
  deleteLaunchStudio,
  FLOW_TEMPLATES,
  type BuiltInFlowTemplateId,
} from '../api/launch-studios.js';
import { requireAuth, formatRelativeTime, formatTableRow, printError } from './helpers.js';
import { ExitCode } from '../utils/output.js';
import chalk from 'chalk';

export function registerLaunchCommands(program: Command): void {
  const launch = program
    .command('launch')
    .description('Manage Launch Studios — AI startup launch orchestration');

  launch.command('list').description('List all Launch Studios').action(async () => {
    const auth = requireAuth();
    if (!auth) return;
    try {
      const studios = await listLaunchStudios(auth.uid);
      if (studios.length === 0) { console.log(chalk.dim('No Launch Studios found.')); return; }
      console.log(chalk.bold(`Launch Studios (${studios.length}):\n`));
      console.log(formatTableRow([["ID", 20], ["Name", 25], ["Flow", 18], ["Status", 10], ["Steps", 8], ["Updated", 15]]));
      console.log(chalk.dim('─'.repeat(100)));
      for (const s of studios) {
        const done = (s.steps ?? []).filter((st: { status: string }) => st.status === 'completed').length;
        const total = (s.steps ?? []).length;
        console.log(formatTableRow([[s.id, 20], [s.name, 25], [s.flowTemplateId, 18], [s.status, 10], [`${done}/${total}`, 8], [formatRelativeTime(s.updatedAt), 15]]));
      }
    } catch (err) { printError('Failed to list Launch Studios', err); process.exitCode = ExitCode.GENERAL_ERROR; }
  });

  launch.command('start').description('Create a new Launch Studio')
    .requiredOption('--flow <template>', 'Flow template ID')
    .requiredOption('--name <name>', 'Studio name')
    .option('--description <desc>', 'Description')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;
      const flowId = opts.flow as BuiltInFlowTemplateId;
      const template = FLOW_TEMPLATES.find((t) => t.id === flowId);
      if (!template) { printError('Unknown flow template', flowId); process.exitCode = ExitCode.USAGE_ERROR; return; }
      try {
        const studio = await createLaunchStudio(auth.uid, { name: opts.name, flowTemplateId: flowId, description: opts.description });
        console.log(chalk.green('✓') + ` Created: ${chalk.bold(studio.name)} (${studio.id})`);
        console.log(chalk.dim(`  Flow: ${template.name} — ${template.canvasTypeIds.join(' → ')}`));
      } catch (err) { printError('Failed to create Launch Studio', err); process.exitCode = ExitCode.GENERAL_ERROR; }
    });

  launch.command('status [studio-id]').description('Show Launch Studio status').action(async (studioId?: string) => {
    const auth = requireAuth();
    if (!auth) return;
    if (!studioId) {
      const studios = await listLaunchStudios(auth.uid);
      console.log(chalk.bold('Launch Studio Status'));
      console.log(`  Total: ${studios.length}  Active: ${studios.filter((s) => s.status === 'active').length}  Draft: ${studios.filter((s) => s.status === 'draft').length}`);
      return;
    }
    try {
      const studio = await getLaunchStudio(auth.uid, studioId);
      if (!studio) { printError('Launch Studio not found', studioId); process.exitCode = ExitCode.NOT_FOUND; return; }
      console.log(chalk.bold(studio.name) + chalk.dim(` (${studio.status})`));
      if (studio.prdId) console.log(`  PRD: ${chalk.green('✓')}`);
      if (studio.brandId) console.log(`  Brand: ${chalk.green('✓')}`);
      if (studio.boardId) console.log(`  Kanban: ${chalk.green('✓')}`);
      for (const step of studio.steps ?? []) {
        const icon = step.status === 'completed' ? chalk.green('✓') : step.status === 'in_progress' ? chalk.yellow('→') : chalk.dim('○');
        console.log(`  ${icon} ${step.canvasTypeId} (${step.status})`);
      }
    } catch (err) { printError('Operation failed', err); process.exitCode = ExitCode.GENERAL_ERROR; }
  });

  launch.command('artifacts <studio-id>').description('List shared artifacts').action(async (studioId: string) => {
    const auth = requireAuth();
    if (!auth) return;
    try {
      const studio = await getLaunchStudio(auth.uid, studioId);
      if (!studio) { printError('Launch Studio not found', studioId); process.exitCode = ExitCode.NOT_FOUND; return; }
      const refs = studio.sharedArtifactRefs ?? [];
      if (refs.length === 0) { console.log(chalk.dim('No shared artifacts yet.')); return; }
      console.log(chalk.bold(`Shared Artifacts (${refs.length}):\n`));
      for (const ref of refs) console.log(`  ${ref.artifactTypeId.padEnd(15)} ${ref.label ?? ref.artifactId} ${chalk.dim(`(${ref.sourceCanvasTypeId})`)}`);
    } catch (err) { printError('Operation failed', err); process.exitCode = ExitCode.GENERAL_ERROR; }
  });

  launch.command('delete <studio-id>').description('Delete a Launch Studio').action(async (studioId: string) => {
    const auth = requireAuth();
    if (!auth) return;
    try { await deleteLaunchStudio(auth.uid, studioId); console.log(chalk.green('✓') + ` Deleted: ${studioId}`); }
    catch (err) { printError('Operation failed', err); process.exitCode = ExitCode.GENERAL_ERROR; }
  });

  launch.command('templates').description('List available flow templates').action(() => {
    console.log(chalk.bold('Available Flow Templates:\n'));
    for (const t of FLOW_TEMPLATES) {
      console.log(`  ${chalk.cyan(t.id.padEnd(20))} ${t.name}`);
      console.log(`  ${' '.repeat(20)} ${chalk.dim(t.description)}`);
      console.log(`  ${' '.repeat(20)} ${chalk.dim(`Best for: ${t.bestFor}`)}\n`);
    }
  });
}
