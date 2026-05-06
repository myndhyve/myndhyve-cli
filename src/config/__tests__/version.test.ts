import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { CLI_VERSION, VERSION_STRING } from '../defaults.js';

// Drift gate. Catches the failure mode that took down v0.4.0's
// post-publish smoke test on 2026-05-05: the previous hardcoded
// `CLI_VERSION = '0.1.0'` literal stayed pinned while the npm
// `version` field marched to 0.4.0, so `myndhyve-cli --version`
// reported the wrong version. tsup now injects __CLI_VERSION__
// from package.json at build time. This test reads the same
// package.json in-process and asserts the runtime constant
// matches, so any future regression (someone removes the build
// inject, or the fallback path stops being a fallback) fails CI.
describe('CLI_VERSION', () => {
  it('matches the package.json version field', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('is not the legacy hardcoded 0.1.0 literal', () => {
    // Belt-and-suspenders: even if package.json regressed back to
    // 0.1.0 (it shouldn't), this still flags the literal so a
    // reviewer notices.
    expect(CLI_VERSION).not.toBe('0.1.0');
  });

  it('is not the build-injection fallback (0.0.0)', () => {
    // If __CLI_VERSION__ wasn't injected, defaults.ts falls back
    // to '0.0.0'. Hitting that branch in a test run means the
    // tsup define isn't in effect — not what we want.
    expect(CLI_VERSION).not.toBe('0.0.0');
  });

  it('embeds CLI_VERSION in VERSION_STRING', () => {
    expect(VERSION_STRING).toContain(`myndhyve-cli/${CLI_VERSION}`);
  });
});
