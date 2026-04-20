/**
 * MyndHyve CLI — Documents (long-form markdown) commands.
 *
 *   myndhyve-cli documents list
 *   myndhyve-cli documents show <doc-id>
 *   myndhyve-cli documents export <doc-id> [--output <file.md>] [--format <pdf|docx|...>]
 *   myndhyve-cli documents import <doc-id> <file> [--theme <id>] [--title <t>]
 *   myndhyve-cli documents create <doc-id> --title <title> [--theme <id>] [--from <file>]
 *   myndhyve-cli documents delete <doc-id> [--yes]
 *   myndhyve-cli documents themes
 *
 * Documents live at
 *   `workspaces/{workspaceId}/canvases/{canvasId}/documents/{documentId}`.
 *
 * Context (workspaceId + canvasId) comes from the active project context
 * set by `myndhyve-cli use <project>`. Remote exports hit the
 * pandoc-export Cloud Run service — URL configured via the
 * `MYNDHYVE_PANDOC_EXPORT_URL` env var (default:
 * https://pandoc-export-gjw5bcse7a-uc.a.run.app).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { getActiveContext } from '../context.js';
import { getToken } from '../auth/index.js';
import {
  BUILT_IN_DOCUMENT_THEMES,
  createDocumentRecord,
  deleteDocumentRecord,
  getDocumentRecord,
  importDocumentMarkdown,
  listAllDocumentThemes,
  listDocumentRecords,
  MAX_DOCUMENT_MARKDOWN_BYTES,
  type DocumentLocation,
  type DocumentThemeSummary,
} from '../api/documents.js';
import { requireAuth, printError, formatRelativeTime, truncate } from './helpers.js';
import {
  ExitCode,
  printErrorResult,
  printResult,
  printSuccess,
} from '../utils/output.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PANDOC_EXPORT_URL = 'https://pandoc-export-gjw5bcse7a-uc.a.run.app';
const REMOTE_FORMATS = ['pdf', 'docx', 'epub', 'odt', 'html', 'tex'] as const;
type RemoteFormat = (typeof REMOTE_FORMATS)[number];

// ============================================================================
// Context resolution
// ============================================================================

function requireDocumentContext(): DocumentLocation | null {
  const context = getActiveContext();
  if (!context) {
    printErrorResult({
      code: 'NO_ACTIVE_CONTEXT',
      message: 'No active project context.',
      suggestion: 'Run `myndhyve-cli use <project-id>` first.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (!context.workspaceId) {
    printErrorResult({
      code: 'NO_WORKSPACE',
      message: 'Active context does not have a workspaceId.',
      suggestion: 'Re-run `myndhyve-cli use <project-id>` to refresh the context.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (!context.canvasId) {
    printErrorResult({
      code: 'NO_CANVAS',
      message: 'No active canvas in the current project context.',
      suggestion:
        'Open the Documents canvas in the web UI once to materialise a canvas id.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  if (context.canvasTypeId !== 'documents') {
    printErrorResult({
      code: 'WRONG_CANVAS_TYPE',
      message: `Active canvas type is "${context.canvasTypeId}" — documents commands require a documents canvas.`,
      suggestion:
        'Switch projects (`myndhyve-cli use <project-id>`) or open a documents canvas in the web UI.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return { workspaceId: context.workspaceId, canvasId: context.canvasId };
}

/**
 * Lighter context check — only needs a workspace (used by `themes` which
 * doesn't target a specific canvas).
 */
function requireWorkspaceId(): string | null {
  const context = getActiveContext();
  if (!context?.workspaceId) {
    printErrorResult({
      code: 'NO_WORKSPACE',
      message: 'No active workspace.',
      suggestion: 'Run `myndhyve-cli use <project-id>` to set an active project.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return null;
  }
  return context.workspaceId;
}

// ============================================================================
// list
// ============================================================================

async function runList(): Promise<void> {
  if (!(await requireAuth())) return;
  const location = requireDocumentContext();
  if (!location) return;

  try {
    const documents = await listDocumentRecords(location);
    if (documents.length === 0) {
      printResult({
        status: 'ok',
        data: {
          message: 'No documents in this canvas yet.',
          suggestion: 'Create one with `myndhyve-cli documents create <doc-id> --title "My Doc"`.',
        },
      });
      return;
    }
    const sorted = [...documents].sort((a, b) => {
      const aAt = a.updatedAt?.getTime() ?? 0;
      const bAt = b.updatedAt?.getTime() ?? 0;
      return bAt - aAt;
    });

    printSuccess(`Documents (${sorted.length})`);
    console.log();
    for (const doc of sorted) {
      const updated = doc.updatedAt ? formatRelativeTime(doc.updatedAt.toISOString()) : '—';
      const sizeKb = (doc.bytes / 1024).toFixed(1);
      console.log(
        `    ${doc.id.padEnd(16)}  ${truncate(doc.title, 40).padEnd(40)}  ${doc.themeId.padEnd(10)}  v${doc.version}  ${sizeKb} KB  ${updated}`,
      );
    }
    console.log();
  } catch (err) {
    printError('Failed to list documents', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

// ============================================================================
// show
// ============================================================================

async function runShow(documentId: string): Promise<void> {
  if (!(await requireAuth())) return;
  const location = requireDocumentContext();
  if (!location) return;

  try {
    const doc = await getDocumentRecord(location, documentId);
    if (!doc) {
      printErrorResult({
        code: 'DOC_NOT_FOUND',
        message: `Document "${documentId}" not found in the active canvas.`,
        suggestion: 'Run `myndhyve-cli documents list` to see available ids.',
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }
    console.log();
    console.log(`  ${doc.title}`);
    console.log(`    id:          ${doc.id}`);
    console.log(`    theme:       ${doc.themeId}`);
    console.log(`    page size:   ${doc.chrome.pageSize}`);
    console.log(`    version:     ${doc.version}`);
    console.log(`    markdown:    ${doc.markdown.length} chars · ${(new TextEncoder().encode(doc.markdown).length / 1024).toFixed(1)} KB`);
    if (doc.updatedAt) {
      console.log(`    updated:     ${doc.updatedAt.toISOString()}`);
    }
    console.log();
  } catch (err) {
    printError('Failed to show document', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

// ============================================================================
// export
// ============================================================================

async function runExport(
  documentId: string,
  opts: { output?: string; format?: string },
): Promise<void> {
  if (!(await requireAuth())) return;
  const location = requireDocumentContext();
  if (!location) return;

  const format = (opts.format ?? 'md').toLowerCase();

  try {
    const doc = await getDocumentRecord(location, documentId);
    if (!doc) {
      printErrorResult({
        code: 'DOC_NOT_FOUND',
        message: `Document "${documentId}" not found.`,
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }

    if (format === 'md') {
      if (opts.output) {
        const targetPath = resolve(process.cwd(), opts.output);
        writeFileSync(targetPath, doc.markdown, 'utf8');
        printSuccess(`Wrote ${doc.markdown.length} chars to ${targetPath}`);
      } else {
        process.stdout.write(doc.markdown);
      }
      return;
    }

    // Remote format — hit the pandoc-export Cloud Run service.
    if (!REMOTE_FORMATS.includes(format as RemoteFormat)) {
      printErrorResult({
        code: 'UNSUPPORTED_FORMAT',
        message: `Unknown format "${format}".`,
        suggestion: `Try one of: md, ${REMOTE_FORMATS.join(', ')}.`,
      });
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    const result = await runRemoteExport({
      location,
      doc,
      format: format as RemoteFormat,
    });
    if (!result.ok) {
      printErrorResult(result.error);
      process.exitCode = ExitCode.GENERAL_ERROR;
      return;
    }

    if (opts.output) {
      const targetPath = resolve(process.cwd(), opts.output);
      writeFileSync(targetPath, Buffer.from(result.bytes));
      printSuccess(
        `Wrote ${result.bytes.byteLength.toLocaleString()} bytes to ${targetPath} (signed URL valid 15 min)`,
      );
    } else {
      process.stdout.write(`Signed URL: ${result.signedUrl}\n`);
      process.stdout.write(`Expires:    ${result.expiresAt}\n`);
      process.stdout.write(
        `Download:   curl -o "${documentId}.${result.extension}" "${result.signedUrl}"\n`,
      );
    }
  } catch (err) {
    printError('Failed to export document', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

interface RemoteExportOk {
  ok: true;
  signedUrl: string;
  expiresAt: string;
  extension: string;
  bytes: Uint8Array;
}

interface RemoteExportErr {
  ok: false;
  error: { code: string; message: string; suggestion?: string };
}

async function runRemoteExport(args: {
  location: DocumentLocation;
  doc: { id: string; title: string; markdown: string; themeId: string };
  format: RemoteFormat;
}): Promise<RemoteExportOk | RemoteExportErr> {
  const base = process.env.MYNDHYVE_PANDOC_EXPORT_URL ?? DEFAULT_PANDOC_EXPORT_URL;
  const token = await getToken();
  const url = `${base.replace(/\/$/, '')}/export`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: args.location.workspaceId,
      documentId: args.doc.id,
      markdown: args.doc.markdown,
      format: args.format,
      themeId: args.doc.themeId,
      title: args.doc.title,
      filename: args.doc.title,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      error: {
        code: `HTTP_${response.status}`,
        message: `pandoc-export returned ${response.status}`,
        suggestion: text.slice(0, 200),
      },
    };
  }

  const body = (await response.json()) as {
    signedUrl: string;
    expiresAt: string;
    extension: string;
  };

  const fileResponse = await fetch(body.signedUrl);
  if (!fileResponse.ok) {
    return {
      ok: false,
      error: {
        code: 'SIGNED_URL_FETCH_FAILED',
        message: `Could not fetch signed URL (${fileResponse.status}).`,
        suggestion: 'Try again — signed URLs expire after 15 min.',
      },
    };
  }
  const bytes = new Uint8Array(await fileResponse.arrayBuffer());
  return {
    ok: true,
    signedUrl: body.signedUrl,
    expiresAt: body.expiresAt,
    extension: body.extension,
    bytes,
  };
}

// ============================================================================
// import
// ============================================================================

async function runImport(
  documentId: string,
  file: string,
  opts: { theme?: string; title?: string },
): Promise<void> {
  if (!(await requireAuth())) return;
  const location = requireDocumentContext();
  if (!location) return;

  const targetPath = resolve(process.cwd(), file);
  let markdown: string;
  try {
    markdown = readFileSync(targetPath, 'utf8');
  } catch (err) {
    printError(`Could not read "${targetPath}"`, err);
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  const bytes = new TextEncoder().encode(markdown).length;
  if (bytes > MAX_DOCUMENT_MARKDOWN_BYTES) {
    printErrorResult({
      code: 'SIZE_EXCEEDED',
      message: `File is ${bytes.toLocaleString()} bytes — above the ${MAX_DOCUMENT_MARKDOWN_BYTES.toLocaleString()}-byte ceiling.`,
      suggestion: 'Split into chapters or remove embedded base64 images.',
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }

  try {
    const result = await importDocumentMarkdown(location, {
      documentId,
      markdown,
      ...(opts.theme ? { themeId: opts.theme } : {}),
      ...(opts.title ? { title: opts.title } : {}),
    });
    if (!result.ok) {
      switch (result.reason) {
        case 'not-found':
          printErrorResult({
            code: 'DOC_NOT_FOUND',
            message: `Document "${documentId}" does not exist.`,
            suggestion: `Create it first: \`myndhyve-cli documents create ${documentId} --title "..."\`.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        case 'conflict':
          printErrorResult({
            code: 'CONFLICT',
            message: 'Another edit landed between read + write.',
            suggestion: 'Retry the import; the server will apply against the latest state.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        case 'size-exceeded':
          printErrorResult({
            code: 'SIZE_EXCEEDED',
            message: `Payload ${result.bytes?.toLocaleString() ?? '?'} bytes exceeds the ceiling.`,
          });
          process.exitCode = ExitCode.USAGE_ERROR;
          return;
        default:
          printError('Import failed', result.error);
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
      }
    }
    printSuccess(
      `Imported ${bytes.toLocaleString()} bytes into "${result.document.title}" (version ${result.document.version}).`,
    );
  } catch (err) {
    printError('Import failed', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

// ============================================================================
// create
// ============================================================================

async function runCreate(
  documentId: string,
  opts: { title?: string; theme?: string; from?: string },
): Promise<void> {
  if (!(await requireAuth())) return;
  if (!opts.title) {
    printErrorResult({
      code: 'MISSING_TITLE',
      message: 'Title is required.',
      suggestion: `Usage: myndhyve-cli documents create ${documentId} --title "My Doc"`,
    });
    process.exitCode = ExitCode.USAGE_ERROR;
    return;
  }
  const location = requireDocumentContext();
  if (!location) return;

  let markdown: string | undefined;
  if (opts.from) {
    try {
      markdown = readFileSync(resolve(process.cwd(), opts.from), 'utf8');
    } catch (err) {
      printError(`Could not read seed file "${opts.from}"`, err);
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }
  }

  try {
    const doc = await createDocumentRecord(location, {
      id: documentId,
      title: opts.title,
      ...(opts.theme ? { themeId: opts.theme } : {}),
      ...(markdown !== undefined ? { markdown } : {}),
    });
    printSuccess(`Created "${doc.title}" (${documentId}) with theme "${doc.themeId}".`);
  } catch (err) {
    printError('Create failed', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

// ============================================================================
// delete
// ============================================================================

async function runDelete(documentId: string, opts: { yes?: boolean }): Promise<void> {
  if (!(await requireAuth())) return;
  const location = requireDocumentContext();
  if (!location) return;

  // Confirm unless --yes. TTY check prevents accidental pipe-to-yes.
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      printErrorResult({
        code: 'NON_INTERACTIVE',
        message: 'Refusing to delete without confirmation in a non-interactive shell.',
        suggestion: 'Re-run with `--yes` to bypass the confirmation prompt.',
      });
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }
    const { default: inquirer } = await import('inquirer');
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Delete document "${documentId}"? This cannot be undone.`,
        default: false,
      },
    ]);
    if (!confirm) {
      printSuccess('Aborted — no changes.');
      return;
    }
  }

  try {
    await deleteDocumentRecord(location, documentId);
    printSuccess(`Deleted document "${documentId}".`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404') || message.includes('NOT_FOUND')) {
      printErrorResult({
        code: 'DOC_NOT_FOUND',
        message: `Document "${documentId}" does not exist — nothing to delete.`,
      });
      process.exitCode = ExitCode.NOT_FOUND;
      return;
    }
    printError('Delete failed', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

// ============================================================================
// themes
// ============================================================================

async function runThemes(): Promise<void> {
  if (!(await requireAuth())) return;
  const workspaceId = requireWorkspaceId();
  if (!workspaceId) return;

  try {
    const { builtIn, custom } = await listAllDocumentThemes(workspaceId);

    console.log();
    console.log(`  Built-in themes (${builtIn.length})`);
    console.log();
    for (const theme of builtIn) {
      console.log(
        `    ${theme.id.padEnd(14)} ${truncate(theme.description ?? '', 50).padEnd(50)} ${theme.accent ?? ''}`,
      );
    }
    console.log();

    if (custom.length > 0) {
      console.log(`  Workspace custom themes (${custom.length})`);
      console.log();
      for (const theme of custom) {
        console.log(
          `    ${theme.id.padEnd(14)} ${truncate(theme.description ?? '', 50).padEnd(50)}`,
        );
      }
      console.log();
    } else {
      console.log('  No workspace custom themes uploaded.');
      console.log('  Workspace admins can upload via the Documents → Themes panel in the web UI.');
      console.log();
    }

    // Unused suppression for the imported type (keeps the export available
    // to other commands that surface theme rows with the same shape).
    void ({} as DocumentThemeSummary);
  } catch (err) {
    printError('Failed to list themes', err);
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

// ============================================================================
// Register
// ============================================================================

export function registerDocumentsCommands(program: Command): void {
  const documents = program
    .command('documents')
    .description('Manage long-form markdown documents in the active documents canvas');

  documents
    .command('list')
    .description('List documents in the active canvas')
    .action(async () => {
      await runList();
    });

  documents
    .command('show <doc-id>')
    .description('Show document metadata (title, theme, version, size)')
    .action(async (documentId: string) => {
      await runShow(documentId);
    });

  documents
    .command('export <doc-id>')
    .description(
      'Export a document — markdown by default, or a remote format (pdf/docx/epub/odt/html/tex) via pandoc-export',
    )
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .option(
      '-f, --format <format>',
      'Output format: md (default) | pdf | docx | epub | odt | html | tex',
      'md',
    )
    .action(async (documentId: string, opts: { output?: string; format?: string }) => {
      await runExport(documentId, opts);
    });

  documents
    .command('import <doc-id> <file>')
    .description("Replace a document's markdown with the contents of <file>")
    .option('--theme <id>', 'Switch theme as part of the import')
    .option('--title <title>', 'Override the document title')
    .action(async (documentId: string, file: string, opts: { theme?: string; title?: string }) => {
      await runImport(documentId, file, opts);
    });

  documents
    .command('create <doc-id>')
    .description('Create a new document in the active canvas')
    .requiredOption('--title <title>', 'Document title')
    .option(
      '--theme <id>',
      'Theme id (default, serif, myndhyve, or a workspace custom)',
      'default',
    )
    .option('--from <file>', 'Seed the new document with markdown from a file')
    .action(
      async (documentId: string, opts: { title?: string; theme?: string; from?: string }) => {
        await runCreate(documentId, opts);
      },
    );

  documents
    .command('delete <doc-id>')
    .description('Delete a document (interactive confirm; pass --yes to bypass)')
    .option('-y, --yes', 'Skip the confirmation prompt (required in non-interactive shells)')
    .action(async (documentId: string, opts: { yes?: boolean }) => {
      await runDelete(documentId, opts);
    });

  documents
    .command('themes')
    .description('List available document themes (built-in + workspace custom)')
    .action(async () => {
      await runThemes();
    });

  // Unused suppression for the imported constant (keeps the export
  // available to other commands that might surface theme rows).
  void BUILT_IN_DOCUMENT_THEMES;
}
