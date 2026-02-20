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
  define: {
    '__BUILD_COMMIT__': JSON.stringify(getGitCommit()),
    '__BUILD_DATE__': JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
