import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Read the package.json `version` at config-load time so the bundled
// CLI carries the same version string that npm publishes. Previous
// approach hard-coded `CLI_VERSION = '0.1.0'` in defaults.ts and
// drifted to v0.4.0 (caught by post-publish smoke test 2026-05-05).
// A runtime `require('../../package.json')` looks tempting but breaks
// after bundling — `import.meta.url` lives in `dist/`, so the relative
// path resolves outside the cli root.
function getPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  define: {
    '__BUILD_COMMIT__': JSON.stringify(getGitCommit()),
    '__BUILD_DATE__': JSON.stringify(new Date().toISOString().slice(0, 10)),
    '__CLI_VERSION__': JSON.stringify(getPackageVersion()),
  },
});
