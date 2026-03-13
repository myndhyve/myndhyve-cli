/**
 * MyndHyve CLI — Prompts Command
 *
 * List and inspect system prompts from the Prompt API.
 *
 * Usage:
 *   myndhyve-cli prompts list [--canvas-type <id>] [--category <cat>]
 *   myndhyve-cli prompts get <promptId>
 */

import { Command } from 'commander';
import type { ChalkInstance } from 'chalk';

interface PromptListOptions {
  canvasType?: string;
  category?: string;
}

async function listPromptsCommand(options: PromptListOptions): Promise<void> {
  const chalk: ChalkInstance = (await import('chalk')).default;

  try {
    const { listSystemPrompts } = await import('../api/prompts.js');
    const prompts = await listSystemPrompts({
      canvasTypeId: options.canvasType,
      category: options.category,
    });

    if (prompts.length === 0) {
      console.log(chalk.yellow('No system prompts found.'));
      return;
    }

    console.log(chalk.bold(`\n  System Prompts (${prompts.length})\n`));

    for (const p of prompts) {
      const canvasTypeLabel = p.canvasTypeId === '*' ? chalk.dim('(global)') : chalk.cyan(p.canvasTypeId);
      console.log(
        `  ${chalk.bold(p.id)} ${canvasTypeLabel} ${chalk.dim(`v${p.version}`)}`
      );
      if (p.description) {
        console.log(`    ${chalk.dim(p.description)}`);
      }
    }
    console.log();
  } catch (err) {
    console.error(
      chalk.red(
        `Failed to list prompts: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    process.exitCode = 1;
  }
}

async function getPromptCommand(promptId: string): Promise<void> {
  const chalk: ChalkInstance = (await import('chalk')).default;

  try {
    const { getSystemPrompt } = await import('../api/prompts.js');
    const prompt = await getSystemPrompt(promptId);

    if (!prompt) {
      console.error(chalk.red(`Prompt '${promptId}' not found.`));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.bold(`\n  ${prompt.name}`));
    console.log(`  ${chalk.dim(prompt.description || '')}`);
    console.log();
    console.log(`  ID:       ${prompt.id}`);
    console.log(`  Canvas Type: ${prompt.canvasTypeId}`);
    console.log(`  Category: ${prompt.category}`);
    console.log(`  Version:  ${prompt.version}`);
    console.log(`  Active:   ${prompt.isActive ? chalk.green('yes') : chalk.red('no')}`);
    if (prompt.customizedAt) {
      console.log(`  Custom:   ${chalk.yellow('yes')} (${prompt.customizedAt})`);
    }
    console.log(`  Updated:  ${prompt.updatedAt}`);

    if (prompt.tags.length > 0) {
      console.log(`  Tags:     ${prompt.tags.map((t) => chalk.cyan(t)).join(', ')}`);
    }

    if (prompt.templateText) {
      console.log(chalk.bold('\n  Template Text:\n'));
      // Indent each line for readability
      const lines = prompt.templateText.split('\n');
      for (const line of lines) {
        console.log(`  ${chalk.dim(line)}`);
      }
    } else if (prompt.templateSections) {
      console.log(chalk.bold('\n  Template Sections:\n'));
      for (const [key, value] of Object.entries(prompt.templateSections)) {
        console.log(`  ${chalk.cyan(`[${key}]`)} (${value.length} chars)`);
      }
    }
    console.log();
  } catch (err) {
    console.error(
      chalk.red(
        `Failed to get prompt: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    process.exitCode = 1;
  }
}

/**
 * Register the `prompts` command group on the Commander program.
 */
export function registerPromptCommands(program: Command): void {
  const prompts = program
    .command('prompts')
    .description('Manage system prompts');

  prompts
    .command('list')
    .description('List all active system prompts')
    .option('--canvas-type <id>', 'Filter by canvas type ID')
    .option('--category <cat>', 'Filter by category (system, stage, agent, platform)')
    .action(listPromptsCommand);

  prompts
    .command('get <promptId>')
    .description('Get full details of a system prompt')
    .action(getPromptCommand);
}
