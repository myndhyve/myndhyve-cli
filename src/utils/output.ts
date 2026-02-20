/**
 * MyndHyve CLI — Output Utilities
 *
 * Centralized output helpers that respect --json, --quiet, and --no-color modes.
 * All CLI commands should use these instead of raw console.log for structured output.
 */

export type OutputMode = 'human' | 'json' | 'quiet';

let currentMode: OutputMode = 'human';

export function setOutputMode(mode: OutputMode): void {
  currentMode = mode;
}

export function getOutputMode(): OutputMode {
  return currentMode;
}

// ============================================================================
// EXIT CODES
// ============================================================================

export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  NOT_FOUND: 3,
  UNAUTHORIZED: 4,
  SIGINT: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ============================================================================
// STRUCTURED OUTPUT
// ============================================================================

/**
 * Print command result. In JSON mode, serializes to stdout.
 * In quiet mode, only prints if data is an ID or essential value.
 * In human mode, calls the provided formatter.
 */
export function printResult(
  data: unknown,
  formatter?: () => void
): void {
  if (currentMode === 'json') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (currentMode === 'quiet') {
    // In quiet mode, only output primitive IDs
    if (typeof data === 'string') {
      process.stdout.write(data + '\n');
    }
    return;
  }

  // Human mode: use the formatter
  if (formatter) {
    formatter();
  }
}

/**
 * Print a structured error. In JSON mode, outputs an error object to stderr.
 * In human mode, prints a conversational error message.
 */
export function printErrorResult(error: {
  code: string;
  message: string;
  suggestion?: string;
  docUrl?: string;
}): void {
  if (currentMode === 'json') {
    process.stderr.write(JSON.stringify({ error }, null, 2) + '\n');
    return;
  }

  // Human mode
  process.stderr.write(`\n  Error: ${error.message}\n`);
  if (error.suggestion) {
    process.stderr.write(`  ${error.suggestion}\n`);
  }
  if (error.docUrl) {
    process.stderr.write(`\n  Learn more: ${error.docUrl}\n`);
  }
  process.stderr.write('\n');
}

/**
 * Print a success message (only in human mode).
 */
export function printSuccess(message: string): void {
  if (currentMode === 'human') {
    process.stderr.write(`  ${message}\n`);
  }
}

/**
 * Print an informational hint/suggestion (only in human mode).
 */
export function printHint(message: string): void {
  if (currentMode === 'human') {
    process.stderr.write(`  ${message}\n`);
  }
}

/**
 * Check if the current environment is interactive (TTY).
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && currentMode === 'human';
}
