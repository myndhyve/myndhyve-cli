/**
 * MyndHyve CLI — Webhook Test Event Generator
 *
 * Generates mock webhook payloads for supported messaging platforms.
 * Useful for testing routing rules and message processing without
 * actual platform connections.
 */

import type { RelayChannel } from '../relay/types.js';

// ============================================================================
// TYPES
// ============================================================================

/** Supported webhook event types per platform. */
export type WebhookEventType =
  | 'message'
  | 'message-status'
  | 'group-join'
  | 'group-leave'
  | 'typing'
  | 'read-receipt';

/** Options for generating a webhook event. */
export interface WebhookEventOptions {
  /** Target platform. */
  channel: RelayChannel;
  /** Type of event to generate. */
  eventType?: WebhookEventType;
  /** Sender identifier. */
  senderId?: string;
  /** Message text (for message events). */
  text?: string;
  /** Whether this is a group message. */
  isGroup?: boolean;
  /** Group name (if group message). */
  groupName?: string;
}

/** A generated webhook test event. */
export interface WebhookTestEvent {
  /** Platform this event targets. */
  channel: RelayChannel;
  /** Event type. */
  eventType: WebhookEventType;
  /** The generated payload. */
  payload: Record<string, unknown>;
  /** HTTP headers that would accompany this webhook. */
  headers: Record<string, string>;
  /** Description of what this event represents. */
  description: string;
}

// ============================================================================
// GENERATORS
// ============================================================================

/**
 * Generate a mock webhook event for the specified platform.
 */
export function generateWebhookEvent(options: WebhookEventOptions): WebhookTestEvent {
  const eventType = options.eventType || 'message';

  switch (options.channel) {
    case 'whatsapp':
      return generateWhatsAppEvent(options, eventType);
    case 'signal':
      return generateSignalEvent(options, eventType);
    case 'imessage':
      return generateiMessageEvent(options, eventType);
    default:
      throw new Error(`Unsupported channel: ${options.channel}`);
  }
}

/**
 * List available event types for a channel.
 */
export function getAvailableEventTypes(channel: RelayChannel): WebhookEventType[] {
  switch (channel) {
    case 'whatsapp':
      return ['message', 'message-status', 'group-join', 'group-leave', 'typing', 'read-receipt'];
    case 'signal':
      return ['message', 'typing', 'read-receipt'];
    case 'imessage':
      return ['message', 'typing', 'read-receipt'];
    default:
      return ['message'];
  }
}

// ============================================================================
// WHATSAPP
// ============================================================================

function generateWhatsAppEvent(
  options: WebhookEventOptions,
  eventType: WebhookEventType
): WebhookTestEvent {
  const senderId = options.senderId || '15551234567';
  const timestamp = Math.floor(Date.now() / 1000);

  const basePayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'test-business-id',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15559876543',
                phone_number_id: 'test-phone-id',
              },
              contacts: [
                {
                  profile: { name: 'Test User' },
                  wa_id: senderId,
                },
              ],
              ...(eventType === 'message' && {
                messages: [
                  {
                    from: senderId,
                    id: `wamid.test-${Date.now()}`,
                    timestamp: String(timestamp),
                    text: { body: options.text || 'Hello from webhook test' },
                    type: 'text',
                  },
                ],
              }),
              ...(eventType === 'message-status' && {
                statuses: [
                  {
                    id: `wamid.test-${Date.now()}`,
                    status: 'delivered',
                    timestamp: String(timestamp),
                    recipient_id: senderId,
                  },
                ],
              }),
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  return {
    channel: 'whatsapp',
    eventType,
    payload: basePayload,
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=test-signature',
    },
    description: `WhatsApp Cloud API ${eventType} event from ${senderId}`,
  };
}

// ============================================================================
// SIGNAL
// ============================================================================

function generateSignalEvent(
  options: WebhookEventOptions,
  eventType: WebhookEventType
): WebhookTestEvent {
  const senderId = options.senderId || '+15551234567';
  const timestamp = Date.now();

  const payload: Record<string, unknown> = {
    envelope: {
      source: senderId,
      sourceDevice: 1,
      timestamp,
      dataMessage:
        eventType === 'message'
          ? {
              timestamp,
              message: options.text || 'Hello from webhook test',
              groupInfo: options.isGroup
                ? {
                    groupId: 'test-group-id',
                    type: 'DELIVER',
                    name: options.groupName || 'Test Group',
                  }
                : undefined,
            }
          : undefined,
      typingMessage:
        eventType === 'typing'
          ? { action: 'STARTED', timestamp }
          : undefined,
      receiptMessage:
        eventType === 'read-receipt'
          ? { type: 'READ', timestamps: [timestamp - 1000] }
          : undefined,
    },
    account: '+15559876543',
  };

  return {
    channel: 'signal',
    eventType,
    payload,
    headers: {
      'Content-Type': 'application/json',
    },
    description: `Signal ${eventType} event from ${senderId}`,
  };
}

// ============================================================================
// IMESSAGE
// ============================================================================

function generateiMessageEvent(
  options: WebhookEventOptions,
  eventType: WebhookEventType
): WebhookTestEvent {
  const senderId = options.senderId || 'test@icloud.com';
  const timestamp = new Date().toISOString();

  const payload: Record<string, unknown> = {
    type: eventType === 'message' ? 'message' : eventType,
    sender: senderId,
    chatId: options.isGroup
      ? `chat-group-${Date.now()}`
      : `chat-${senderId}`,
    isGroup: options.isGroup || false,
    groupName: options.isGroup ? (options.groupName || 'Test Group') : undefined,
    timestamp,
    message:
      eventType === 'message'
        ? {
            id: `imsg-${Date.now()}`,
            text: options.text || 'Hello from webhook test',
            attachments: [],
          }
        : undefined,
  };

  return {
    channel: 'imessage',
    eventType,
    payload,
    headers: {
      'Content-Type': 'application/json',
    },
    description: `iMessage ${eventType} event from ${senderId}`,
  };
}
