/**
 * MyndHyve CLI — A2A Client Commands
 *
 * Agent-to-Agent protocol client for discovering and calling external agents:
 *   myndhyve-cli a2a discover <url>
 *   myndhyve-cli a2a call <url> <workflowId> [--input <json>]
 *   myndhyve-cli a2a list
 *   myndhyve-cli a2a add <name> <url>
 *   myndhyve-cli a2a remove <name>
 */

import type { Command } from 'commander';
import { formatTableRow, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('A2A');

// ============================================================================
// TYPES
// ============================================================================

interface A2AAgentCard {
  name: string;
  description?: string;
  url: string;
  workflows: A2AWorkflow[];
  authentication?: {
    type: string;
    scheme?: string;
  };
}

interface A2AWorkflow {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  outputSchema?: Record<string, unknown>;
}

interface A2ATaskResponse {
  id: string;
  type: string;
  status: 'pending' | 'completed' | 'failed';
  output?: unknown;
  error?: { code: string; message: string };
  pollUrl?: string;
}

interface SavedAgent {
  name: string;
  url: string;
  description?: string;
  addedAt: string;
}

// ============================================================================
// AGENT REGISTRY (local config)
// ============================================================================

async function getConfigDir(): Promise<string> {
  const { homedir } = await import('os');
  const path = await import('path');
  const dir = path.join(homedir(), '.myndhyve');
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
  return dir;
}

async function loadSavedAgents(): Promise<SavedAgent[]> {
  const path = await import('path');
  const { readFile } = await import('fs/promises');
  const configDir = await getConfigDir();
  const filePath = path.join(configDir, 'a2a-agents.json');
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as SavedAgent[];
  } catch {
    return [];
  }
}

async function saveSavedAgents(agents: SavedAgent[]): Promise<void> {
  const path = await import('path');
  const { writeFile } = await import('fs/promises');
  const configDir = await getConfigDir();
  const filePath = path.join(configDir, 'a2a-agents.json');
  await writeFile(filePath, JSON.stringify(agents, null, 2), 'utf-8');
}

// ============================================================================
// A2A PROTOCOL CLIENT
// ============================================================================

async function fetchAgentCard(baseUrl: string): Promise<A2AAgentCard> {
  const url = baseUrl.replace(/\/$/, '');

  // Try /.well-known/agent.json first (A2A spec standard)
  const wellKnownUrl = `${url}/.well-known/agent.json`;
  log.debug('Trying well-known URL', { url: wellKnownUrl });

  try {
    const response = await fetch(wellKnownUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      return (await response.json()) as A2AAgentCard;
    }
  } catch {
    // Fall through to next URL
  }

  // Try /agent.json fallback
  const agentJsonUrl = `${url}/agent.json`;
  log.debug('Trying agent.json URL', { url: agentJsonUrl });

  try {
    const response = await fetch(agentJsonUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      return (await response.json()) as A2AAgentCard;
    }
  } catch {
    // Fall through
  }

  throw new Error(`Could not fetch agent card from ${url}. Tried /.well-known/agent.json and /agent.json`);
}

async function submitA2ATask(
  agentUrl: string,
  workflowId: string,
  input: Record<string, unknown>,
  apiKey?: string,
): Promise<A2ATaskResponse> {
  const url = agentUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body = {
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'task',
    workflowId,
    input,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`A2A task submission failed (${response.status}): ${errText}`);
  }

  return (await response.json()) as A2ATaskResponse;
}

async function pollA2ATask(
  pollUrl: string,
  apiKey?: string,
  maxPollMs = 120_000,
): Promise<A2ATaskResponse> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const startTime = Date.now();

  while (Date.now() - startTime < maxPollMs) {
    const response = await fetch(pollUrl.startsWith('http') ? pollUrl : `https://${pollUrl}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Poll failed (${response.status})`);
    }

    const result = (await response.json()) as A2ATaskResponse;

    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }

    // Wait 2 seconds between polls
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error('Polling timed out — task is still running');
}

// ============================================================================
// REGISTER
// ============================================================================

export function registerA2ACommands(program: Command): void {
  const a2a = program
    .command('a2a')
    .description('Discover and interact with external A2A agents')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli a2a discover https://agent.example.com
  $ myndhyve-cli a2a call https://agent.example.com analyze-data-workflow --input '{"text":"hello"}'
  $ myndhyve-cli a2a add my-agent https://agent.example.com
  $ myndhyve-cli a2a list
  $ myndhyve-cli a2a remove my-agent`);

  // ── Discover ────────────────────────────────────────────────────────

  a2a
    .command('discover <url>')
    .description('Fetch and display an agent card from a remote A2A agent')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (url: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;
      const spinner = ora({ text: 'Discovering agent...', stream: process.stderr }).start();

      try {
        const card = await fetchAgentCard(url);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(card, null, 2));
          return;
        }

        console.log(`\n  ${chalk.bold(card.name)}`);
        if (card.description) {
          console.log(`  ${chalk.dim(card.description)}`);
        }
        console.log(`  ${chalk.dim('URL:')} ${card.url || url}`);
        if (card.authentication) {
          console.log(`  ${chalk.dim('Auth:')} ${card.authentication.type} (${card.authentication.scheme || 'default'})`);
        }

        if (card.workflows.length === 0) {
          console.log(`\n  ${chalk.yellow('No workflows advertised.')}\n`);
          return;
        }

        console.log(`\n  ${chalk.bold('Workflows')} (${card.workflows.length})\n`);

        const cols: Array<[string, number]> = [['Workflow', 30], ['Description', 50]];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(80, (process.stdout.columns || 80) - 4)));

        for (const wf of card.workflows) {
          console.log(formatTableRow([
            [wf.name, 30],
            [wf.description || '\u2014', 50],
          ]));

          // Show input params
          if (wf.inputSchema?.properties) {
            const props = Object.entries(wf.inputSchema.properties);
            const required = wf.inputSchema.required || [];
            for (const [name, schema] of props) {
              const req = required.includes(name) ? chalk.red('*') : ' ';
              console.log(`    ${req} ${chalk.cyan(name)} ${chalk.dim(`(${schema.type || 'any'})`)} ${schema.description || ''}`);
            }
          }
        }
        console.log('');
      } catch (error) {
        spinner.fail('Discovery failed');
        printError('A2A discovery', error);
      }
    });

  // ── Call ─────────────────────────────────────────────────────────────

  a2a
    .command('call <url> <workflowId>')
    .description('Submit a task to an A2A agent and poll for the result')
    .option('--input <json>', 'Input JSON for the task', '{}')
    .option('--api-key <key>', 'API key for authenticated agents')
    .option('--no-poll', 'Submit task but do not wait for the result')
    .option('--timeout <ms>', 'Polling timeout in milliseconds', '120000')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (url: string, workflowId: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;

      let input: Record<string, unknown>;
      try {
        input = JSON.parse(opts.input);
      } catch {
        printErrorResult({
          code: 'INVALID_INPUT',
          message: 'Failed to parse --input as JSON.',
          suggestion: 'Provide valid JSON, e.g. --input \'{"key":"value"}\'',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      const spinner = ora({ text: `Submitting task to ${workflowId}...`, stream: process.stderr }).start();

      try {
        const result = await submitA2ATask(url, workflowId, input, opts.apiKey);

        if (!opts.poll || result.status === 'completed' || result.status === 'failed') {
          spinner.stop();

          if (opts.format === 'json') {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          if (result.status === 'completed') {
            spinner.succeed(`Task completed`);
            console.log(`\n  ${chalk.bold('Output:')}`);
            console.log(JSON.stringify(result.output, null, 2));
          } else if (result.status === 'failed') {
            spinner.fail(`Task failed: ${result.error?.message || 'Unknown error'}`);
          } else {
            spinner.succeed(`Task submitted (status: ${result.status})`);
            if (result.pollUrl) {
              console.log(`  ${chalk.dim('Poll URL:')} ${result.pollUrl}`);
            }
          }
          console.log('');
          return;
        }

        // Poll for result
        if (result.pollUrl) {
          spinner.text = 'Waiting for task completion...';

          const finalResult = await pollA2ATask(
            result.pollUrl,
            opts.apiKey,
            parseInt(opts.timeout, 10),
          );

          spinner.stop();

          if (opts.format === 'json') {
            console.log(JSON.stringify(finalResult, null, 2));
            return;
          }

          if (finalResult.status === 'completed') {
            spinner.succeed('Task completed');
            console.log(`\n  ${chalk.bold('Output:')}`);
            console.log(JSON.stringify(finalResult.output, null, 2));
          } else {
            spinner.fail(`Task failed: ${finalResult.error?.message || 'Unknown error'}`);
          }
        } else {
          spinner.succeed(`Task submitted (no poll URL — status: ${result.status})`);
        }
        console.log('');
      } catch (error) {
        spinner.fail('A2A call failed');
        printError('A2A call', error);
      }
    });

  // ── Add ──────────────────────────────────────────────────────────────

  a2a
    .command('add <name> <url>')
    .description('Save an A2A agent reference for quick access')
    .option('--description <desc>', 'Optional description')
    .action(async (name: string, url: string, opts) => {
      const chalk = (await import('chalk')).default;

      try {
        const agents = await loadSavedAgents();

        if (agents.some((a) => a.name === name)) {
          printErrorResult({
            code: 'DUPLICATE_NAME',
            message: `Agent "${name}" already exists.`,
            suggestion: `Remove it first with: myndhyve-cli a2a remove ${name}`,
          });
          process.exitCode = ExitCode.USAGE_ERROR;
          return;
        }

        agents.push({
          name,
          url: url.replace(/\/$/, ''),
          description: opts.description,
          addedAt: new Date().toISOString(),
        });

        await saveSavedAgents(agents);
        console.log(`\n  ${chalk.green('\u2713')} Saved agent "${name}" (${url})\n`);
      } catch (error) {
        printError('Failed to save agent', error);
      }
    });

  // ── Remove ───────────────────────────────────────────────────────────

  a2a
    .command('remove <name>')
    .description('Remove a saved A2A agent')
    .action(async (name: string) => {
      const chalk = (await import('chalk')).default;

      try {
        const agents = await loadSavedAgents();
        const index = agents.findIndex((a) => a.name === name);

        if (index === -1) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Agent "${name}" not found.`,
            suggestion: 'Run `myndhyve-cli a2a list` to see saved agents.',
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        agents.splice(index, 1);
        await saveSavedAgents(agents);
        console.log(`\n  ${chalk.green('\u2713')} Removed agent "${name}"\n`);
      } catch (error) {
        printError('Failed to remove agent', error);
      }
    });

  // ── List ─────────────────────────────────────────────────────────────

  a2a
    .command('list')
    .description('List saved A2A agent references')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const chalk = (await import('chalk')).default;

      try {
        const agents = await loadSavedAgents();

        if (opts.format === 'json') {
          console.log(JSON.stringify(agents, null, 2));
          return;
        }

        if (agents.length === 0) {
          console.log('\n  No saved agents.');
          console.log('  Add one with: myndhyve-cli a2a add <name> <url>\n');
          return;
        }

        console.log(`\n  Saved A2A Agents (${agents.length})\n`);

        const cols: Array<[string, number]> = [['Name', 20], ['URL', 50], ['Added', 14]];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(84, (process.stdout.columns || 84) - 4)));

        for (const agent of agents) {
          const added = agent.addedAt
            ? new Date(agent.addedAt).toLocaleDateString()
            : '\u2014';
          console.log(formatTableRow([
            [agent.name, 20],
            [agent.url, 50],
            [added, 14],
          ]));
        }
        console.log('');
      } catch (error) {
        printError('Failed to list agents', error);
      }
    });
}
