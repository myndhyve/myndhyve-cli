/**
 * MyndHyve CLI — Default Configuration
 */

import { RelayConfigSchema, type RelayConfig } from './types.js';

export const DEFAULT_CONFIG: RelayConfig = RelayConfigSchema.parse({});

export const CLI_VERSION = '0.1.0';

export const DEFAULT_SERVER_URL =
  'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway';
