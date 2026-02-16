import { describe, it, expect } from 'vitest';
import {
  generateWebhookEvent,
  getAvailableEventTypes,
} from '../webhook.js';
import type {
  WebhookEventType as _WebhookEventType,
  WebhookEventOptions as _WebhookEventOptions,
  WebhookTestEvent as _WebhookTestEvent,
} from '../webhook.js';

// ============================================================================
// generateWebhookEvent — basic channel routing
// ============================================================================

describe('generateWebhookEvent', () => {
  it('generates a WhatsApp message event', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp' });

    expect(event.channel).toBe('whatsapp');
    expect(event.eventType).toBe('message');
    expect(event.payload).toBeDefined();
    expect(event.headers).toBeDefined();
    expect(event.description).toBeDefined();
  });

  it('generates a Signal message event', () => {
    const event = generateWebhookEvent({ channel: 'signal' });

    expect(event.channel).toBe('signal');
    expect(event.eventType).toBe('message');
  });

  it('generates an iMessage message event', () => {
    const event = generateWebhookEvent({ channel: 'imessage' });

    expect(event.channel).toBe('imessage');
    expect(event.eventType).toBe('message');
  });

  it('throws for an unsupported channel', () => {
    expect(() =>
      generateWebhookEvent({ channel: 'telegram' as any })
    ).toThrow('Unsupported channel: telegram');
  });

  // --------------------------------------------------------------------------
  // event types
  // --------------------------------------------------------------------------

  it('defaults eventType to "message" when not specified', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp' });
    expect(event.eventType).toBe('message');
  });

  it('generates a typing event for WhatsApp', () => {
    const event = generateWebhookEvent({
      channel: 'whatsapp',
      eventType: 'typing',
    });
    expect(event.eventType).toBe('typing');
    expect(event.channel).toBe('whatsapp');
  });

  it('generates a read-receipt event for Signal', () => {
    const event = generateWebhookEvent({
      channel: 'signal',
      eventType: 'read-receipt',
    });
    expect(event.eventType).toBe('read-receipt');
  });

  it('generates a message-status event for WhatsApp', () => {
    const event = generateWebhookEvent({
      channel: 'whatsapp',
      eventType: 'message-status',
    });
    expect(event.eventType).toBe('message-status');
  });

  it('generates a group-join event for WhatsApp', () => {
    const event = generateWebhookEvent({
      channel: 'whatsapp',
      eventType: 'group-join',
    });
    expect(event.eventType).toBe('group-join');
  });

  it('generates a typing event for iMessage', () => {
    const event = generateWebhookEvent({
      channel: 'imessage',
      eventType: 'typing',
    });
    expect(event.eventType).toBe('typing');
  });

  // --------------------------------------------------------------------------
  // custom options
  // --------------------------------------------------------------------------

  it('uses custom senderId for WhatsApp', () => {
    const event = generateWebhookEvent({
      channel: 'whatsapp',
      senderId: '19995551234',
    });

    const entry = (event.payload as any).entry[0];
    const contact = entry.changes[0].value.contacts[0];
    expect(contact.wa_id).toBe('19995551234');

    const message = entry.changes[0].value.messages[0];
    expect(message.from).toBe('19995551234');
  });

  it('uses custom senderId for Signal', () => {
    const event = generateWebhookEvent({
      channel: 'signal',
      senderId: '+441234567890',
    });

    const envelope = (event.payload as any).envelope;
    expect(envelope.source).toBe('+441234567890');
  });

  it('uses custom senderId for iMessage', () => {
    const event = generateWebhookEvent({
      channel: 'imessage',
      senderId: 'custom@icloud.com',
    });

    expect((event.payload as any).sender).toBe('custom@icloud.com');
  });

  it('uses custom text for WhatsApp message', () => {
    const event = generateWebhookEvent({
      channel: 'whatsapp',
      text: 'Custom message text',
    });

    const message = (event.payload as any).entry[0].changes[0].value.messages[0];
    expect(message.text.body).toBe('Custom message text');
  });

  it('uses custom text for Signal message', () => {
    const event = generateWebhookEvent({
      channel: 'signal',
      text: 'Signal custom text',
    });

    const dm = (event.payload as any).envelope.dataMessage;
    expect(dm.message).toBe('Signal custom text');
  });

  it('uses custom text for iMessage message', () => {
    const event = generateWebhookEvent({
      channel: 'imessage',
      text: 'iMessage custom text',
    });

    expect((event.payload as any).message.text).toBe('iMessage custom text');
  });

  it('uses default text when not provided', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp' });
    const message = (event.payload as any).entry[0].changes[0].value.messages[0];
    expect(message.text.body).toBe('Hello from webhook test');
  });

  // --------------------------------------------------------------------------
  // group events
  // --------------------------------------------------------------------------

  it('generates a Signal group message with groupInfo', () => {
    const event = generateWebhookEvent({
      channel: 'signal',
      isGroup: true,
      groupName: 'Family Chat',
    });

    const groupInfo = (event.payload as any).envelope.dataMessage.groupInfo;
    expect(groupInfo).toBeDefined();
    expect(groupInfo.name).toBe('Family Chat');
    expect(groupInfo.type).toBe('DELIVER');
  });

  it('uses default group name "Test Group" for Signal when groupName is omitted', () => {
    const event = generateWebhookEvent({
      channel: 'signal',
      isGroup: true,
    });

    const groupInfo = (event.payload as any).envelope.dataMessage.groupInfo;
    expect(groupInfo.name).toBe('Test Group');
  });

  it('generates an iMessage group event', () => {
    const event = generateWebhookEvent({
      channel: 'imessage',
      isGroup: true,
      groupName: 'Work Team',
    });

    expect((event.payload as any).isGroup).toBe(true);
    expect((event.payload as any).groupName).toBe('Work Team');
  });

  it('iMessage non-group event sets isGroup to false', () => {
    const event = generateWebhookEvent({ channel: 'imessage' });
    expect((event.payload as any).isGroup).toBe(false);
  });

  // --------------------------------------------------------------------------
  // headers
  // --------------------------------------------------------------------------

  it('includes Content-Type header for all channels', () => {
    for (const channel of ['whatsapp', 'signal', 'imessage'] as const) {
      const event = generateWebhookEvent({ channel });
      expect(event.headers['Content-Type']).toBe('application/json');
    }
  });

  it('includes X-Hub-Signature-256 header for WhatsApp', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp' });
    expect(event.headers['X-Hub-Signature-256']).toBe('sha256=test-signature');
  });

  it('does not include X-Hub-Signature-256 for Signal', () => {
    const event = generateWebhookEvent({ channel: 'signal' });
    expect(event.headers['X-Hub-Signature-256']).toBeUndefined();
  });

  it('does not include X-Hub-Signature-256 for iMessage', () => {
    const event = generateWebhookEvent({ channel: 'imessage' });
    expect(event.headers['X-Hub-Signature-256']).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // description
  // --------------------------------------------------------------------------

  it('includes the event type in description', () => {
    const event = generateWebhookEvent({
      channel: 'whatsapp',
      eventType: 'message-status',
    });
    expect(event.description).toContain('message-status');
  });

  it('includes the sender in the description', () => {
    const event = generateWebhookEvent({
      channel: 'signal',
      senderId: '+15559999999',
    });
    expect(event.description).toContain('+15559999999');
  });

  it('includes channel name in description', () => {
    const event = generateWebhookEvent({ channel: 'imessage' });
    expect(event.description).toContain('iMessage');
  });

  it('uses default senderId in description when not provided', () => {
    const whatsappEvent = generateWebhookEvent({ channel: 'whatsapp' });
    expect(whatsappEvent.description).toContain('15551234567');

    const signalEvent = generateWebhookEvent({ channel: 'signal' });
    expect(signalEvent.description).toContain('+15551234567');

    const imessageEvent = generateWebhookEvent({ channel: 'imessage' });
    expect(imessageEvent.description).toContain('test@icloud.com');
  });

  // --------------------------------------------------------------------------
  // WhatsApp payload structure
  // --------------------------------------------------------------------------

  it('WhatsApp payload has correct top-level structure', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp' });
    const payload = event.payload as any;

    expect(payload.object).toBe('whatsapp_business_account');
    expect(Array.isArray(payload.entry)).toBe(true);
    expect(payload.entry.length).toBe(1);
  });

  it('WhatsApp payload has entry.changes.value structure', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp' });
    const payload = event.payload as any;

    const entry = payload.entry[0];
    expect(entry.id).toBe('test-business-id');
    expect(Array.isArray(entry.changes)).toBe(true);

    const change = entry.changes[0];
    expect(change.field).toBe('messages');
    expect(change.value).toBeDefined();
    expect(change.value.messaging_product).toBe('whatsapp');
    expect(change.value.metadata).toBeDefined();
    expect(change.value.contacts).toBeDefined();
  });

  it('WhatsApp message event has messages array, no statuses', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp', eventType: 'message' });
    const value = (event.payload as any).entry[0].changes[0].value;

    expect(Array.isArray(value.messages)).toBe(true);
    expect(value.messages.length).toBe(1);
    expect(value.messages[0].type).toBe('text');
    expect(value.statuses).toBeUndefined();
  });

  it('WhatsApp message-status event has statuses array, no messages', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp', eventType: 'message-status' });
    const value = (event.payload as any).entry[0].changes[0].value;

    expect(value.messages).toBeUndefined();
    expect(Array.isArray(value.statuses)).toBe(true);
    expect(value.statuses.length).toBe(1);
    expect(value.statuses[0].status).toBe('delivered');
  });

  it('WhatsApp non-message event has no messages array', () => {
    const event = generateWebhookEvent({ channel: 'whatsapp', eventType: 'typing' });
    const value = (event.payload as any).entry[0].changes[0].value;
    expect(value.messages).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Signal payload structure
  // --------------------------------------------------------------------------

  it('Signal payload has envelope.dataMessage structure for message events', () => {
    const event = generateWebhookEvent({ channel: 'signal' });
    const payload = event.payload as any;

    expect(payload.envelope).toBeDefined();
    expect(payload.envelope.source).toBeDefined();
    expect(payload.envelope.sourceDevice).toBe(1);
    expect(payload.envelope.timestamp).toBeDefined();
    expect(payload.envelope.dataMessage).toBeDefined();
    expect(payload.envelope.dataMessage.message).toBe('Hello from webhook test');
    expect(payload.account).toBe('+15559876543');
  });

  it('Signal typing event has typingMessage, no dataMessage', () => {
    const event = generateWebhookEvent({ channel: 'signal', eventType: 'typing' });
    const envelope = (event.payload as any).envelope;

    expect(envelope.dataMessage).toBeUndefined();
    expect(envelope.typingMessage).toBeDefined();
    expect(envelope.typingMessage.action).toBe('STARTED');
  });

  it('Signal read-receipt event has receiptMessage, no dataMessage', () => {
    const event = generateWebhookEvent({ channel: 'signal', eventType: 'read-receipt' });
    const envelope = (event.payload as any).envelope;

    expect(envelope.dataMessage).toBeUndefined();
    expect(envelope.receiptMessage).toBeDefined();
    expect(envelope.receiptMessage.type).toBe('READ');
    expect(Array.isArray(envelope.receiptMessage.timestamps)).toBe(true);
  });

  it('Signal non-group message has no groupInfo', () => {
    const event = generateWebhookEvent({ channel: 'signal' });
    const dm = (event.payload as any).envelope.dataMessage;
    expect(dm.groupInfo).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // iMessage payload structure
  // --------------------------------------------------------------------------

  it('iMessage payload has correct top-level structure', () => {
    const event = generateWebhookEvent({ channel: 'imessage' });
    const payload = event.payload as any;

    expect(payload.type).toBe('message');
    expect(payload.sender).toBeDefined();
    expect(payload.chatId).toBeDefined();
    expect(typeof payload.isGroup).toBe('boolean');
    expect(payload.timestamp).toBeDefined();
    expect(payload.message).toBeDefined();
  });

  it('iMessage message event has message object with id, text, attachments', () => {
    const event = generateWebhookEvent({
      channel: 'imessage',
      text: 'Test message',
    });
    const msg = (event.payload as any).message;

    expect(msg.id).toBeDefined();
    expect(msg.id).toMatch(/^imsg-/);
    expect(msg.text).toBe('Test message');
    expect(Array.isArray(msg.attachments)).toBe(true);
  });

  it('iMessage typing event has no message object', () => {
    const event = generateWebhookEvent({
      channel: 'imessage',
      eventType: 'typing',
    });
    expect((event.payload as any).message).toBeUndefined();
    expect((event.payload as any).type).toBe('typing');
  });

  it('iMessage chatId differs for group vs non-group', () => {
    const dmEvent = generateWebhookEvent({
      channel: 'imessage',
      isGroup: false,
      senderId: 'bob@icloud.com',
    });
    const groupEvent = generateWebhookEvent({
      channel: 'imessage',
      isGroup: true,
      senderId: 'bob@icloud.com',
    });

    const dmChatId = (dmEvent.payload as any).chatId;
    const groupChatId = (groupEvent.payload as any).chatId;

    expect(dmChatId).toContain('bob@icloud.com');
    expect(groupChatId).toMatch(/^chat-group-/);
  });

  it('iMessage non-group has groupName undefined', () => {
    const event = generateWebhookEvent({ channel: 'imessage' });
    expect((event.payload as any).groupName).toBeUndefined();
  });
});

// ============================================================================
// getAvailableEventTypes
// ============================================================================

describe('getAvailableEventTypes', () => {
  it('returns 6 event types for WhatsApp', () => {
    const types = getAvailableEventTypes('whatsapp');
    expect(types).toHaveLength(6);
    expect(types).toEqual([
      'message',
      'message-status',
      'group-join',
      'group-leave',
      'typing',
      'read-receipt',
    ]);
  });

  it('returns 3 event types for Signal', () => {
    const types = getAvailableEventTypes('signal');
    expect(types).toHaveLength(3);
    expect(types).toEqual(['message', 'typing', 'read-receipt']);
  });

  it('returns 3 event types for iMessage', () => {
    const types = getAvailableEventTypes('imessage');
    expect(types).toHaveLength(3);
    expect(types).toEqual(['message', 'typing', 'read-receipt']);
  });

  it('returns ["message"] for an unknown channel', () => {
    const types = getAvailableEventTypes('unknown-channel' as any);
    expect(types).toEqual(['message']);
  });

  it('all WhatsApp event types include "message" as the first entry', () => {
    const types = getAvailableEventTypes('whatsapp');
    expect(types[0]).toBe('message');
  });

  it('WhatsApp has group-join and group-leave but Signal and iMessage do not', () => {
    const waTypes = getAvailableEventTypes('whatsapp');
    const signalTypes = getAvailableEventTypes('signal');
    const imsgTypes = getAvailableEventTypes('imessage');

    expect(waTypes).toContain('group-join');
    expect(waTypes).toContain('group-leave');
    expect(signalTypes).not.toContain('group-join');
    expect(signalTypes).not.toContain('group-leave');
    expect(imsgTypes).not.toContain('group-join');
    expect(imsgTypes).not.toContain('group-leave');
  });

  it('all channels support the "message" event type', () => {
    for (const channel of ['whatsapp', 'signal', 'imessage'] as const) {
      const types = getAvailableEventTypes(channel);
      expect(types).toContain('message');
    }
  });
});
