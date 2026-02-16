/**
 * MyndHyve CLI — Terminal Markdown Renderer
 *
 * Converts markdown text to chalk-styled terminal output.
 * Handles the common markdown patterns used in AI responses:
 * headers, bold, italic, code blocks, inline code, lists, links, blockquotes.
 *
 * This is intentionally lightweight — no external markdown parser needed.
 */

// ============================================================================
// TYPES
// ============================================================================

/** Configuration for the renderer. */
export interface RendererConfig {
  /** Whether to enable syntax highlighting in code blocks. */
  highlightCode?: boolean;
  /** Maximum line width for wrapping (0 = no wrap). */
  maxWidth?: number;
  /** Indent prefix for all output. */
  indent?: string;
}

const DEFAULT_CONFIG: Required<RendererConfig> = {
  highlightCode: true,
  maxWidth: 0,
  indent: '  ',
};

// ============================================================================
// BLOCK-LEVEL RENDERING
// ============================================================================

/**
 * Render a complete markdown string to styled terminal output.
 *
 * Processes block-level elements (headers, code blocks, lists, blockquotes)
 * then applies inline formatting (bold, italic, inline code, links).
 */
export async function renderMarkdown(
  text: string,
  config?: RendererConfig
): Promise<string> {
  const chalk = (await import('chalk')).default;
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced Code Blocks ────────────────────────────────────────────
    const codeMatch = line.match(/^```(\w*)$/);
    if (codeMatch) {
      const language = codeMatch[1] || '';
      const codeLines: string[] = [];
      i++;

      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }

      // Skip closing ```
      if (i < lines.length) i++;

      // Render code block
      if (language) {
        output.push(
          cfg.indent + chalk.dim(`  ${language}`)
        );
      }
      output.push(cfg.indent + chalk.dim('  ─'.repeat(30)));
      for (const codeLine of codeLines) {
        output.push(cfg.indent + chalk.cyan(`  ${codeLine}`));
      }
      output.push(cfg.indent + chalk.dim('  ─'.repeat(30)));
      output.push('');
      continue;
    }

    // ── Headers ───────────────────────────────────────────────────────
    const h1Match = line.match(/^# (.+)$/);
    if (h1Match) {
      output.push('');
      output.push(cfg.indent + chalk.bold.cyan(h1Match[1]));
      output.push(cfg.indent + chalk.dim('═'.repeat(h1Match[1].length)));
      output.push('');
      i++;
      continue;
    }

    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      output.push('');
      output.push(cfg.indent + chalk.bold.white(h2Match[1]));
      output.push(cfg.indent + chalk.dim('─'.repeat(h2Match[1].length)));
      output.push('');
      i++;
      continue;
    }

    const h3Match = line.match(/^### (.+)$/);
    if (h3Match) {
      output.push('');
      output.push(cfg.indent + chalk.bold(h3Match[1]));
      output.push('');
      i++;
      continue;
    }

    const h4Match = line.match(/^#### (.+)$/);
    if (h4Match) {
      output.push(cfg.indent + chalk.underline(h4Match[1]));
      i++;
      continue;
    }

    // ── Blockquotes ───────────────────────────────────────────────────
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      output.push(
        cfg.indent + chalk.dim('│ ') + chalk.italic(applyInline(chalk, quoteMatch[1]))
      );
      i++;
      continue;
    }

    // ── Horizontal Rule ───────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      output.push(cfg.indent + chalk.dim('─'.repeat(40)));
      i++;
      continue;
    }

    // ── Unordered Lists ───────────────────────────────────────────────
    const ulMatch = line.match(/^(\s*)[*-]\s+(.+)$/);
    if (ulMatch) {
      const depth = Math.floor(ulMatch[1].length / 2);
      const bullet = depth === 0 ? '•' : depth === 1 ? '◦' : '▸';
      const indent = '  '.repeat(depth);
      output.push(
        cfg.indent + indent + chalk.dim(bullet) + ' ' + applyInline(chalk, ulMatch[2])
      );
      i++;
      continue;
    }

    // ── Ordered Lists ─────────────────────────────────────────────────
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      const depth = Math.floor(olMatch[1].length / 3);
      const indent = '  '.repeat(depth);
      output.push(
        cfg.indent + indent + chalk.dim(`${olMatch[2]}.`) + ' ' + applyInline(chalk, olMatch[3])
      );
      i++;
      continue;
    }

    // ── Empty Lines ───────────────────────────────────────────────────
    if (line.trim() === '') {
      output.push('');
      i++;
      continue;
    }

    // ── Regular Paragraphs ────────────────────────────────────────────
    output.push(cfg.indent + applyInline(chalk, line));
    i++;
  }

  return output.join('\n');
}

// ============================================================================
// INLINE FORMATTING
// ============================================================================

type ChalkInstance = typeof import('chalk').default;

/**
 * Apply inline markdown formatting to a line of text.
 * Handles: bold, italic, inline code, links, strikethrough.
 */
function applyInline(chalk: ChalkInstance, text: string): string {
  // Inline code (must process first to avoid formatting inside code)
  text = text.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));

  // Bold + italic (***text***)
  text = text.replace(/\*{3}([^*]+)\*{3}/g, (_, t) => chalk.bold.italic(t));

  // Bold (**text** or __text__)
  text = text.replace(/\*{2}([^*]+)\*{2}/g, (_, t) => chalk.bold(t));
  text = text.replace(/__([^_]+)__/g, (_, t) => chalk.bold(t));

  // Italic (*text* or _text_)
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, t) => chalk.italic(t));
  text = text.replace(/(?<!_)_([^_]+)_(?!_)/g, (_, t) => chalk.italic(t));

  // Strikethrough (~~text~~)
  text = text.replace(/~~([^~]+)~~/g, (_, t) => chalk.strikethrough(t));

  // Links ([text](url))
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    chalk.underline.blue(label) + chalk.dim(` (${url})`)
  );

  return text;
}

// ============================================================================
// STREAMING RENDERER
// ============================================================================

/**
 * Create a streaming renderer that accumulates deltas for post-render.
 *
 * During streaming, deltas are passed through as-is (inline formatting is
 * applied after completion via {@link renderMarkdown}). This object tracks
 * the raw accumulated content so callers can render the full response once
 * streaming finishes.
 */
export function createStreamRenderer(): {
  /** Process a new delta and return the text to write (pass-through). */
  write: (delta: string) => string;
  /** Get the full accumulated raw content. */
  getContent: () => string;
  /** Reset the renderer state. */
  reset: () => void;
} {
  let rawContent = '';

  return {
    write(delta: string): string {
      rawContent += delta;
      return delta;
    },

    getContent(): string {
      return rawContent;
    },

    reset(): void {
      rawContent = '';
    },
  };
}
