/**
 * MyndHyve CLI — Slides (Marp deck) Commands
 *
 *   myndhyve-cli slides list
 *   myndhyve-cli slides show <deck-id>
 *   myndhyve-cli slides export <deck-id> [--output <file.md>]
 *   myndhyve-cli slides import <deck-id> <file.md> [--theme <id>]
 *   myndhyve-cli slides create <deck-id> --title <title> [--theme <id>] [--from <file.md>]
 *
 * Decks live at `workspaces/{workspaceId}/canvases/{canvasId}/decks/{deckId}`.
 * Context (workspaceId + canvasId) comes from the active project context
 * set by `myndhyve-cli use <project>`. All imports use a Firestore
 * `currentDocument.updateTime` precondition so concurrent web edits
 * surface as a conflict instead of silently clobbering a newer version.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { getActiveContext } from '../context.js';
import {
  createDeck,
  deleteDeck,
  getDeck,
  importDeckMarkdown,
  listAllThemes,
  listDecks,
  type DeckLocation,
  type SlideThemeSummary,
} from '../api/slides.js';
// `BUILT_IN_THEMES` is not re-exported here; `listAllThemes` merges it in.
import { requireAuth, printError, truncate, formatRelativeTime } from './helpers.js';
import {
  ExitCode,
  printErrorResult,
  printResult,
  printSuccess,
} from '../utils/output.js';

// ============================================================================
// Context resolution
// ============================================================================

function requireDeckContext(): DeckLocation | null {
  const context = getActiveContext();
  if (!context) {
    printErrorResult({
      code: 'NO_ACTIVE_CONTEXT',
      message: 'No active project context.',
      suggestion: 'Run `myndhyve-cli use <project-id>` to set an active project, then retry.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (!context.workspaceId) {
    printErrorResult({
      code: 'NO_WORKSPACE',
      message: 'Active context does not have a workspaceId.',
      suggestion: 'Re-run `myndhyve-cli use <project-id>` — the latest CLI versions record workspaceId on context set.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (!context.canvasId) {
    printErrorResult({
      code: 'NO_CANVAS',
      message: 'No active canvas in the current project context.',
      suggestion: 'Open the Slides canvas in the web UI once to materialise a canvas id, or set the canvas manually via `myndhyve-cli use <project-id> --canvas <id>`.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (context.canvasTypeId !== 'slides') {
    printErrorResult({
      code: 'WRONG_CANVAS_TYPE',
      message: `Active canvas type is "${context.canvasTypeId}" — slides commands require a slides canvas.`,
      suggestion: 'Switch projects (`myndhyve-cli use <project-id>`) or open a slides canvas in the web UI first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return { workspaceId: context.workspaceId, canvasId: context.canvasId };
}

/**
 * Lightweight context requirement for workspace-scoped commands that
 * don't need a specific canvas (e.g. `slides themes`). Only checks that
 * an active context exists + carries a workspaceId.
 */
function requireWorkspaceId(): string | null {
  const context = getActiveContext();
  if (!context) {
    printErrorResult({
      code: 'NO_ACTIVE_CONTEXT',
      message: 'No active project context.',
      suggestion: 'Run `myndhyve-cli use <project-id>` to set an active project, then retry.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (!context.workspaceId) {
    printErrorResult({
      code: 'NO_WORKSPACE',
      message: 'Active context does not have a workspaceId.',
      suggestion: 'Re-run `myndhyve-cli use <project-id>` to refresh context.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return context.workspaceId;
}

// ============================================================================
// Commands
// ============================================================================

async function runList(): Promise<void> {
  if (!requireAuth()) return;
  const location = requireDeckContext();
  if (!location) return;

  try {
    const decks = await listDecks(location);
    printResult(decks, () => {
      if (decks.length === 0) {
        process.stdout.write('\n  No decks in this canvas yet.\n\n');
        return;
      }
      process.stdout.write(`\n  Decks (${decks.length})\n\n`);
      for (const deck of decks) {
        const when = deck.updatedAt ? formatRelativeTime(deck.updatedAt.toISOString()) : '—';
        process.stdout.write(
          `    ${deck.id}  ${truncate(deck.title, 36).padEnd(38)} ` +
            `${deck.themeId.padEnd(10)} ` +
            `v${String(deck.version).padStart(3)} ` +
            `${String(deck.slideCount).padStart(3)} slides  ${when}\n`,
        );
      }
      process.stdout.write('\n');
    });
  } catch (error) {
    printError('Failed to list decks', error);
  }
}

async function runShow(deckId: string): Promise<void> {
  if (!requireAuth()) return;
  const location = requireDeckContext();
  if (!location) return;

  try {
    const deck = await getDeck(location, deckId);
    if (!deck) {
      printErrorResult({
        code: 'DECK_NOT_FOUND',
        message: `Deck not found: ${deckId}`,
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }
    printResult(deck, () => {
      const slides = deck.slideOffsets.length + 1;
      process.stdout.write(`\n  ${deck.title}\n`);
      process.stdout.write(`    id:          ${deck.id}\n`);
      process.stdout.write(`    theme:       ${deck.themeId}\n`);
      process.stdout.write(`    aspect:      ${deck.aspectRatio}\n`);
      process.stdout.write(`    slides:      ${slides}\n`);
      process.stdout.write(`    version:     ${deck.version}\n`);
      if (deck.updatedAt) {
        process.stdout.write(`    updated:     ${deck.updatedAt.toISOString()} (${formatRelativeTime(deck.updatedAt.toISOString())})\n`);
      }
      if (deck.thumbnails && deck.thumbnails.length > 0) {
        process.stdout.write(`    thumbnails:  ${deck.thumbnails.length} signed URLs\n`);
      }
      process.stdout.write(`    markdown:    ${deck.markdown.length} chars\n\n`);
    });
  } catch (error) {
    printError('Failed to fetch deck', error);
  }
}

async function runExport(deckId: string, opts: { output?: string }): Promise<void> {
  if (!requireAuth()) return;
  const location = requireDeckContext();
  if (!location) return;

  try {
    const deck = await getDeck(location, deckId);
    if (!deck) {
      printErrorResult({
        code: 'DECK_NOT_FOUND',
        message: `Deck not found: ${deckId}`,
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }
    if (opts.output) {
      const path = resolve(opts.output);
      writeFileSync(path, deck.markdown, 'utf8');
      printSuccess(`Wrote ${deck.markdown.length} chars to ${path}`);
    } else {
      // No output file — dump markdown to stdout so it can be piped.
      process.stdout.write(deck.markdown);
      if (!deck.markdown.endsWith('\n')) process.stdout.write('\n');
    }
  } catch (error) {
    printError('Failed to export deck', error);
  }
}

async function runImport(
  deckId: string,
  file: string,
  opts: { theme?: string },
): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;
  const location = requireDeckContext();
  if (!location) return;

  let markdown: string;
  try {
    markdown = readFileSync(resolve(file), 'utf8');
  } catch (error) {
    printError(`Cannot read ${file}`, error);
    return;
  }

  try {
    const result = await importDeckMarkdown(location, {
      deckId,
      markdown,
      themeId: opts.theme,
      updatedBy: auth.uid,
    });

    if (!result.ok) {
      if (result.reason === 'not-found') {
        printErrorResult({
          code: 'DECK_NOT_FOUND',
          message: `Deck not found: ${deckId}`,
          suggestion: 'Run `myndhyve-cli slides create <deck-id> --title "<title>"` first, or target an existing deck id from `slides list`.',
        });
        process.exitCode = ExitCode.NOT_FOUND;
        return;
      }
      if (result.reason === 'conflict') {
        printErrorResult({
          code: 'DECK_VERSION_CONFLICT',
          message: 'Deck has changed on the server since we read it.',
          suggestion: 'Pull the latest with `myndhyve-cli slides export <deck-id>`, resolve your edits against it, then retry.',
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }
      printError('Import failed', result.error ?? new Error('unknown write error'));
      return;
    }

    printResult(
      { ok: true, deckId: result.deck.id, version: result.deck.version, slides: result.deck.slideOffsets.length + 1 },
      () => {
        printSuccess(
          `Imported ${markdown.length} chars → ${result.deck.id} ` +
            `(v${result.deck.version}, ${result.deck.slideOffsets.length + 1} slides)`,
        );
      },
    );
  } catch (error) {
    printError('Failed to import deck', error);
  }
}

async function runCreate(
  deckId: string,
  opts: { title?: string; theme?: string; from?: string; aspect?: string },
): Promise<void> {
  const auth = requireAuth();
  if (!auth) return;
  const location = requireDeckContext();
  if (!location) return;

  if (!opts.title) {
    printErrorResult({
      code: 'MISSING_TITLE',
      message: '--title is required.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  let markdown = '';
  if (opts.from) {
    try {
      markdown = readFileSync(resolve(opts.from), 'utf8');
    } catch (error) {
      printError(`Cannot read ${opts.from}`, error);
      return;
    }
  }

  const aspectRatio = opts.aspect === '4:3' ? '4:3' : '16:9';

  try {
    const existing = await getDeck(location, deckId);
    if (existing) {
      printErrorResult({
        code: 'DECK_EXISTS',
        message: `Deck ${deckId} already exists.`,
        suggestion: 'Use a different id, or run `slides import <deck-id> <file>` to overwrite.',
      });
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    const deck = await createDeck(location, {
      id: deckId,
      title: opts.title,
      themeId: opts.theme ?? 'default',
      markdown,
      aspectRatio,
      updatedBy: auth.uid,
    });
    printResult(
      { ok: true, deckId: deck.id, version: deck.version },
      () => {
        printSuccess(
          `Created ${deck.id} (${deck.title}) — theme: ${deck.themeId}, aspect: ${deck.aspectRatio}`,
        );
      },
    );
  } catch (error) {
    printError('Failed to create deck', error);
  }
}

async function runDelete(deckId: string, opts: { yes?: boolean }): Promise<void> {
  if (!requireAuth()) return;
  const location = requireDeckContext();
  if (!location) return;

  try {
    const deck = await getDeck(location, deckId);
    if (!deck) {
      printErrorResult({
        code: 'DECK_NOT_FOUND',
        message: `Deck not found: ${deckId}`,
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }

    if (!opts.yes) {
      // Only confirm interactively when stdin is a TTY — CI flows should
      // always pass --yes.
      if (!process.stdin.isTTY) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: 'Refusing to delete without explicit --yes in a non-interactive shell.',
          suggestion: 'Re-run with `--yes` to bypass the confirmation prompt.',
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      const inquirer = (await import('inquirer')).default;
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete deck "${deck.title}" (${deck.id}) — ${deck.slideOffsets.length + 1} slides, v${deck.version}? This cannot be undone.`,
          default: false,
        },
      ]);
      if (!confirm) {
        printSuccess('Cancelled.');
        return;
      }
    }

    await deleteDeck(location, deckId);
    printResult(
      { ok: true, deletedDeckId: deckId },
      () => {
        printSuccess(`Deleted ${deckId} (${deck.title}).`);
      },
    );
  } catch (error) {
    printError('Failed to delete deck', error);
  }
}

async function runThemes(): Promise<void> {
  if (!requireAuth()) return;
  const workspaceId = requireWorkspaceId();
  if (!workspaceId) return;

  try {
    const themes = await listAllThemes(workspaceId);
    printResult(themes, () => {
      const builtIns = themes.filter((t) => t.isBuiltIn);
      const custom = themes.filter((t) => !t.isBuiltIn);
      process.stdout.write(`\n  Built-in themes (${builtIns.length})\n\n`);
      for (const theme of builtIns) {
        renderThemeRow(theme);
      }
      if (custom.length > 0) {
        process.stdout.write(`\n  Workspace custom themes (${custom.length})\n\n`);
        for (const theme of custom) {
          renderThemeRow(theme);
        }
      } else {
        process.stdout.write(`\n  No workspace custom themes uploaded.\n`);
        process.stdout.write(
          `  Workspace admins can upload via the Slides → Themes panel in the web UI.\n`,
        );
      }
      process.stdout.write('\n');
    });
  } catch (error) {
    printError('Failed to list themes', error);
  }
}

function renderThemeRow(theme: SlideThemeSummary): void {
  const bg = theme.preview?.background ?? '?';
  const fg = theme.preview?.foreground ?? '?';
  const accent = theme.preview?.accent ?? '?';
  process.stdout.write(`    ${theme.id.padEnd(14)} ${truncate(theme.description ?? '', 48).padEnd(50)}`);
  process.stdout.write(`  bg=${bg}  fg=${fg}  accent=${accent}\n`);
}

async function runPresent(
  deckId: string,
  opts: { port?: string; marp?: string; output?: string },
): Promise<void> {
  if (!requireAuth()) return;
  const location = requireDeckContext();
  if (!location) return;

  try {
    const deck = await getDeck(location, deckId);
    if (!deck) {
      printErrorResult({
        code: 'DECK_NOT_FOUND',
        message: `Deck not found: ${deckId}`,
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }

    // Spool the deck to a directory so marp-cli can watch it.
    const dir = opts.output
      ? resolve(opts.output)
      : mkdtempSync(join(tmpdir(), 'myndhyve-slides-'));
    const filePath = join(dir, `${deck.id}.md`);
    writeFileSync(filePath, deck.markdown, 'utf8');
    printSuccess(`Exported to ${filePath}`);

    const port = opts.port ?? '8080';
    // Binary resolution:
    //   --marp <path>   → run the user-supplied binary directly
    //   default         → `npx -y @marp-team/marp-cli` so npx uses the
    //                     local install if present, otherwise fetches.
    // The CLI does NOT bundle marp-cli as a dep — it would balloon the
    // package past 150 MB (chromium). npx keeps the cost opt-in.
    const cmd = opts.marp ?? 'npx';
    const argv = opts.marp
      ? ['--server', '--port', port, dir]
      : ['-y', '@marp-team/marp-cli', '--server', '--port', port, dir];

    printSuccess(`Starting marp-cli server at http://localhost:${port} — Ctrl+C to stop.`);

    const cleanup = (): void => {
      if (!opts.output) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* swallow — process is exiting */
        }
      }
    };
    process.on('SIGINT', () => {
      cleanup();
      process.exit(130);
    });
    process.on('exit', cleanup);

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(cmd, argv, { stdio: 'inherit' });
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          printErrorResult({
            code: 'MARP_NOT_FOUND',
            message: `Could not spawn "${cmd}".`,
            suggestion:
              opts.marp
                ? `The file ${cmd} either does not exist or is not executable.`
                : 'Install Node.js ≥ 16 so `npx` is available, or pass `--marp /path/to/marp` pointing at a local install.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          resolvePromise();
          return;
        }
        rejectPromise(err);
      });
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          printErrorResult({
            code: 'MARP_EXITED_NONZERO',
            message: `marp-cli exited with code ${code}.`,
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
        resolvePromise();
      });
    });
  } catch (error) {
    printError('Failed to present deck', error);
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerSlidesCommands(program: Command): void {
  const slides = program
    .command('slides')
    .description('Manage Marp decks in the active slides canvas');

  slides
    .command('list')
    .description('List decks in the active slides canvas')
    .action(async () => {
      await runList();
    });

  slides
    .command('show <deck-id>')
    .description('Show deck metadata (title, theme, version, slide count, thumbnails)')
    .action(async (deckId: string) => {
      await runShow(deckId);
    });

  slides
    .command('export <deck-id>')
    .description('Export a deck as canonical Marp Markdown')
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .action(async (deckId: string, opts: { output?: string }) => {
      await runExport(deckId, opts);
    });

  slides
    .command('import <deck-id> <file>')
    .description('Replace a deck\'s markdown with the contents of <file>')
    .option('--theme <id>', 'Switch theme as part of the import')
    .action(async (deckId: string, file: string, opts: { theme?: string }) => {
      await runImport(deckId, file, opts);
    });

  slides
    .command('create <deck-id>')
    .description('Create a new deck in the active slides canvas')
    .requiredOption('--title <title>', 'Deck title')
    .option('--theme <id>', 'Theme id (default, gaia, uncover, myndhyve, or a workspace custom)', 'default')
    .option('--from <file>', 'Seed the new deck with markdown from a file')
    .option('--aspect <ratio>', 'Aspect ratio (16:9 or 4:3)', '16:9')
    .action(async (deckId: string, opts: { title?: string; theme?: string; from?: string; aspect?: string }) => {
      await runCreate(deckId, opts);
    });

  slides
    .command('delete <deck-id>')
    .description('Delete a deck from the active slides canvas (interactive confirm; pass --yes to bypass)')
    .option('-y, --yes', 'Skip the confirmation prompt (required in non-interactive shells)')
    .action(async (deckId: string, opts: { yes?: boolean }) => {
      await runDelete(deckId, opts);
    });

  slides
    .command('themes')
    .description('List available slide themes (built-in + workspace custom)')
    .action(async () => {
      await runThemes();
    });

  slides
    .command('present <deck-id>')
    .description('Export deck markdown to a temp file and launch marp-cli in server mode')
    .option('-p, --port <port>', 'HTTP port for the marp-cli server', '8080')
    .option('--marp <path>', 'Path to a local marp binary (bypass the `npx` fallback)')
    .option('-o, --output <dir>', 'Persist the exported markdown in <dir> instead of a temp directory')
    .action(async (deckId: string, opts: { port?: string; marp?: string; output?: string }) => {
      await runPresent(deckId, opts);
    });
}
