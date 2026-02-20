/**
 * MyndHyve CLI — Configuration Types & Schema
 */

import { z } from 'zod';

// ============================================================================
// ZOD SCHEMA
// ============================================================================

export const ReconnectConfigSchema = z.object({
  maxAttempts: z.number().positive().default(Infinity),
  initialDelayMs: z.number().int().positive().default(1_000),
  maxDelayMs: z.number().int().positive().default(300_000),
  watchdogTimeoutMs: z.number().int().positive().default(30 * 60 * 1000),
});

export const HeartbeatConfigSchema = z.object({
  intervalSeconds: z.number().int().positive().default(30),
});

export const OutboundConfigSchema = z.object({
  pollIntervalSeconds: z.number().int().positive().default(5),
  maxPerPoll: z.number().int().positive().default(10),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  file: z.string().optional(),
});

export const RelayConfigSchema = z.object({
  server: z.object({
    baseUrl: z.string().url().default(
      'https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway'
    ),
  }).default({}),
  channel: z.enum(['whatsapp', 'signal', 'imessage']).optional(),
  relayId: z.string().optional(),
  deviceToken: z.string().optional(),
  tokenExpiresAt: z.string().optional(),
  userId: z.string().optional(),
  reconnect: ReconnectConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
  outbound: OutboundConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type RelayConfig = z.infer<typeof RelayConfigSchema>;
export type ReconnectConfig = z.infer<typeof ReconnectConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type OutboundConfig = z.infer<typeof OutboundConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
