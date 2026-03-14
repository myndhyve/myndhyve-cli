/**
 * MyndHyve CLI — Secrets API
 *
 * Interacts with secrets Cloud Functions for envelope encryption/decryption
 * using KMS-backed data encryption keys.
 *
 * @see functions/src/secrets/crypto.ts — server endpoints
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SecretsAPI');

// ============================================================================
// TYPES
// ============================================================================

export interface EncryptedEnvelope {
  encryptedValue: string;
  encryptedDEK: string;
  kmsKeyVersion: string;
  iv: string;
  authTag: string;
}

export interface EncryptionContext {
  secretId: string;
  userId: string;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Encrypt a plaintext secret using KMS envelope encryption.
 */
export async function encryptSecret(
  secretId: string,
  userId: string,
  plaintext: string
): Promise<EncryptedEnvelope> {
  const client = getAPIClient();
  log.debug('Encrypting secret', { secretId });

  return client.post<EncryptedEnvelope>('/secretsEncrypt', {
    plaintext,
    context: { secretId, userId },
  });
}

/**
 * Decrypt a previously encrypted envelope.
 */
export async function decryptSecret(
  secretId: string,
  userId: string,
  envelope: EncryptedEnvelope
): Promise<string> {
  const client = getAPIClient();
  log.debug('Decrypting secret', { secretId });

  const result = await client.post<{ plaintext: string }>('/secretsDecrypt', {
    ...envelope,
    context: { secretId, userId },
  });

  return result.plaintext;
}
