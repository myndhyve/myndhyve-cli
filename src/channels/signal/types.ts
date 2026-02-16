/**
 * MyndHyve CLI — Signal Channel Types
 *
 * Types for the signal-cli JSON-RPC daemon API.
 * Based on signal-cli v0.13+ HTTP JSON-RPC mode.
 */

// ============================================================================
// JSON-RPC 2.0
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// SIGNAL ENVELOPE (received via SSE)
// ============================================================================

export interface SignalSSEEvent {
  envelope: SignalEnvelope;
  account: string;
}

export interface SignalEnvelope {
  source: string;
  sourceNumber: string;
  sourceUuid: string;
  sourceName: string;
  sourceDevice: number;
  timestamp: number;
  dataMessage?: SignalDataMessage;
  syncMessage?: SignalSyncMessage;
  receiptMessage?: SignalReceiptMessage;
  typingMessage?: SignalTypingMessage;
}

export interface SignalDataMessage {
  timestamp: number;
  message: string | null;
  expiresInSeconds: number;
  viewOnce: boolean;
  groupInfo?: SignalGroupInfo;
  quote?: SignalQuote;
  mentions?: SignalMention[];
  attachments?: SignalAttachment[];
  reaction?: SignalReaction;
  sticker?: SignalSticker;
}

export interface SignalGroupInfo {
  groupId: string;
  type: string;
  groupName?: string;
}

export interface SignalQuote {
  id: number;
  author: string;
  authorNumber: string;
  authorUuid: string;
  text: string;
  attachments?: SignalAttachment[];
}

export interface SignalMention {
  start: number;
  length: number;
  uuid: string;
  number: string;
}

export interface SignalAttachment {
  contentType: string;
  filename?: string;
  id: string;
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
  voiceNote?: boolean;
}

export interface SignalReaction {
  emoji: string;
  targetAuthor: string;
  targetAuthorNumber: string;
  targetAuthorUuid: string;
  targetSentTimestamp: number;
  isRemove: boolean;
}

export interface SignalSticker {
  packId: string;
  stickerId: number;
  contentType?: string;
}

export interface SignalSyncMessage {
  sentMessage?: SignalDataMessage & {
    destination?: string;
    destinationNumber?: string;
    destinationUuid?: string;
  };
}

export interface SignalReceiptMessage {
  when: number;
  isDelivery: boolean;
  isRead: boolean;
  isViewed: boolean;
  timestamps: number[];
}

export interface SignalTypingMessage {
  action: 'STARTED' | 'STOPPED';
  timestamp: number;
  groupId?: string;
}

// ============================================================================
// SEND RESULT
// ============================================================================

export interface SignalSendResult {
  type: SignalSendResultType;
  recipientAddress: SignalAddress;
  timestamp?: number;
}

export type SignalSendResultType =
  | 'SUCCESS'
  | 'NETWORK_FAILURE'
  | 'UNREGISTERED_FAILURE'
  | 'IDENTITY_FAILURE'
  | 'PROOF_REQUIRED_FAILURE';

export interface SignalAddress {
  uuid?: string;
  number?: string;
}

// ============================================================================
// LINK / REGISTRATION
// ============================================================================

export interface SignalLinkResult {
  deviceLinkUri: string;
}

export interface SignalFinishLinkResult {
  number: string;
  uuid: string;
}

export interface SignalVersionResult {
  version: string;
}

// ============================================================================
// DAEMON CONFIG
// ============================================================================

export interface SignalDaemonConfig {
  /** Path to signal-cli data directory */
  dataDir: string;
  /** Account phone number (e.g., +1234567890) */
  account?: string;
  /** Host to bind the HTTP daemon to */
  host: string;
  /** Port to bind the HTTP daemon to */
  port: number;
}

export const SIGNAL_DAEMON_DEFAULTS: Omit<SignalDaemonConfig, 'dataDir'> = {
  host: '127.0.0.1',
  port: 18080,
};
