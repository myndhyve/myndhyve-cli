/**
 * MyndHyve CLI — Global Options
 *
 * Applies global flags (--no-color, --json, --quiet, --verbose, --debug)
 * to the root Commander program. These are inherited by all subcommands.
 */

import type { Command } from 'commander';
import { setLogLevel } from '../utils/logger.js';
import { setOutputMode } from '../utils/output.js';

export interface GlobalOptions {
  noColor?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

/** Whether --verbose was set (show detailed human-readable output). */
let verboseEnabled = false;

export function isVerbose(): boolean {
  return verboseEnabled;
}

/**
 * Register global flags and a preAction hook that applies them
 * before any subcommand runs.
 */
export function applyGlobalOptions(program: Command): void {
  program
    .option('--no-color', 'Disable colored output')
    .option('--json', 'Output results as JSON')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--verbose', 'Show detailed output')
    .option('--debug', 'Show debug-level diagnostics');

  program.hook('preAction', () => {
    // Walk up the chain to find the root program's options
    const opts = program.opts<GlobalOptions>();

    // --no-color: disable chalk globally
    if (opts.noColor || isColorDisabled()) {
      process.env.NO_COLOR = '1';
    }

    // --json / --quiet: set output mode
    if (opts.json) {
      setOutputMode('json');
      // JSON mode implies no color and no spinners
      process.env.NO_COLOR = '1';
    } else if (opts.quiet) {
      setOutputMode('quiet');
    }

    // --verbose: show detailed output but keep info-level logging
    // --debug: enable internal debug-level log output
    if (opts.debug) {
      setLogLevel('debug');
      verboseEnabled = true;
    } else if (opts.verbose) {
      verboseEnabled = true;
    }
  });
}

/**
 * Check environment signals that indicate color should be disabled.
 */
function isColorDisabled(): boolean {
  // NO_COLOR standard (https://no-color.org)
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return true;

  // TERM=dumb
  if (process.env.TERM === 'dumb') return true;

  // Non-interactive stdout (piped)
  if (!process.stdout.isTTY) return true;

  return false;
}
