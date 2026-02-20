/**
 * MyndHyve CLI — Default Configuration
 */

import { RelayConfigSchema, type RelayConfig } from './types.js';

export const DEFAULT_CONFIG: RelayConfig = RelayConfigSchema.parse({});

export const CLI_VERSION = '0.1.0';

export const DEFAULT_SERVER_URL =
  'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway';

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
