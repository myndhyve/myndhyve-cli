import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // `@myndhyve/types` is a workspace-internal `file:` dependency that
  // ships TypeScript source (no compiled JS in the package). Default
  // tsup behavior leaves it as a runtime import, but Node can't load
  // `.ts` files directly — `node dist/index.js` then crashes with
  // ERR_UNKNOWN_FILE_EXTENSION. Inlining the package into the bundle
  // is the correct call: the types package is purely declarative
  // (constants + interfaces), tiny, and conceptually part of the
  // CLI's own surface. Type-only imports were already invisible to
  // the runtime bundle; this only matters for VALUE imports like
  // `isRunErrorCode` / `RUN_ERROR_CODES`.
  noExternal: ['@myndhyve/types'],
  define: {
    '__BUILD_COMMIT__': JSON.stringify(getGitCommit()),
    '__BUILD_DATE__': JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
