/**
 * MyndHyve CLI — Channel Plugin Interface
 *
 * Each messaging platform (WhatsApp, Signal, iMessage) implements
 * this interface as a channel plugin.
 */

import type { ChatIngressEnvelope, ChatEgressEnvelope, RelayChannel, DeliveryResult } from '../relay/types.js';

/**
 * A channel plugin bridges a messaging platform to the relay protocol.
 */
export interface ChannelPlugin {
  /** Unique channel identifier */
  readonly channel: RelayChannel;

  /** Human-readable display name */
  readonly displayName: string;

  /** Whether this channel is supported on the current platform */
  readonly isSupported: boolean;

  /** Reason if not supported (e.g., "iMessage requires macOS") */
  readonly unsupportedReason?: string;

  /**
   * Authenticate with the messaging platform.
   * For WhatsApp: shows QR code. For Signal: registers phone number.
   */
  login(): Promise<void>;

  /**
   * Check if the channel is currently authenticated.
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Start the channel — connect to the platform and begin
   * receiving/sending messages.
   *
   * @param onInbound Called when an inbound message is received
   * @param signal AbortSignal to stop the channel
   */
  start(
    onInbound: (envelope: ChatIngressEnvelope) => Promise<void>,
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Deliver an outbound message to the platform.
   */
  deliver(envelope: ChatEgressEnvelope): Promise<DeliveryResult>;

  /**
   * Get the current platform connection status.
   */
  getStatus(): string;

  /**
   * Clear stored credentials (logout).
   */
  logout(): Promise<void>;
}
