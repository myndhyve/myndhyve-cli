/**
 * MyndHyve CLI — Signal JSON-RPC Client
 *
 * HTTP client for the signal-cli JSON-RPC daemon.
 * Communicates with the daemon at http://127.0.0.1:PORT/api/v1/rpc.
 */

import { createLogger } from '../../utils/logger.js';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  SignalSendResult,
  SignalLinkResult,
  SignalFinishLinkResult,
  SignalVersionResult,
} from './types.js';

const log = createLogger('Signal:Client');

// ============================================================================
// RPC CLIENT
// ============================================================================

let nextRequestId = 1;

/**
 * Make a JSON-RPC 2.0 request to the signal-cli daemon.
 */
export async function signalRpcCall<T>(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const id = nextRequestId;
  nextRequestId = (nextRequestId % 2_000_000_000) + 1;
  const body: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id,
  };

  log.debug('RPC call', { method, id });

  const response = await fetch(`${baseUrl}/api/v1/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new SignalRpcError(
      `HTTP ${response.status}: ${response.statusText}`,
      -1,
      method
    );
  }

  const json = (await response.json()) as JsonRpcResponse<T>;

  if (json.error) {
    throw SignalRpcError.fromRpcError(json.error, method);
  }

  return json.result as T;
}

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Send a text message to a recipient or group.
 */
export async function sendMessage(
  baseUrl: string,
  params: {
    recipient?: string;
    groupId?: string;
    message: string;
    attachments?: string[];
    quoteTimestamp?: number;
    quoteAuthor?: string;
    quoteMessage?: string;
    mentions?: string[];
  }
): Promise<SignalSendResult[]> {
  // Build params — signal-cli uses different param names for recipient vs group
  const rpcParams: Record<string, unknown> = {
    message: params.message,
  };

  if (params.groupId) {
    rpcParams.groupId = params.groupId;
  } else if (params.recipient) {
    rpcParams.recipient = [params.recipient];
  }

  if (params.attachments && params.attachments.length > 0) {
    rpcParams.attachments = params.attachments;
  }

  if (params.quoteTimestamp) {
    rpcParams.quoteTimestamp = params.quoteTimestamp;
    if (params.quoteAuthor) rpcParams.quoteAuthor = params.quoteAuthor;
    if (params.quoteMessage) rpcParams.quoteMessage = params.quoteMessage;
  }

  if (params.mentions && params.mentions.length > 0) {
    rpcParams.mentions = params.mentions;
  }

  return signalRpcCall<SignalSendResult[]>(baseUrl, 'send', rpcParams);
}

/**
 * Start the device linking process (generates a QR code URI).
 */
export async function startLink(
  baseUrl: string,
  deviceName: string
): Promise<SignalLinkResult> {
  return signalRpcCall<SignalLinkResult>(baseUrl, 'startLink', {
    deviceName,
  });
}

/**
 * Finish the device linking process (after QR code is scanned).
 */
export async function finishLink(
  baseUrl: string,
  deviceLinkUri: string
): Promise<SignalFinishLinkResult> {
  return signalRpcCall<SignalFinishLinkResult>(baseUrl, 'finishLink', {
    deviceLinkUri,
  });
}

/**
 * Register a new Signal account (phone number + captcha).
 */
export async function registerAccount(
  baseUrl: string,
  params: { number: string; captcha?: string; voice?: boolean }
): Promise<void> {
  await signalRpcCall(baseUrl, 'register', {
    account: params.number,
    captcha: params.captcha,
    voice: params.voice ?? false,
  });
}

/**
 * Verify registration with the SMS code.
 */
export async function verifyAccount(
  baseUrl: string,
  params: { number: string; verificationCode: string }
): Promise<void> {
  await signalRpcCall(baseUrl, 'verify', {
    account: params.number,
    verificationCode: params.verificationCode,
  });
}

/**
 * Get the signal-cli version.
 */
export async function getVersion(baseUrl: string): Promise<string> {
  const result = await signalRpcCall<SignalVersionResult>(baseUrl, 'version');
  return result.version;
}

/**
 * Health check — GET /api/v1/check.
 * Returns true if daemon is responsive, false otherwise.
 */
export async function healthCheck(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/check`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// RESET (for testing)
// ============================================================================

/** @internal Reset the request ID counter — for deterministic tests only. */
export function _resetRequestId(): void {
  nextRequestId = 1;
}

// ============================================================================
// ERROR
// ============================================================================

export class SignalRpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly method: string
  ) {
    super(message);
    this.name = 'SignalRpcError';
  }

  static fromRpcError(error: JsonRpcError, method: string): SignalRpcError {
    return new SignalRpcError(error.message, error.code, method);
  }
}
