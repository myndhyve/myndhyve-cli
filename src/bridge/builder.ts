/**
 * MyndHyve CLI — Bridge Build Runner
 *
 * Executes build commands locally when requested by the web app.
 * Streams output chunks to Firestore for live display.
 * Parses errors and warnings from build output.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import { updateBuildRecord, writeBuildOutputChunk } from './session.js';
import type { BuildError, BuildWarning, BuildStatus } from './types.js';

const log = createLogger('BridgeBuilder');

/** Allowed command prefixes for security */
const ALLOWED_COMMANDS = [
  'npm run',
  'npm test',
  'npm exec',
  'npx ',
  'yarn ',
  'pnpm ',
  'bun ',
  'flutter ',
  'dart ',
  'cargo ',
  'go ',
  'make ',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'pytest',
];

/** Error patterns for parsing build output */
const ERROR_PATTERNS = [
  // TypeScript
  /^(.+)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/,
  // ESLint
  /^\s*(\d+):(\d+)\s+error\s+(.+?)\s+([\w/-]+)$/,
  // Generic
  /^(?:Error|ERROR):\s*(.+)$/,
  // Vite/Rollup
  /^\[vite\].*Error:\s*(.+)$/,
];

const WARNING_PATTERNS = [
  // TypeScript
  /^(.+)\((\d+),(\d+)\):\s*warning\s*(TS\d+):\s*(.+)$/,
  // ESLint
  /^\s*(\d+):(\d+)\s+warning\s+(.+?)\s+([\w/-]+)$/,
  // Generic
  /^(?:Warning|WARN):\s*(.+)$/,
];

/**
 * Execute a build request from the web app.
 */
export async function executeBuildRequest(
  sessionId: string,
  projectRoot: string,
  buildRecord: Record<string, unknown>
): Promise<void> {
  const buildId = buildRecord.id as string;
  const command = buildRecord.command as string;
  const env = (buildRecord.env as Record<string, string>) || {};

  // Validate command
  if (!isCommandAllowed(command)) {
    log.warn('Build command rejected', { command, buildId });
    await updateBuildRecord(sessionId, buildId, {
      status: 'failed' satisfies BuildStatus,
      exitCode: -1,
      errors: [{ message: `Command not allowed: ${command}` }],
      errorCount: 1,
      warningCount: 0,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  log.info('Starting build', { buildId, command, cwd: projectRoot });

  // Mark as running
  const startedAt = new Date().toISOString();
  await updateBuildRecord(sessionId, buildId, {
    status: 'running' satisfies BuildStatus,
    startedAt,
  });

  const startTime = Date.now();
  const errors: BuildError[] = [];
  const warnings: BuildWarning[] = [];
  let outputBuffer = '';
  let chunkIndex = 0;

  return new Promise<void>((resolve) => {
    const child = spawn(command, {
      cwd: projectRoot,
      shell: true,
      env: { ...process.env, ...env },
      timeout: 300_000, // 5 minute timeout
    });

    const flushOutput = async (stream: 'stdout' | 'stderr', data: string) => {
      outputBuffer += data;

      // Parse errors and warnings
      const lines = data.split('\n');
      for (const line of lines) {
        if (errors.length < 50) {
          const error = parseError(line);
          if (error) errors.push(error);
        }
        if (warnings.length < 50) {
          const warning = parseWarning(line);
          if (warning) warnings.push(warning);
        }
      }

      // Batch output into ~4KB chunks
      if (outputBuffer.length >= 4096) {
        const chunk = outputBuffer.slice(0, 4096);
        outputBuffer = outputBuffer.slice(4096);
        const chunkId = `${String(chunkIndex++).padStart(6, '0')}`;

        try {
          await writeBuildOutputChunk(sessionId, buildId, chunkId, {
            stream,
            content: chunk,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          log.debug('Failed to write output chunk', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      flushOutput('stdout', data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      flushOutput('stderr', data.toString());
    });

    child.on('close', async (exitCode) => {
      const duration = Date.now() - startTime;
      const status: BuildStatus = exitCode === 0 ? 'success' : 'failed';

      // Flush remaining output
      if (outputBuffer.length > 0) {
        const chunkId = `${String(chunkIndex++).padStart(6, '0')}`;
        try {
          await writeBuildOutputChunk(sessionId, buildId, chunkId, {
            stream: 'stdout',
            content: outputBuffer,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Best effort
        }
      }

      log.info('Build completed', {
        buildId,
        status,
        exitCode,
        duration,
        errors: errors.length,
        warnings: warnings.length,
      });

      await updateBuildRecord(sessionId, buildId, {
        status,
        exitCode: exitCode ?? -1,
        duration,
        errors,
        warnings,
        errorCount: errors.length,
        warningCount: warnings.length,
        completedAt: new Date().toISOString(),
      });

      resolve();
    });

    child.on('error', async (error) => {
      const duration = Date.now() - startTime;
      log.error('Build process error', { buildId, error: error.message });

      await updateBuildRecord(sessionId, buildId, {
        status: 'failed' satisfies BuildStatus,
        exitCode: -1,
        duration,
        errors: [{ message: error.message }],
        errorCount: 1,
        warningCount: 0,
        completedAt: new Date().toISOString(),
      });

      resolve();
    });
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return ALLOWED_COMMANDS.some((prefix) => trimmed.startsWith(prefix));
}

function parseError(line: string): BuildError | null {
  for (const pattern of ERROR_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      // Different patterns have different capture groups
      if (match.length >= 6) {
        // TypeScript: file(line,col): error TSxxxx: message
        return {
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          code: match[4],
          message: match[5],
        };
      }
      if (match.length >= 5) {
        // ESLint: line:col error message rule
        return {
          line: parseInt(match[1]),
          column: parseInt(match[2]),
          message: match[3],
          code: match[4],
        };
      }
      // Generic
      return { message: match[1] || line };
    }
  }
  return null;
}

function parseWarning(line: string): BuildWarning | null {
  for (const pattern of WARNING_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      if (match.length >= 6) {
        return {
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          code: match[4],
          message: match[5],
        };
      }
      if (match.length >= 5) {
        return {
          line: parseInt(match[1]),
          column: parseInt(match[2]),
          message: match[3],
          code: match[4],
        };
      }
      return { message: match[1] || line };
    }
  }
  return null;
}
