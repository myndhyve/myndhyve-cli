/**
 * MyndHyve CLI — Default Configuration
 */

import { RelayConfigSchema, type RelayConfig } from './types.js';

export const DEFAULT_CONFIG: RelayConfig = RelayConfigSchema.parse({});

export const CLI_VERSION = '0.1.0';

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
 * Example: myndhyve-cli/0.1.0 darwin-arm64 node-v22.0.0 (abc1234 2026-02-17)
 */
export const VERSION_STRING =
  `myndhyve-cli/${CLI_VERSION} ${process.platform}-${process.arch} node-${process.version} (${BUILD_COMMIT} ${BUILD_DATE})`;
