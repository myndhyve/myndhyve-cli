/**
 * MyndHyve CLI — Agent Commands
 *
 * Commander subcommand group for automation agent management:
 *   myndhyve-cli agents list [--canvas-type=<canvasTypeId>]
 *   myndhyve-cli agents info <agent-id>
 *   myndhyve-cli agents create --canvas-type=<canvasTypeId> --name="..." [--model=...]
 *   myndhyve-cli agents update <agent-id> --data '{...}'
 *   myndhyve-cli agents enable <agent-id>
 *   myndhyve-cli agents disable <agent-id>
 *   myndhyve-cli agents delete <agent-id>
 */

import type { Command } from 'commander';
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  toggleAgent,
  deleteAgent,
  DEFAULT_MODEL_CONFIG,
} from '../api/agents.js';
import { requireAuth, truncate, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerAgentCommands(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage automation agents');

  // ── List ──────────────────────────────────────────────────────────────

  agents
    .command('list')
    .description('List automation agents')
    .option('--canvas-type <canvasTypeId>', 'Filter by canvas type ID')
    .option('--enabled', 'Show only enabled agents')
    .option('--disabled', 'Show only disabled agents')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
        const agentList = await listAgents(auth.uid, {
          canvasTypeId: opts.canvasType,
          enabled,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(agentList, null, 2));
          return;
        }

        if (agentList.length === 0) {
          console.log('\n  No agents found.');
          console.log('  Create one: myndhyve-cli agents create --canvas-type=app-builder --name="My Agent"');
          console.log('');
          return;
        }

        console.log(`\n  Agents (${agentList.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(22) +
            'Canvas Type'.padEnd(16) +
            'Model'.padEnd(20) +
            'Status'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const agent of agentList) {
          const status = agent.enabled ? '\u2713 enabled' : '\u2717 disabled';
          const model = `${agent.provider}/${agent.modelId}`.replace('claude-sonnet-4-20250514', 'sonnet-4');

          console.log(
            '  ' +
              truncate(agent.id, 22).padEnd(24) +
              truncate(agent.name, 20).padEnd(22) +
              truncate(agent.canvasTypeId, 14).padEnd(16) +
              truncate(model, 18).padEnd(20) +
              status
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list agents', error);
      }
    });

  // ── Info ──────────────────────────────────────────────────────────────

  agents
    .command('info <agent-id>')
    .description('Show detailed information about an agent')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (agentId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const agent = await getAgent(auth.uid, agentId);

        if (!agent) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Agent "${agentId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(agent, null, 2));
          return;
        }

        console.log(`\n  ${agent.name}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ID:            ${agent.id}`);
        console.log(`  Canvas Type:   ${agent.canvasTypeId}`);
        console.log(`  Description:   ${agent.description || '-'}`);
        console.log(`  Status:        ${agent.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`  Provider:      ${agent.model.provider}`);
        console.log(`  Model:         ${agent.model.modelId}`);
        console.log(`  Temperature:   ${agent.model.temperature}`);
        console.log(`  Max Tokens:    ${agent.model.maxTokens}`);
        console.log(`  Prompt ID:     ${agent.systemPromptId || '-'}`);
        console.log(`  Workflows:     ${agent.workflowIds.length > 0 ? agent.workflowIds.join(', ') : '-'}`);
        console.log(`  Envelopes:     ${agent.envelopeTypes.length > 0 ? agent.envelopeTypes.join(', ') : '-'}`);
        console.log(`  Tags:          ${agent.tags.length > 0 ? agent.tags.join(', ') : '-'}`);

        if (agent.schedule) {
          console.log(`  Schedule:      ${agent.schedule.cron} (${agent.schedule.timezone})`);
        }

        if (agent.kanbanAccess) {
          console.log(`  Kanban Boards: ${agent.kanbanAccess.boardIds.join(', ')}`);
          console.log(`  Auto-Run:      ${agent.kanbanAccess.canAutoRun ? 'Yes' : 'No'}`);
          console.log(`  Max Concurrent: ${agent.kanbanAccess.maxConcurrent}`);
        }

        if (agent.model.fallbackModels?.length) {
          console.log('  Fallbacks:');
          for (const fb of agent.model.fallbackModels) {
            console.log(`    \u2192 ${fb.provider}/${fb.modelId} (on ${fb.condition})`);
          }
        }

        console.log('');
      } catch (error) {
        printError('Failed to get agent details', error);
      }
    });

  // ── Create ────────────────────────────────────────────────────────────

  agents
    .command('create')
    .description('Create a new automation agent')
    .requiredOption('--canvas-type <canvasTypeId>', 'Canvas type ID to create agent for')
    .requiredOption('--name <name>', 'Agent name')
    .option('--description <desc>', 'Agent description')
    .option('--provider <provider>', 'Model provider (anthropic, openai, gemini)', 'anthropic')
    .option('--model <modelId>', 'Model ID', DEFAULT_MODEL_CONFIG.modelId)
    .option('--temperature <temp>', 'Temperature', String(DEFAULT_MODEL_CONFIG.temperature))
    .option('--max-tokens <tokens>', 'Max tokens', String(DEFAULT_MODEL_CONFIG.maxTokens))
    .option('--prompt-id <promptId>', 'System prompt ID from prompt library')
    .option('--workflows <ids>', 'Comma-separated workflow IDs')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const agentId = `agent-${Date.now().toString(36)}`;
        const temperature = parseFloat(opts.temperature);
        const maxTokens = parseInt(opts.maxTokens, 10);
        const agent = await createAgent(auth.uid, agentId, {
          canvasTypeId: opts.canvasType,
          name: opts.name,
          description: opts.description,
          systemPromptId: opts.promptId,
          model: {
            provider: opts.provider,
            modelId: opts.model,
            temperature: isNaN(temperature) ? DEFAULT_MODEL_CONFIG.temperature : temperature,
            maxTokens: isNaN(maxTokens) || maxTokens < 1 ? DEFAULT_MODEL_CONFIG.maxTokens : maxTokens,
          },
          workflowIds: opts.workflows ? opts.workflows.split(',').map((s: string) => s.trim()) : [],
          tags: opts.tags ? opts.tags.split(',').map((s: string) => s.trim()) : [],
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(agent, null, 2));
          return;
        }

        console.log(`\n  Agent created:`);
        console.log(`  ID:       ${agent.id}`);
        console.log(`  Name:     ${agent.name}`);
        console.log(`  Canvas Type: ${agent.canvasTypeId}`);
        console.log(`  Provider: ${agent.model.provider}`);
        console.log(`  Model:    ${agent.model.modelId}`);
        console.log('');
      } catch (error) {
        printError('Failed to create agent', error);
      }
    });

  // ── Update ────────────────────────────────────────────────────────────

  agents
    .command('update <agent-id>')
    .description('Update an agent')
    .requiredOption('--data <json>', 'Fields to update as JSON')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (agentId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

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
        const agent = await updateAgent(auth.uid, agentId, data);

        if (opts.format === 'json') {
          console.log(JSON.stringify(agent, null, 2));
          return;
        }

        console.log(`\n  Agent "${agentId}" updated.`);
        console.log('');
      } catch (error) {
        printError('Failed to update agent', error);
      }
    });

  // ── Enable / Disable ──────────────────────────────────────────────────

  agents
    .command('enable <agent-id>')
    .description('Enable an agent')
    .action(async (agentId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        await toggleAgent(auth.uid, agentId, true);
        console.log(`\n  Agent "${agentId}" enabled.`);
        console.log('');
      } catch (error) {
        printError('Failed to enable agent', error);
      }
    });

  agents
    .command('disable <agent-id>')
    .description('Disable an agent')
    .action(async (agentId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        await toggleAgent(auth.uid, agentId, false);
        console.log(`\n  Agent "${agentId}" disabled.`);
        console.log('');
      } catch (error) {
        printError('Failed to disable agent', error);
      }
    });

  // ── Delete ────────────────────────────────────────────────────────────

  agents
    .command('delete <agent-id>')
    .description('Delete an agent')
    .option('--force', 'Skip confirmation')
    .action(async (agentId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm deletion of agent "${agentId}".`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        await deleteAgent(auth.uid, agentId);
        console.log(`\n  Agent "${agentId}" deleted.`);
        console.log('');
      } catch (error) {
        printError('Failed to delete agent', error);
      }
    });
}
