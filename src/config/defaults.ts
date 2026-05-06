/**
 * MyndHyve CLI — Default Configuration
 */

import { RelayConfigSchema, type RelayConfig } from './types.js';

export const DEFAULT_CONFIG: RelayConfig = RelayConfigSchema.parse({});

// Build-time injection from tsup.config.ts (reads package.json at
// config-load time and replaces this token via esbuild `define`).
// Single source of truth: the npm `version` field. Replaces the
// previous hardcoded constant that drifted to 0.1.0 while the
// package shipped 0.4.0 (caught by post-publish smoke test
// 2026-05-05). A runtime `require('../../package.json')` looks
// tempting but breaks after bundling — `import.meta.url` lives in
// `dist/`, so the relative path resolves outside the cli root.
declare const __CLI_VERSION__: string;
export const CLI_VERSION: string =
  typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0';

export const DEFAULT_SERVER_URL =
  'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway';

/**
 * Cloud Run `workflow-runtime` service URL — the canonical WOP host
 * for the deployed reference implementation. Distinct from the Cloud
 * Functions surface (`DEFAULT_SERVER_URL` above) because workflow-
 * runtime owns the SSE event stream and per-run polling endpoints
 * (`GET /v1/runs/{runId}/events` + `events/poll`) the CLI's `tail` /
 * `run --watch` commands consume.
 *
 * Resolved in this order at call time:
 *   1. `MYNDHYVE_WORKFLOW_RUNTIME_URL` env var (operator override —
 *      useful for staging, local Cloud Run emulator, or a private
 *      replica).
 *   2. The default below (production stable URL hash).
 *
 * Hosts running their own WOP-compliant server can point the CLI at
 * a different runtime via the env var without rebuilding.
 */
export const DEFAULT_WORKFLOW_RUNTIME_URL =
  'https://workflow-runtime-gjw5bcse7a-uc.a.run.app';

export function resolveWorkflowRuntimeUrl(): string {
  return process.env.MYNDHYVE_WORKFLOW_RUNTIME_URL ?? DEFAULT_WORKFLOW_RUNTIME_URL;
}

// Injected at build time by tsup (see tsup.config.ts)
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;

export const BUILD_COMMIT = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev';
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'local';

/**
 * Full version string for --version output.
 * Example: myndhyve-cli/0.4.0 darwin-arm64 node-v22.0.0 (abc1234 2026-02-17)
 */
export const VERSION_STRING =
  `myndhyve-cli/${CLI_VERSION} ${process.platform}-${process.arch} node-${process.version} (${BUILD_COMMIT} ${BUILD_DATE})`;
