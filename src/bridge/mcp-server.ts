/**
 * MyndHyve CLI — MCP Server
 *
 * Model Context Protocol server for AI coding assistants (Cursor, Claude Code,
 * Copilot, etc.). Exposes MyndHyve project context, design data, sync
 * operations, and build management via stdio transport.
 *
 * Launch: myndhyve-cli bridge mcp
 * Config: { "mcpServers": { "myndhyve": { "command": "myndhyve-cli", "args": ["bridge", "mcp"] } } }
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import type { BridgeLocalConfig, FileSyncRecord } from './types.js';

const log = createLogger('MCPServer');

// ============================================================================
// SERVER CREATION
// ============================================================================

/**
 * Create and start the MCP server on stdio transport.
 *
 * @param projectRoot - Absolute path to the linked project directory
 * @param config - Local bridge config from .myndhyve/bridge.json
 */
export async function startMCPServer(
  projectRoot: string,
  config: BridgeLocalConfig
): Promise<void> {
  const server = new McpServer(
    {
      name: 'myndhyve',
      version: '0.2.0',
      description: 'MyndHyve design-to-code bridge — access project context, design tokens, sync status, and build tools',
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
    }
  );

  // Lazy-load API modules to keep startup fast
  const api = {
    getProject: async () => (await import('../api/projects.js')).getProject,
    listProjects: async () => (await import('../api/projects.js')).listProjects,
    getHyveDocument: async () => (await import('../api/hyves.js')).getHyveDocument,
    listHyveDocuments: async () => (await import('../api/hyves.js')).listHyveDocuments,
    getSystemHyve: async () => (await import('../api/hyves.js')).getSystemHyve,
    listWorkflows: async () => (await import('../api/workflows.js')).listWorkflows,
    getDocument: async () => (await import('../api/firestore.js')).getDocument,
    listDocuments: async () => (await import('../api/firestore.js')).listDocuments,
    runQuery: async () => (await import('../api/firestore.js')).runQuery,
  };

  const getUserId = () => config.userId;
  const getSessionId = () => config.sessionId;

  // ============================================================================
  // TOOLS
  // ============================================================================

  // ── Project Context ────────────────────────────────────────────────────

  server.registerTool('myndhyve.project.context', {
    title: 'Get Project Context',
    description:
      'Get full project context: PRD, design tokens, screens, components, data models, and current sync status. ' +
      'Use this as your first call to understand the project before making changes.',
  }, async () => {
    try {
      const getProject = await api.getProject();
      const project = await getProject(config.projectId);

      if (!project) {
        return errorResult(`Project not found: ${config.projectId}`);
      }

      // Gather supplementary context from Firestore subcollections
      const listDocs = await api.listDocuments();
      const [sessions, themes, prds] = await Promise.all([
        listDocs(`projects/${config.projectId}/sessions`).then(r => r.documents).catch(() => []),
        listDocs(`projects/${config.projectId}/themes`).then(r => r.documents).catch(() => []),
        listDocs(`projects/${config.projectId}/prds`).then(r => r.documents).catch(() => []),
      ]);

      // Read local package.json for tech context
      const localPkg = await readJsonSafe(join(projectRoot, 'package.json'));

      const context = {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          hyveId: project.hyveId,
          status: project.status,
          tags: project.tags,
        },
        bridge: {
          sessionId: config.sessionId,
          framework: config.framework,
          localPath: projectRoot,
        },
        prd: prds[0] || null,
        theme: themes[0] || null,
        sessionCount: sessions.length,
        localDependencies: localPkg?.dependencies
          ? Object.keys(localPkg.dependencies as Record<string, string>)
          : [],
      };

      return textResult(JSON.stringify(context, null, 2));
    } catch (error) {
      return errorResult(`Failed to get project context: ${errorMessage(error)}`);
    }
  });

  // ── Design: Get Component ──────────────────────────────────────────────

  server.registerTool('myndhyve.design.getComponent', {
    title: 'Get Component Design',
    description:
      'Get the design definition for a specific component: props, styles, layout, variants, and children. ' +
      'Use the component name or ID from the screen hierarchy.',
    inputSchema: {
      componentId: z.string().describe('Component ID or name to look up'),
    },
  }, async ({ componentId }) => {
    try {
      const getDoc = await api.getDocument();
      // Try direct Firestore lookup first
      const doc = await getDoc(
        `projects/${config.projectId}/components`,
        componentId
      );

      if (doc) {
        return textResult(JSON.stringify(doc, null, 2));
      }

      // Fallback: search by name in the components collection
      const query = await api.runQuery();
      const results = await query(
        `projects/${config.projectId}/components`,
        [{ field: 'name', op: 'EQUAL', value: componentId }],
        { limit: 1 }
      );

      if (results.length > 0) {
        return textResult(JSON.stringify(results[0], null, 2));
      }

      return errorResult(`Component not found: ${componentId}`);
    } catch (error) {
      return errorResult(`Failed to get component: ${errorMessage(error)}`);
    }
  });

  // ── Design: List Screens ──────────────────────────────────────────────

  server.registerTool('myndhyve.design.listScreens', {
    title: 'List Screens',
    description:
      'List all screens/pages in the project with their component hierarchy. ' +
      'Returns screen names, routes, and top-level component tree.',
  }, async () => {
    try {
      const listDocs = await api.listDocuments();
      const result = await listDocs(`projects/${config.projectId}/screens`);
      const screens = result.documents.map((doc: Record<string, unknown>) => ({
        id: doc.id,
        name: doc.name,
        route: doc.route,
        description: doc.description,
        componentCount: Array.isArray(doc.components) ? doc.components.length : 0,
      }));
      return textResult(JSON.stringify(screens, null, 2));
    } catch (error) {
      return errorResult(`Failed to list screens: ${errorMessage(error)}`);
    }
  });

  // ── Design: Get Theme ─────────────────────────────────────────────────

  server.registerTool('myndhyve.design.getTheme', {
    title: 'Get Design Theme',
    description:
      'Get the full design system: colors, typography, spacing, breakpoints, shadows, and component tokens. ' +
      'Use this to ensure code matches the design specifications.',
  }, async () => {
    try {
      const listDocs = await api.listDocuments();
      const result = await listDocs(`projects/${config.projectId}/themes`);

      if (result.documents.length === 0) {
        return errorResult('No theme defined for this project');
      }

      return textResult(JSON.stringify(result.documents[0], null, 2));
    } catch (error) {
      return errorResult(`Failed to get theme: ${errorMessage(error)}`);
    }
  });

  // ── Sync: Status ──────────────────────────────────────────────────────

  server.registerTool('myndhyve.sync.status', {
    title: 'Sync Status',
    description:
      'Get current sync status for all tracked files. Shows which files are synced, ' +
      'which have local or remote changes pending, and any conflicts.',
  }, async () => {
    try {
      const listDocs = await api.listDocuments();
      const result = await listDocs(
        `users/${getUserId()}/bridgeSessions/${getSessionId()}/files`
      );

      const files = result.documents as unknown as FileSyncRecord[];
      const summary = {
        total: files.length,
        synced: files.filter(f => f.syncStatus === 'synced').length,
        localAhead: files.filter(f => f.syncStatus === 'modified-local').length,
        remoteAhead: files.filter(f => f.syncStatus === 'modified-remote').length,
        conflicts: files.filter(f => f.syncStatus === 'conflict').length,
        files: files.map(f => ({
          path: f.relativePath,
          status: f.syncStatus,
          entityType: f.entityType,
          entityId: f.entityId,
        })),
      };

      return textResult(JSON.stringify(summary, null, 2));
    } catch (error) {
      return errorResult(`Failed to get sync status: ${errorMessage(error)}`);
    }
  });

  // ── Sync: Push ────────────────────────────────────────────────────────

  server.registerTool('myndhyve.sync.push', {
    title: 'Push Local Changes',
    description:
      'Push local file changes to MyndHyve. Scans for modified files and syncs them to the cloud project.',
  }, async () => {
    try {
      const { manualSync } = await import('./sync.js');
      const result = await manualSync(projectRoot, config, 'push');
      return textResult(
        `Push complete: ${result.filesChanged} file(s) synced` +
        (result.conflicts > 0 ? `, ${result.conflicts} conflict(s) detected` : '')
      );
    } catch (error) {
      return errorResult(`Push failed: ${errorMessage(error)}`);
    }
  });

  // ── Sync: Pull ────────────────────────────────────────────────────────

  server.registerTool('myndhyve.sync.pull', {
    title: 'Pull Remote Changes',
    description:
      'Pull changes from MyndHyve to local files. Downloads any design changes and writes them to disk.',
  }, async () => {
    try {
      const { manualSync } = await import('./sync.js');
      const result = await manualSync(projectRoot, config, 'pull');
      return textResult(
        `Pull complete: ${result.filesChanged} file(s) updated` +
        (result.conflicts > 0 ? `, ${result.conflicts} conflict(s) detected` : '')
      );
    } catch (error) {
      return errorResult(`Pull failed: ${errorMessage(error)}`);
    }
  });

  // ── Build: Run ────────────────────────────────────────────────────────

  server.registerTool('myndhyve.build.run', {
    title: 'Run Build',
    description:
      'Trigger a build in the local project. Supports: development, production, test, lint, typecheck, preview.',
    inputSchema: {
      buildType: z
        .enum(['development', 'production', 'test', 'lint', 'typecheck', 'preview'])
        .default('production')
        .describe('Type of build to run'),
      command: z
        .string()
        .optional()
        .describe('Override the default build command (e.g. "npm run build:staging")'),
    },
  }, async ({ buildType, command: rawCommand }) => {
    try {
      const { executeBuildRequest } = await import('./builder.js');
      const buildId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();

      const BUILD_COMMANDS: Record<string, string> = {
        development: 'npm run dev',
        production: 'npm run build',
        test: 'npm test',
        lint: 'npm run lint',
        typecheck: 'npx tsc --noEmit',
        preview: 'npm run preview',
      };

      // Validate command to prevent shell injection
      const SHELL_META = /[;&|`$(){}[\]<>!#~]/;
      const command = rawCommand
        ? (SHELL_META.test(rawCommand)
            ? (() => { throw new Error(`Command contains disallowed shell metacharacters: ${rawCommand}`); })()
            : rawCommand)
        : BUILD_COMMANDS[buildType] || 'npm run build';

      const buildRecord: Record<string, unknown> = {
        id: buildId,
        buildType,
        command,
        env: {},
        requestedBy: 'mcp',
        requestedAt: now,
        status: 'pending',
        exitCode: null,
        duration: null,
        errorCount: 0,
        warningCount: 0,
        errors: [],
        warnings: [],
        artifacts: [],
        startedAt: null,
        completedAt: null,
        createdAt: now,
      };

      // executeBuildRequest runs the build and writes results to Firestore
      await executeBuildRequest(getSessionId(), projectRoot, buildRecord);

      // Read back the completed build record from Firestore
      const getDoc = await api.getDocument();
      const buildsPath = `users/${getUserId()}/bridgeSessions/${getSessionId()}/builds`;
      const result = await getDoc(buildsPath, buildId);

      if (result) {
        const summary = {
          buildId,
          status: result.status,
          exitCode: result.exitCode,
          duration: typeof result.duration === 'number'
            ? `${(result.duration / 1000).toFixed(1)}s`
            : null,
          errorCount: result.errorCount,
          warningCount: result.warningCount,
          errors: Array.isArray(result.errors) ? result.errors.slice(0, 10) : [],
          warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 10) : [],
        };
        return textResult(JSON.stringify(summary, null, 2));
      }

      return textResult(`Build ${buildId} completed (unable to read results).`);
    } catch (error) {
      return errorResult(`Build failed: ${errorMessage(error)}`);
    }
  });

  // ── Build: Status ─────────────────────────────────────────────────────

  server.registerTool('myndhyve.build.status', {
    title: 'Build Status',
    description: 'Get the status of the most recent build, or a specific build by ID.',
    inputSchema: {
      buildId: z.string().optional().describe('Specific build ID (omit for latest)'),
    },
  }, async ({ buildId }) => {
    try {
      const listDocs = await api.listDocuments();
      const buildsPath = `users/${getUserId()}/bridgeSessions/${getSessionId()}/builds`;

      if (buildId) {
        const getDoc = await api.getDocument();
        const build = await getDoc(buildsPath, buildId);
        if (!build) return errorResult(`Build not found: ${buildId}`);
        return textResult(JSON.stringify(build, null, 2));
      }

      // Get latest build
      const result = await listDocs(buildsPath, {
        orderBy: 'createdAt',
        pageSize: 1,
      });

      if (result.documents.length === 0) {
        return textResult('No builds found for this session.');
      }

      return textResult(JSON.stringify(result.documents[0], null, 2));
    } catch (error) {
      return errorResult(`Failed to get build status: ${errorMessage(error)}`);
    }
  });

  // ── Conflict: List ────────────────────────────────────────────────────

  server.registerTool('myndhyve.conflict.list', {
    title: 'List Conflicts',
    description: 'List all unresolved sync conflicts. Shows file path, type, and available content versions.',
  }, async () => {
    try {
      const query = await api.runQuery();
      const conflicts = await query(
        `users/${getUserId()}/bridgeSessions/${getSessionId()}/conflicts`,
        [{ field: 'status', op: 'EQUAL', value: 'pending' }]
      );

      if (conflicts.length === 0) {
        return textResult('No unresolved conflicts.');
      }

      const summary = conflicts.map((c: Record<string, unknown>) => ({
        id: c.id,
        file: c.relativePath,
        type: c.conflictType,
        detectedAt: c.detectedAt,
      }));

      return textResult(JSON.stringify(summary, null, 2));
    } catch (error) {
      return errorResult(`Failed to list conflicts: ${errorMessage(error)}`);
    }
  });

  // ── Conflict: Resolve ─────────────────────────────────────────────────

  server.registerTool('myndhyve.conflict.resolve', {
    title: 'Resolve Conflict',
    description:
      'Resolve a sync conflict. Strategies: keep-local (use IDE version), ' +
      'keep-remote (use MyndHyve version), or manual (provide merged content).',
    inputSchema: {
      conflictId: z.string().describe('Conflict ID from conflict.list'),
      strategy: z
        .enum(['keep-local', 'keep-remote', 'manual'])
        .describe('Resolution strategy'),
      content: z
        .string()
        .optional()
        .describe('Merged content (required for "manual" strategy)'),
    },
  }, async ({ conflictId, strategy, content }) => {
    try {
      if (strategy === 'manual' && !content) {
        return errorResult('Manual resolution requires "content" parameter with merged file content.');
      }

      const { updateDocument } = await import('../api/firestore.js');
      const conflictsPath = `users/${getUserId()}/bridgeSessions/${getSessionId()}/conflicts`;
      const now = new Date().toISOString();

      await updateDocument(conflictsPath, conflictId, {
        status: 'resolved',
        resolution: strategy,
        resolvedContent: content || null,
        resolvedBy: 'mcp',
        resolvedAt: now,
      });

      return textResult(`Conflict ${conflictId} resolved with strategy: ${strategy}`);
    } catch (error) {
      return errorResult(`Failed to resolve conflict: ${errorMessage(error)}`);
    }
  });

  // ============================================================================
  // RESOURCES
  // ============================================================================

  // ── Project Manifest ──────────────────────────────────────────────────

  server.registerResource(
    'project-manifest',
    'myndhyve://project/manifest',
    {
      title: 'Project Manifest',
      description: 'Project metadata, configuration, and bridge session info',
      mimeType: 'application/json',
    },
    async (uri) => {
      const getProject = await api.getProject();
      const project = await getProject(config.projectId);
      const getHyve = await api.getSystemHyve();
      const hyve = getHyve(config.hyveId);

      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify({
            project,
            hyve: hyve ? { hyveId: hyve.hyveId, name: hyve.name, description: hyve.description } : null,
            bridge: {
              sessionId: config.sessionId,
              framework: config.framework,
              localPath: projectRoot,
            },
          }, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ── Theme Resource ────────────────────────────────────────────────────

  server.registerResource(
    'design-theme',
    'myndhyve://design/theme',
    {
      title: 'Design Theme',
      description: 'Full design system: colors, typography, spacing, shadows, breakpoints',
      mimeType: 'application/json',
    },
    async (uri) => {
      const listDocs = await api.listDocuments();
      const result = await listDocs(`projects/${config.projectId}/themes`);
      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify(result.documents[0] || {}, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ── Sync Status Resource ──────────────────────────────────────────────

  server.registerResource(
    'sync-status',
    'myndhyve://sync/status',
    {
      title: 'Sync Status',
      description: 'Current file sync status for all tracked files',
      mimeType: 'application/json',
    },
    async (uri) => {
      const listDocs = await api.listDocuments();
      const result = await listDocs(
        `users/${getUserId()}/bridgeSessions/${getSessionId()}/files`
      );
      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify(result.documents, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ── Screen Resource Template ──────────────────────────────────────────

  const screenTemplate = new ResourceTemplate(
    'myndhyve://design/screen/{screenId}',
    {
      list: async () => {
        const listDocs = await api.listDocuments();
        const result = await listDocs(`projects/${config.projectId}/screens`);
        return {
          resources: result.documents.map((doc: Record<string, unknown>) => ({
            uri: `myndhyve://design/screen/${doc.id as string}`,
            name: (doc.name as string) || (doc.id as string),
            description: (doc.description as string) || `Screen: ${doc.name as string}`,
            mimeType: 'application/json',
          })),
        };
      },
    }
  );

  server.registerResource(
    'design-screen',
    screenTemplate,
    {
      title: 'Screen Design',
      description: 'Design definition for a specific screen/page',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const getDoc = await api.getDocument();
      const screenId = Array.isArray(variables.screenId) ? variables.screenId[0] : variables.screenId;
      const screen = await getDoc(
        `projects/${config.projectId}/screens`,
        screenId
      );
      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify(screen || {}, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ── Component Resource Template ───────────────────────────────────────

  const componentTemplate = new ResourceTemplate(
    'myndhyve://design/component/{componentId}',
    {
      list: async () => {
        const listDocs = await api.listDocuments();
        const result = await listDocs(`projects/${config.projectId}/components`);
        return {
          resources: result.documents.map((doc: Record<string, unknown>) => ({
            uri: `myndhyve://design/component/${doc.id as string}`,
            name: (doc.name as string) || (doc.id as string),
            description: (doc.description as string) || `Component: ${doc.name as string}`,
            mimeType: 'application/json',
          })),
        };
      },
    }
  );

  server.registerResource(
    'design-component',
    componentTemplate,
    {
      title: 'Component Design',
      description: 'Design definition for a specific component (props, styles, variants)',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const getDoc = await api.getDocument();
      const componentId = Array.isArray(variables.componentId) ? variables.componentId[0] : variables.componentId;
      const component = await getDoc(
        `projects/${config.projectId}/components`,
        componentId
      );
      return {
        contents: [{
          uri: uri.toString(),
          text: JSON.stringify(component || {}, null, 2),
          mimeType: 'application/json',
        }],
      };
    }
  );

  // ============================================================================
  // START SERVER
  // ============================================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP JSON-RPC on stdout
  log.info('MCP server started', {
    project: config.projectId,
    session: config.sessionId,
    framework: config.framework,
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(filePath)) return null;
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
