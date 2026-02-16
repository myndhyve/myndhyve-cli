/**
 * MyndHyve CLI — Relay Protocol Types
 *
 * Mirrors the server-side types from functions/src/messaging-gateway/types.ts
 * and functions/src/messaging-gateway/relay.ts for the relay protocol.
 */

// ============================================================================
// CHANNEL & STATUS
// ============================================================================

export type RelayChannel = 'whatsapp' | 'signal' | 'imessage';

export type RelayDeviceStatus = 'pending' | 'active' | 'disconnected' | 'revoked';

// ============================================================================
// REGISTRATION & ACTIVATION
// ============================================================================

export interface RegisterRequest {
  channel: RelayChannel;
  label: string;
}

export interface RegisterResponse {
  relayId: string;
  activationCode: string;
  activationCodeExpiresAt: string;
}

export interface ActivateRequest {
  relayId: string;
  activationCode: string;
  version?: string;
  metadata?: RelayDeviceMetadata;
}

export interface ActivateResponse {
  deviceToken: string;
  tokenExpiresAt: string;
  heartbeatIntervalSeconds: number;
  outboundPollIntervalSeconds: number;
}

export interface RevokeRequest {
  relayId: string;
  reason?: string;
}

// ============================================================================
// HEARTBEAT
// ============================================================================

export interface HeartbeatRequest {
  relayId: string;
  version?: string;
  platformStatus?: string;
  outboundQueueDepth?: number;
  inboundQueueDepth?: number;
  uptimeSeconds?: number;
  metadata?: RelayDeviceMetadata;
}

export interface HeartbeatResponse {
  ok: boolean;
  hasPendingOutbound: boolean;
  heartbeatIntervalSeconds: number;
}

// ============================================================================
// INBOUND (relay agent → cloud)
// ============================================================================

export interface ChatIngressEnvelope {
  channel: RelayChannel;
  platformMessageId: string;
  conversationId: string;
  threadId?: string;
  peerId: string;
  peerDisplay?: string;
  text: string;
  media?: Array<{
    kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    ref: string;
    mimeType?: string;
    fileName?: string;
    size?: number;
  }>;
  isGroup: boolean;
  groupName?: string;
  timestamp: string;
  replyToMessageId?: string;
  mentions?: string[];
}

export interface InboundRequest {
  relayId: string;
  envelope: ChatIngressEnvelope;
  stagedMedia?: Array<{
    ref: string;
    base64: string;
    mimeType: string;
  }>;
}

export interface InboundResponse {
  ok: boolean;
  sessionKey?: string;
  dispatched: boolean;
  denied?: string;
}

// ============================================================================
// OUTBOUND (cloud → relay agent)
// ============================================================================

export interface OutboundMessage {
  id: string;
  envelope: ChatEgressEnvelope;
  queuedAt: string;
  priority: number;
  attempts: number;
}

export interface ChatEgressEnvelope {
  channel: RelayChannel;
  conversationId: string;
  threadId?: string;
  text: string;
  media?: Array<{
    kind: string;
    url: string;
    mimeType?: string;
    fileName?: string;
  }>;
  replyToMessageId?: string;
}

export interface OutboundPollResponse {
  messages: OutboundMessage[];
}

export interface DeliveryAck {
  outboundMessageId: string;
  success: boolean;
  platformMessageId?: string;
  error?: string;
  retryable?: boolean;
  durationMs: number;
}

// ============================================================================
// DELIVERY RESULT
// ============================================================================

/** Result of delivering a message to a local messaging platform. */
export interface DeliveryResult {
  success: boolean;
  platformMessageId?: string;
  error?: string;
  retryable?: boolean;
}

// ============================================================================
// DEVICE METADATA
// ============================================================================

export interface RelayDeviceMetadata {
  os?: string;
  arch?: string;
  nodeVersion?: string;
  bridgeVersion?: string;
  lastIp?: string;
}
