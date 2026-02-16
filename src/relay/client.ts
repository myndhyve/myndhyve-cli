/**
 * MyndHyve CLI — Relay Protocol Client
 *
 * HTTP client for communicating with the messagingRelayGateway Cloud Function.
 * Implements all 7 relay protocol endpoints.
 */

import type {
  RegisterRequest,
  RegisterResponse,
  ActivateRequest,
  ActivateResponse,
  RevokeRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  InboundRequest,
  InboundResponse,
  OutboundPollResponse,
  OutboundMessage,
  DeliveryAck,
  ChatIngressEnvelope,
  RelayDeviceMetadata,
} from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RelayClient');

// ============================================================================
// CLIENT
// ============================================================================

export class RelayClient {
  private readonly baseUrl: string;
  private deviceToken: string | undefined;

  constructor(baseUrl: string, deviceToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.deviceToken = deviceToken;
  }

  /** Update the device token (e.g., after activation). */
  setDeviceToken(token: string): void {
    this.deviceToken = token;
  }

  // ── Auth: Firebase ID Token ──────────────────────────────────────────────

  /**
   * Register a new relay device. Requires Firebase Auth ID token.
   * Returns a relayId and activation code.
   */
  async register(
    channel: string,
    label: string,
    idToken: string
  ): Promise<RegisterResponse> {
    log.info('Registering relay device', { channel, label });

    const body: RegisterRequest = { channel: channel as RegisterRequest['channel'], label };
    return this.request<RegisterResponse>('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Activate a relay device with the activation code.
   * Returns a device token for subsequent authenticated requests.
   */
  async activate(
    relayId: string,
    activationCode: string,
    version?: string,
    metadata?: RelayDeviceMetadata
  ): Promise<ActivateResponse> {
    log.info('Activating relay device', { relayId });

    const body: ActivateRequest = { relayId, activationCode, version, metadata };
    const response = await this.request<ActivateResponse>('/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // Store the device token for future requests
    this.deviceToken = response.deviceToken;
    return response;
  }

  /**
   * Revoke relay access. Requires Firebase Auth ID token.
   */
  async revoke(relayId: string, idToken: string, reason?: string): Promise<void> {
    log.info('Revoking relay device', { relayId, reason });

    const body: RevokeRequest = { relayId, reason };
    await this.request<{ ok: boolean }>('/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  // ── Auth: Device Token ───────────────────────────────────────────────────

  /**
   * Send a heartbeat to keep the relay device active.
   */
  async heartbeat(
    relayId: string,
    status?: Partial<Omit<HeartbeatRequest, 'relayId'>>
  ): Promise<HeartbeatResponse> {
    this.requireDeviceToken();

    const body: HeartbeatRequest = { relayId, ...status };
    return this.request<HeartbeatResponse>('/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deviceToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Forward an inbound message from the local platform to MyndHyve.
   */
  async sendInbound(
    relayId: string,
    envelope: ChatIngressEnvelope,
    stagedMedia?: InboundRequest['stagedMedia']
  ): Promise<InboundResponse> {
    this.requireDeviceToken();
    log.debug('Sending inbound message', {
      relayId,
      channel: envelope.channel,
      peerId: envelope.peerId,
    });

    const body: InboundRequest = { relayId, envelope, stagedMedia };
    return this.request<InboundResponse>('/inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deviceToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Poll for outbound messages waiting to be delivered.
   */
  async pollOutbound(relayId: string): Promise<OutboundMessage[]> {
    this.requireDeviceToken();

    const response = await this.request<OutboundPollResponse>(
      `/outbound?relayId=${encodeURIComponent(relayId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.deviceToken}` },
      }
    );

    if (response.messages.length > 0) {
      log.debug('Polled outbound messages', { count: response.messages.length });
    }

    return response.messages;
  }

  /**
   * Acknowledge delivery of an outbound message.
   */
  async ackOutbound(ack: DeliveryAck): Promise<void> {
    this.requireDeviceToken();
    log.debug('Acknowledging outbound delivery', {
      messageId: ack.outboundMessageId,
      success: ack.success,
    });

    await this.request<{ ok: boolean }>('/ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deviceToken}`,
      },
      body: JSON.stringify(ack),
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private requireDeviceToken(): void {
    if (!this.deviceToken) {
      throw new RelayClientError(
        'Device token not set. Run `myndhyve-cli relay setup` first.',
        'NO_DEVICE_TOKEN'
      );
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let errorMessage: string;
        try {
          const parsed = JSON.parse(errorBody);
          errorMessage = parsed.error || parsed.message || errorBody;
        } catch {
          errorMessage = errorBody || `HTTP ${response.status}`;
        }

        throw new RelayClientError(
          `Relay API error (${response.status}): ${errorMessage}`,
          'API_ERROR',
          response.status
        );
      }

      // Note: response is trusted without runtime validation since the relay
      // agent talks exclusively to its own backend. If needed, per-endpoint
      // Zod schemas could be added here in the future.
      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof RelayClientError) throw error;

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RelayClientError('Request timed out', 'TIMEOUT');
      }

      throw new RelayClientError(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
        'NETWORK_ERROR'
      );
    }
  }
}

// ============================================================================
// ERROR
// ============================================================================

export class RelayClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'RelayClientError';
  }
}
