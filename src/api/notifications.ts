/**
 * MyndHyve CLI — Notifications API
 *
 * Interacts with notification Cloud Functions for sending emails and SMS.
 *
 * @see functions/src/notifications/ — server endpoints
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('NotificationsAPI');

// ============================================================================
// TYPES
// ============================================================================

export interface SendEmailRequest {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  templateType?: string;
  templateData?: Record<string, unknown>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SendSMSRequest {
  to: string;
  body?: string;
  templateType?: string;
  templateData?: Record<string, unknown>;
}

export interface SendSMSResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Send an email notification.
 */
export async function sendEmail(request: SendEmailRequest): Promise<SendEmailResult> {
  const client = getAPIClient();
  log.debug('Sending email', { to: request.to, template: request.templateType });
  return client.post<SendEmailResult>('/notificationSendEmail', request);
}

/**
 * Send an SMS notification.
 */
export async function sendSMS(request: SendSMSRequest): Promise<SendSMSResult> {
  const client = getAPIClient();
  log.debug('Sending SMS', { to: request.to, template: request.templateType });
  return client.post<SendSMSResult>('/notificationSendSMS', request);
}
