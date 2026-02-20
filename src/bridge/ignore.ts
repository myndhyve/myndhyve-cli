/**
 * MyndHyve CLI — File Ignore Pattern Matching
 *
 * .gitignore-style pattern matching for filtering files during sync.
 * Supports glob patterns with ** for recursive matching.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_IGNORE_PATTERNS } from './types.js';

/**
 * Compiled ignore matcher with cached regex patterns.
 */
export class IgnoreMatcher {
  private patterns: Array<{ regex: RegExp; negated: boolean }> = [];

  constructor(patterns: string[]) {
    for (const raw of patterns) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const negated = trimmed.startsWith('!');
      const pattern = negated ? trimmed.slice(1) : trimmed;
      const regex = globToRegex(pattern);
      this.patterns.push({ regex, negated });
    }
  }

  /**
   * Test whether a relative path should be ignored.
   * Paths should use forward slashes (POSIX-style).
   */
  isIgnored(relativePath: string): boolean {
    // Normalize to forward slashes
    const normalized = relativePath.replace(/\\/g, '/');

    let ignored = false;
    for (const { regex, negated } of this.patterns) {
      if (regex.test(normalized)) {
        ignored = !negated;
      }
    }
    return ignored;
  }
}

/**
 * Create an IgnoreMatcher from default patterns + custom patterns + .gitignore.
 */
export async function createIgnoreMatcher(
  projectRoot: string,
  customPatterns: string[] = []
): Promise<IgnoreMatcher> {
  const patterns = [...DEFAULT_IGNORE_PATTERNS, ...customPatterns];

  // Read .gitignore if it exists
  try {
    const gitignore = await readFile(join(projectRoot, '.gitignore'), 'utf-8');
    const lines = gitignore.split('\n');
    patterns.push(...lines);
  } catch {
    // No .gitignore, that's fine
  }

  return new IgnoreMatcher(patterns);
}

/**
 * Convert a .gitignore-style glob pattern to a RegExp.
 *
 * Supports:
 * - `*` matches anything except `/`
 * - `**` matches anything including `/` (recursive)
 * - `?` matches a single character
 * - Leading `/` anchors to project root
 * - Trailing `/` matches directories only (we match both for simplicity)
 * - `[abc]` character classes
 */
function globToRegex(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;

  // Trailing slash — match the directory and anything under it
  if (p.endsWith('/')) {
    p = p.slice(0, -1) + '/**';
  }

  // Leading slash — anchor to root
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }

  // Escape special regex chars, then convert globs
  let regex = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    const next = p[i + 1];

    if (c === '*' && next === '*') {
      // `**/` or `**` at end
      if (p[i + 2] === '/') {
        regex += '(?:.+/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (c === '*') {
      regex += '[^/]*';
      i++;
    } else if (c === '?') {
      regex += '[^/]';
      i++;
    } else if (c === '[') {
      // Pass through character class until ]
      const end = p.indexOf(']', i + 1);
      if (end !== -1) {
        regex += p.slice(i, end + 1);
        i = end + 1;
      } else {
        regex += '\\[';
        i++;
      }
    } else if ('.+^${}()|\\'.includes(c)) {
      regex += '\\' + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }

  // If not anchored, the pattern can match at any depth
  const prefix = anchored ? '^' : '(?:^|/)';
  return new RegExp(prefix + regex + '$');
}
