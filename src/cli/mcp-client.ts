/**
 * MyndHyve CLI — MCP Client Commands
 *
 * Model Context Protocol client for discovering and calling external MCP servers:
 *   myndhyve-cli mcp list-tools <server-url>
 *   myndhyve-cli mcp call <server-url> <tool-name> [--args <json>]
 *   myndhyve-cli mcp list-resources <server-url>
 *   myndhyve-cli mcp read <server-url> <resource-uri>
 *
 * NOTE: Named mcp-client.ts to avoid conflicting with any future MCP server commands.
 * The user-facing command group is still "mcp".
 */

import type { Command } from 'commander';
import { formatTableRow, truncate, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MCP');

// ============================================================================
// TYPES
// ============================================================================

interface MCPJsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPJsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

interface MCPResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

interface MCPServerInfo {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
}

// ============================================================================
// MCP JSON-RPC CLIENT
// ============================================================================

let requestIdCounter = 1;

async function mcpRequest(
  serverUrl: string,
  method: string,
  params?: Record<string, unknown>,
  apiKey?: string,
): Promise<MCPJsonRpcResponse> {
  const url = serverUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: MCPJsonRpcRequest = {
    jsonrpc: '2.0',
    id: requestIdCounter++,
    method,
    params,
  };

  log.debug('MCP request', { url, method });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`MCP server returned ${response.status}: ${errText}`);
  }

  const result = (await response.json()) as MCPJsonRpcResponse;

  if (result.error) {
    throw new Error(`MCP error (${result.error.code}): ${result.error.message}`);
  }

  return result;
}

// ============================================================================
// REGISTER
// ============================================================================

export function registerMCPClientCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Interact with remote MCP (Model Context Protocol) servers')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli mcp info https://example.com/mcp
  $ myndhyve-cli mcp list-tools https://example.com/mcp
  $ myndhyve-cli mcp call https://example.com/mcp my-tool --args '{"key":"value"}'
  $ myndhyve-cli mcp list-resources https://example.com/mcp
  $ myndhyve-cli mcp read https://example.com/mcp resource://data/items`);

  // ── Info ─────────────────────────────────────────────────────────────

  mcp
    .command('info <server-url>')
    .description('Initialize and display server information')
    .option('--api-key <key>', 'API key for authenticated servers')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (serverUrl: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;
      const spinner = ora({ text: 'Connecting to MCP server...', stream: process.stderr }).start();

      try {
        const response = await mcpRequest(serverUrl, 'initialize', {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'myndhyve-cli', version: '1.0.0' },
          capabilities: {},
        }, opts.apiKey);

        spinner.stop();

        const info = response.result as MCPServerInfo;

        if (opts.format === 'json') {
          console.log(JSON.stringify(info, null, 2));
          return;
        }

        console.log(`\n  ${chalk.bold(info.serverInfo.name)} ${chalk.dim(`v${info.serverInfo.version}`)}`);
        console.log(`  ${chalk.dim('Protocol:')} ${info.protocolVersion}`);

        const caps = Object.keys(info.capabilities || {});
        if (caps.length > 0) {
          console.log(`  ${chalk.dim('Capabilities:')} ${caps.join(', ')}`);
        }
        console.log('');
      } catch (error) {
        spinner.fail('Connection failed');
        printError('MCP info', error);
      }
    });

  // ── List Tools ───────────────────────────────────────────────────────

  mcp
    .command('list-tools <server-url>')
    .description('List available tools on a remote MCP server')
    .option('--api-key <key>', 'API key for authenticated servers')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (serverUrl: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;
      const spinner = ora({ text: 'Fetching tools...', stream: process.stderr }).start();

      try {
        const response = await mcpRequest(serverUrl, 'tools/list', {}, opts.apiKey);
        spinner.stop();

        const { tools } = response.result as { tools: MCPTool[] };

        if (opts.format === 'json') {
          console.log(JSON.stringify(tools, null, 2));
          return;
        }

        if (tools.length === 0) {
          console.log('\n  No tools available on this MCP server.\n');
          return;
        }

        console.log(`\n  MCP Tools (${tools.length})\n`);

        const cols: Array<[string, number]> = [['Tool', 30], ['Description', 50]];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(80, (process.stdout.columns || 80) - 4)));

        for (const tool of tools) {
          console.log(formatTableRow([
            [tool.name, 30],
            [tool.description || '\u2014', 50],
          ]));

          // Show input params
          if (tool.inputSchema?.properties) {
            const props = Object.entries(tool.inputSchema.properties);
            const required = tool.inputSchema.required || [];
            for (const [name, schema] of props) {
              const req = required.includes(name) ? chalk.red('*') : ' ';
              console.log(`    ${req} ${chalk.cyan(name)} ${chalk.dim(`(${schema.type || 'any'})`)} ${schema.description || ''}`);
            }
          }
        }
        console.log('');
      } catch (error) {
        spinner.fail('Failed to list tools');
        printError('MCP list-tools', error);
      }
    });

  // ── Call Tool ────────────────────────────────────────────────────────

  mcp
    .command('call <server-url> <tool-name>')
    .description('Call a tool on a remote MCP server')
    .option('--args <json>', 'JSON arguments for the tool', '{}')
    .option('--api-key <key>', 'API key for authenticated servers')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (serverUrl: string, toolName: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(opts.args);
      } catch {
        printErrorResult({
          code: 'INVALID_ARGS',
          message: 'Failed to parse --args as JSON.',
          suggestion: 'Provide valid JSON, e.g. --args \'{"key":"value"}\'',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      const spinner = ora({ text: `Calling ${toolName}...`, stream: process.stderr }).start();

      try {
        const response = await mcpRequest(serverUrl, 'tools/call', {
          name: toolName,
          arguments: args,
        }, opts.apiKey);

        spinner.stop();

        const result = response.result as { content: Array<{ type: string; text?: string }>; isError?: boolean };

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.isError) {
          spinner.fail('Tool returned an error');
          for (const item of result.content) {
            if (item.text) {
              console.log(`  ${chalk.red(item.text)}`);
            }
          }
        } else {
          spinner.succeed(`${toolName} completed`);
          for (const item of result.content) {
            if (item.text) {
              console.log(item.text);
            }
          }
        }
        console.log('');
      } catch (error) {
        spinner.fail('Tool call failed');
        printError('MCP call', error);
      }
    });

  // ── List Resources ──────────────────────────────────────────────────

  mcp
    .command('list-resources <server-url>')
    .description('List available resources on a remote MCP server')
    .option('--api-key <key>', 'API key for authenticated servers')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (serverUrl: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;
      const spinner = ora({ text: 'Fetching resources...', stream: process.stderr }).start();

      try {
        const response = await mcpRequest(serverUrl, 'resources/list', {}, opts.apiKey);
        spinner.stop();

        const { resources } = response.result as { resources: MCPResource[] };

        if (opts.format === 'json') {
          console.log(JSON.stringify(resources, null, 2));
          return;
        }

        if (resources.length === 0) {
          console.log('\n  No resources available on this MCP server.\n');
          return;
        }

        console.log(`\n  MCP Resources (${resources.length})\n`);

        const cols: Array<[string, number]> = [['URI', 40], ['Name', 24], ['Type', 16]];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(80, (process.stdout.columns || 80) - 4)));

        for (const resource of resources) {
          console.log(formatTableRow([
            [resource.uri, 40],
            [resource.name || '\u2014', 24],
            [resource.mimeType || '\u2014', 16],
          ]));
        }
        console.log('');
      } catch (error) {
        spinner.fail('Failed to list resources');
        printError('MCP list-resources', error);
      }
    });

  // ── Read Resource ───────────────────────────────────────────────────

  mcp
    .command('read <server-url> <resource-uri>')
    .description('Read a resource from a remote MCP server')
    .option('--api-key <key>', 'API key for authenticated servers')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .action(async (serverUrl: string, resourceUri: string, opts) => {
      const ora = (await import('ora')).default;
      const chalk = (await import('chalk')).default;
      const spinner = ora({ text: 'Reading resource...', stream: process.stderr }).start();

      try {
        const response = await mcpRequest(serverUrl, 'resources/read', {
          uri: resourceUri,
        }, opts.apiKey);

        spinner.stop();

        const result = response.result as { contents: MCPResourceContent[] };

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        for (const content of result.contents) {
          if (content.text) {
            console.log(content.text);
          } else if (content.blob) {
            console.log(`  ${chalk.dim('[Binary data, use --format json to see base64]')}`);
          }
        }
      } catch (error) {
        spinner.fail('Failed to read resource');
        printError('MCP read', error);
      }
    });
}
