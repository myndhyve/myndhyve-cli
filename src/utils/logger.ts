/**
 * MyndHyve CLI — Logger
 *
 * Lightweight structured logger for CLI output.
 * Respects NO_COLOR env var and non-TTY environments.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',  // gray
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

let globalLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

/**
 * Check if ANSI color output should be suppressed.
 */
function isColorless(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return true;
  if (process.env.TERM === 'dumb') return true;
  // Logger writes to stderr — check stderr TTY status
  if (!process.stderr.isTTY) return true;
  return false;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown> | Error): void;
}

export function createLogger(scope: string): Logger {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown> | Error) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLevel]) return;

    const timestamp = new Date().toISOString().slice(11, 23);
    const levelTag = level.toUpperCase().padEnd(5);
    const noColor = isColorless();

    let line: string;

    if (noColor) {
      line = `${timestamp} ${levelTag} [${scope}] ${message}`;
    } else {
      const color = LEVEL_COLORS[level];
      line = `${RESET}${DIM}${timestamp}${RESET} ${color}${levelTag}${RESET} ${DIM}[${scope}]${RESET} ${message}`;
    }

    if (data) {
      if (data instanceof Error) {
        if (noColor) {
          line += ` ${data.message}`;
        } else {
          line += ` ${LEVEL_COLORS.error}${data.message}${RESET}`;
        }
        if (data.stack && globalLevel === 'debug') {
          line += `\n${data.stack}`;
        }
      } else if (Object.keys(data).length > 0) {
        const formatted = Object.entries(data)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ');
        if (noColor) {
          line += ` ${formatted}`;
        } else {
          line += ` ${DIM}${formatted}${RESET}`;
        }
      }
    }

    // All log output goes to stderr to keep stdout clean for data/pipe output
    process.stderr.write(line + '\n');
  };

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}
