/**
 * MyndHyve CLI — Envelope Tools
 *
 * Create and validate ChatIngressEnvelope and ChatEgressEnvelope objects
 * for testing and debugging the messaging pipeline.
 */

import { z } from 'zod';
import type {
  ChatIngressEnvelope,
  RelayChannel,
} from '../relay/types.js';

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const MediaItemSchema = z.object({
  kind: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
  ref: z.string().min(1),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  size: z.number().int().positive().optional(),
});

/** Zod schema for validating ChatIngressEnvelope. */
export const IngressEnvelopeSchema = z.object({
  channel: z.enum(['whatsapp', 'signal', 'imessage']),
  platformMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  threadId: z.string().optional(),
  peerId: z.string().min(1),
  peerDisplay: z.string().optional(),
  text: z.string(),
  media: z.array(MediaItemSchema).optional(),
  isGroup: z.boolean(),
  groupName: z.string().optional(),
  timestamp: z.string().datetime(),
  replyToMessageId: z.string().optional(),
  mentions: z.array(z.string()).optional(),
});

const EgressMediaSchema = z.object({
  kind: z.string().min(1),
  url: z.string().url(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
});

/** Zod schema for validating ChatEgressEnvelope. */
export const EgressEnvelopeSchema = z.object({
  channel: z.enum(['whatsapp', 'signal', 'imessage']),
  conversationId: z.string().min(1),
  threadId: z.string().optional(),
  text: z.string(),
  media: z.array(EgressMediaSchema).optional(),
  replyToMessageId: z.string().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

/** Options for creating a test envelope. */
export interface CreateEnvelopeOptions {
  channel: RelayChannel;
  text: string;
  peerId?: string;
  conversationId?: string;
  isGroup?: boolean;
  groupName?: string;
}

/** Result of validating an envelope. */
export interface ValidationResult {
  valid: boolean;
  envelopeType: 'ingress' | 'egress' | 'unknown';
  errors: string[];
}

// ============================================================================
// CREATE
// ============================================================================

/**
 * Create a test ChatIngressEnvelope with sensible defaults.
 */
export function createTestEnvelope(options: CreateEnvelopeOptions): ChatIngressEnvelope {
  const now = new Date().toISOString();
  const msgId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    channel: options.channel,
    platformMessageId: msgId,
    conversationId: options.conversationId || `conv-${options.channel}-test`,
    peerId: options.peerId || `peer-${options.channel}-001`,
    peerDisplay: 'Test User',
    text: options.text,
    isGroup: options.isGroup || false,
    groupName: options.isGroup ? (options.groupName || 'Test Group') : undefined,
    timestamp: now,
  };
}

// ============================================================================
// VALIDATE
// ============================================================================

/**
 * Validate a JSON object as either an ingress or egress envelope.
 *
 * Tries ingress first (more fields), falls back to egress.
 */
export function validateEnvelope(data: unknown): ValidationResult {
  // Try ingress envelope
  const ingressResult = IngressEnvelopeSchema.safeParse(data);
  if (ingressResult.success) {
    return { valid: true, envelopeType: 'ingress', errors: [] };
  }

  // Try egress envelope
  const egressResult = EgressEnvelopeSchema.safeParse(data);
  if (egressResult.success) {
    return { valid: true, envelopeType: 'egress', errors: [] };
  }

  // Both failed — report ingress errors (more likely intent)
  const errors = ingressResult.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );

  // Check if it looks like egress (non-object data defaults to ingress errors)
  const hasIngressFields =
    typeof data === 'object' &&
    data !== null &&
    ('peerId' in data || 'platformMessageId' in data || 'isGroup' in data);

  if (!hasIngressFields) {
    // Report egress errors instead
    const egressErrors = egressResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return { valid: false, envelopeType: 'egress', errors: egressErrors };
  }

  return { valid: false, envelopeType: 'ingress', errors };
}
