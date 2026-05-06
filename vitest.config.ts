import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Mirror the build-time defines from tsup.config.ts so source files
// that read injected globals (e.g. `__CLI_VERSION__` in defaults.ts)
// see the same values during `vitest run` as they do in the published
// bundle. Without this, fallback branches fire under tests and the
// drift-gate assertions on the injected value can't run.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(here, 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  define: {
    '__CLI_VERSION__': JSON.stringify(pkg.version),
    '__BUILD_COMMIT__': JSON.stringify('test'),
    '__BUILD_DATE__': JSON.stringify('test'),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', '__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/types.ts'],
    },
  },
});
