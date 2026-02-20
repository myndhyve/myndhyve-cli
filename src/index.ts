/**
 * MyndHyve CLI — Main Entry Point
 *
 * Launches the Commander CLI. Channel plugins are lazy-loaded by relay
 * commands to keep startup fast for non-relay operations.
 */

import { createProgram } from './cli/program.js';
import { maybeNotifyUpdate } from './cli/update.js';
import { ExitCode } from './utils/output.js';

// ── EPIPE handler ─────────────────────────────────────────────────────────
// When piped to `head`, `less -q`, etc., the downstream reader may close the
// pipe before we finish writing. Node emits an EPIPE error on stdout/stderr.
// This is normal — exit cleanly instead of crashing.

function handlePipeError(err: NodeJS.ErrnoException): void {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
}

process.stdout.on('error', handlePipeError);
process.stderr.on('error', handlePipeError);

// ── Unhandled rejection safety net ──────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`\n  Fatal: ${message}\n\n`);
  process.exitCode = ExitCode.GENERAL_ERROR;
});

// ── Background update check (never blocks) ──────────────────────────────────

maybeNotifyUpdate();

// ── CLI ──────────────────────────────────────────────────────────────────────

const program = createProgram();
program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n  Fatal: ${message}\n\n`);
  process.exitCode = ExitCode.GENERAL_ERROR;
});
