import { describe, it, expect, beforeEach } from 'vitest';
import { renderMarkdown, createStreamRenderer } from '../renderer.js';

// ============================================================================
// renderMarkdown — Block-Level Elements
// ============================================================================

describe('renderMarkdown', () => {
  // ── Headers ──────────────────────────────────────────────────────────

  it('renders H1 headers with separator', async () => {
    const result = await renderMarkdown('# Welcome');

    expect(result).toContain('Welcome');
    // H1 uses a double-line separator (═)
    expect(result).toContain('═');
    // Chalk formatting adds ANSI codes, so output is longer than raw text
    expect(result.length).toBeGreaterThan('# Welcome'.length);
  });

  it('renders H2 headers with separator', async () => {
    const result = await renderMarkdown('## Section Title');

    expect(result).toContain('Section Title');
    // H2 uses a single-line separator (─)
    expect(result).toContain('─');
    expect(result.length).toBeGreaterThan('## Section Title'.length);
  });

  it('renders H3 headers as bold only (no separator)', async () => {
    const result = await renderMarkdown('### Sub Section');

    expect(result).toContain('Sub Section');
    // H3 should NOT include ═ or ─ separators
    expect(result).not.toContain('═');
    expect(result).not.toContain('─');
    // The ### prefix should be stripped from the output
    expect(result).not.toMatch(/###/);
  });

  it('renders H4 headers with underline', async () => {
    const result = await renderMarkdown('#### Minor Heading');

    expect(result).toContain('Minor Heading');
    // The #### prefix should be stripped from the output
    expect(result).not.toMatch(/####/);
  });

  // ── Code Blocks ──────────────────────────────────────────────────────

  it('renders fenced code blocks with language label', async () => {
    const input = '```typescript\nconst x = 1;\n```';
    const result = await renderMarkdown(input);

    // Should contain the language label
    expect(result).toContain('typescript');
    // Should contain the code content
    expect(result).toContain('const x = 1;');
    // Should have code block borders (─ repeated)
    expect(result).toContain('─');
  });

  it('renders code blocks without language', async () => {
    const input = '```\necho hello\n```';
    const result = await renderMarkdown(input);

    // Should contain the code content
    expect(result).toContain('echo hello');
    // Should still have borders
    expect(result).toContain('─');
    // No language label line — just borders + code
  });

  it('renders multi-line code blocks', async () => {
    const input = '```python\ndef foo():\n  return 42\n```';
    const result = await renderMarkdown(input);

    expect(result).toContain('python');
    expect(result).toContain('def foo():');
    expect(result).toContain('return 42');
  });

  // ── Lists ────────────────────────────────────────────────────────────

  it('renders unordered lists with bullet characters', async () => {
    const input = '- First item\n- Second item\n- Third item';
    const result = await renderMarkdown(input);

    // Unordered lists use bullet character (•) at top level
    expect(result).toContain('•');
    expect(result).toContain('First item');
    expect(result).toContain('Second item');
    expect(result).toContain('Third item');
  });

  it('renders nested unordered lists with different bullets', async () => {
    const input = '- Top level\n  - Nested item';
    const result = await renderMarkdown(input);

    // Top level uses •, depth 1 uses ◦
    expect(result).toContain('•');
    expect(result).toContain('◦');
    expect(result).toContain('Top level');
    expect(result).toContain('Nested item');
  });

  it('renders ordered lists with numbers', async () => {
    const input = '1. First step\n2. Second step\n3. Third step';
    const result = await renderMarkdown(input);

    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
    expect(result).toContain('First step');
    expect(result).toContain('Second step');
    expect(result).toContain('Third step');
  });

  // ── Blockquotes ──────────────────────────────────────────────────────

  it('renders blockquotes with vertical bar', async () => {
    const result = await renderMarkdown('> This is a quote');

    // Blockquotes use │ character
    expect(result).toContain('│');
    expect(result).toContain('This is a quote');
  });

  it('renders empty blockquotes', async () => {
    const result = await renderMarkdown('>');

    expect(result).toContain('│');
  });

  // ── Horizontal Rule ──────────────────────────────────────────────────

  it('renders horizontal rules with dashes', async () => {
    const result = await renderMarkdown('---');

    // HR uses ─ repeated
    expect(result).toContain('─');
    // Verify it produced a full separator line (40 repetitions)
    const dashCount = (result.match(/─/g) || []).length;
    expect(dashCount).toBeGreaterThanOrEqual(40);
  });

  it('renders horizontal rules from asterisks', async () => {
    const result = await renderMarkdown('***');

    expect(result).toContain('─');
  });

  it('renders horizontal rules from underscores', async () => {
    const result = await renderMarkdown('___');

    expect(result).toContain('─');
  });

  // ── Empty Lines ──────────────────────────────────────────────────────

  it('renders empty lines as blank output lines', async () => {
    const input = 'line one\n\nline two';
    const result = await renderMarkdown(input);

    expect(result).toContain('line one');
    expect(result).toContain('line two');
    // The blank line produces a '\n\n' sequence in the output
    expect(result).toContain('\n\n');
  });

  // ── Regular Paragraphs ───────────────────────────────────────────────

  it('preserves regular paragraphs with indent', async () => {
    const result = await renderMarkdown('Just a regular paragraph.');

    expect(result).toContain('Just a regular paragraph.');
    // Default config indents with '  '
    expect(result).toMatch(/^\s+Just a regular paragraph\./);
  });

  // ── Inline Formatting ────────────────────────────────────────────────

  it('applies bold formatting to inline text', async () => {
    const result = await renderMarkdown('This is **bold** text');

    expect(result).toContain('bold');
    expect(result).toContain('text');
    // The ** markers should be stripped from the output
    expect(result).not.toContain('**');
  });

  it('applies italic formatting', async () => {
    const result = await renderMarkdown('This is *italic* text');

    expect(result).toContain('italic');
    // The * markers should be consumed by formatting
    // (Note: chalk may or may not emit ANSI codes depending on TTY support)
    expect(result).toContain('This is');
    expect(result).toContain('text');
  });

  it('applies inline code formatting', async () => {
    const result = await renderMarkdown('Use `npm install` here');

    expect(result).toContain('npm install');
    // The backtick markers should be stripped from the output
    expect(result).not.toMatch(/`npm install`/);
  });

  it('applies strikethrough formatting', async () => {
    const result = await renderMarkdown('This is ~~deleted~~ text');

    expect(result).toContain('deleted');
    // The ~~ markers should be stripped from the output
    expect(result).not.toContain('~~');
  });

  it('formats links with label and URL', async () => {
    const result = await renderMarkdown('Visit [GitHub](https://github.com)');

    expect(result).toContain('GitHub');
    expect(result).toContain('https://github.com');
  });

  // ── Complex Documents ────────────────────────────────────────────────

  it('handles complex multi-block documents', async () => {
    const input = [
      '# Project Overview',
      '',
      'This is the intro paragraph.',
      '',
      '## Features',
      '',
      '- Fast rendering',
      '- Easy to use',
      '- **Extensible**',
      '',
      '### Code Example',
      '',
      '```javascript',
      'const app = create();',
      'app.run();',
      '```',
      '',
      '> Note: This is important.',
      '',
      '---',
      '',
      '1. Install the package',
      '2. Configure settings',
      '3. Run the app',
    ].join('\n');

    const result = await renderMarkdown(input);

    // Headers
    expect(result).toContain('Project Overview');
    expect(result).toContain('═'); // H1 separator
    expect(result).toContain('Features');

    // Paragraph
    expect(result).toContain('This is the intro paragraph.');

    // Unordered list
    expect(result).toContain('•');
    expect(result).toContain('Fast rendering');
    expect(result).toContain('Easy to use');
    expect(result).toContain('Extensible');

    // Code block
    expect(result).toContain('javascript');
    expect(result).toContain('const app = create();');
    expect(result).toContain('app.run();');

    // Blockquote
    expect(result).toContain('│');
    expect(result).toContain('This is important.');

    // Ordered list
    expect(result).toContain('1.');
    expect(result).toContain('Install the package');

    // The markdown markers (# ## ### ``` - etc.) should be replaced
    // with styled characters (═ ─ • │ etc.)
    expect(result).not.toContain('## Features');
    expect(result).not.toContain('### Code Example');
  });

  // ── Configuration ────────────────────────────────────────────────────

  it('respects custom indent configuration', async () => {
    const result = await renderMarkdown('Hello world', { indent: '    ' });

    // Should use the custom 4-space indent
    expect(result).toMatch(/^ {4}Hello world/);
  });

  it('renders correctly with empty indent', async () => {
    const result = await renderMarkdown('Hello world', { indent: '' });

    // No leading spaces
    expect(result).toMatch(/^Hello world/);
  });
});

// ============================================================================
// createStreamRenderer
// ============================================================================

describe('createStreamRenderer', () => {
  let renderer: ReturnType<typeof createStreamRenderer>;

  beforeEach(() => {
    renderer = createStreamRenderer();
  });

  it('accumulates content via write()', () => {
    renderer.write('Hello ');
    renderer.write('world');

    expect(renderer.getContent()).toBe('Hello world');
  });

  it('getContent() returns full accumulated text', () => {
    renderer.write('First chunk. ');
    renderer.write('Second chunk. ');
    renderer.write('Third chunk.');

    expect(renderer.getContent()).toBe('First chunk. Second chunk. Third chunk.');
  });

  it('reset() clears state', () => {
    renderer.write('Some content');
    expect(renderer.getContent()).toBe('Some content');

    renderer.reset();
    expect(renderer.getContent()).toBe('');
  });

  it('write() returns the delta text (pass-through)', () => {
    const output = renderer.write('hello');

    expect(output).toBe('hello');
  });

  it('accumulates code blocks as raw content', () => {
    renderer.write('```\n');
    renderer.write('const x = 1;\n');
    renderer.write('```\n');

    expect(renderer.getContent()).toBe('```\nconst x = 1;\n```\n');
  });

  it('accumulates across many small writes', () => {
    const chars = 'Hello, world!'.split('');
    for (const c of chars) {
      renderer.write(c);
    }

    expect(renderer.getContent()).toBe('Hello, world!');
  });

  it('reset() allows reuse for a new response', () => {
    renderer.write('First response');
    renderer.reset();
    renderer.write('Second response');

    expect(renderer.getContent()).toBe('Second response');
  });
});
