import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startOutboundPoller, type OutboundPollerOptions, type DeliverFunction } from '../outbound-poller.js';
import type { RelayClient } from '../client.js';
import type { OutboundConfig } from '../../config/types.js';
import type { OutboundMessage, ChatEgressEnvelope } from '../types.js';

/**
 * Create a mock RelayClient with pollOutbound and ackOutbound mocked.
 */
function makeMockRelayClient() {
  return {
    pollOutbound: vi.fn().mockResolvedValue([]),
    ackOutbound: vi.fn().mockResolvedValue(undefined),
  } as unknown as RelayClient;
}

function makeConfig(overrides?: Partial<OutboundConfig>): OutboundConfig {
  return {
    pollIntervalSeconds: 5,
    maxPerPoll: 10,
    ...overrides,
  };
}

function makeOutboundMessage(overrides?: Partial<OutboundMessage>): OutboundMessage {
  return {
    id: 'msg-001',
    envelope: {
      channel: 'whatsapp',
      conversationId: 'conv-123',
      text: 'Hello from MyndHyve',
    } satisfies ChatEgressEnvelope,
    queuedAt: '2025-06-15T12:00:00.000Z',
    priority: 0,
    attempts: 0,
    ...overrides,
  };
}

describe('startOutboundPoller', () => {
  let controller: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls for messages and delivers them', async () => {
    const client = makeMockRelayClient();
    const msg = makeOutboundMessage({ id: 'msg-deliver' });
    (client.pollOutbound as ReturnType<typeof vi.fn>).mockResolvedValueOnce([msg]);

    const deliver: DeliverFunction = vi.fn().mockResolvedValue({
      success: true,
      platformMessageId: 'platform-001',
    });

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ pollIntervalSeconds: 5 }),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);

    // First poll fires immediately
    await vi.advanceTimersByTimeAsync(0);

    expect(client.pollOutbound).toHaveBeenCalledWith('relay-001');
    expect(deliver).toHaveBeenCalledWith(msg.envelope);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('calls ackOutbound with success result', async () => {
    const client = makeMockRelayClient();
    const msg = makeOutboundMessage({ id: 'msg-ack-success' });
    (client.pollOutbound as ReturnType<typeof vi.fn>).mockResolvedValueOnce([msg]);

    const deliver: DeliverFunction = vi.fn().mockResolvedValue({
      success: true,
      platformMessageId: 'platform-002',
    });

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig(),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.ackOutbound).toHaveBeenCalledWith(expect.objectContaining({
      outboundMessageId: 'msg-ack-success',
      success: true,
      platformMessageId: 'platform-002',
      durationMs: expect.any(Number),
    }));

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('handles delivery failure (acks with error)', async () => {
    const client = makeMockRelayClient();
    const msg = makeOutboundMessage({ id: 'msg-fail' });
    (client.pollOutbound as ReturnType<typeof vi.fn>).mockResolvedValueOnce([msg]);

    const deliver: DeliverFunction = vi.fn().mockResolvedValue({
      success: false,
      error: 'Recipient blocked',
      retryable: false,
    });

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig(),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.ackOutbound).toHaveBeenCalledWith(expect.objectContaining({
      outboundMessageId: 'msg-fail',
      success: false,
      error: 'Recipient blocked',
      retryable: false,
      durationMs: expect.any(Number),
    }));

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('handles deliver() throwing (acks with error, retryable=true)', async () => {
    const client = makeMockRelayClient();
    const msg = makeOutboundMessage({ id: 'msg-throw' });
    (client.pollOutbound as ReturnType<typeof vi.fn>).mockResolvedValueOnce([msg]);

    const deliver: DeliverFunction = vi.fn().mockRejectedValue(new Error('Connection reset'));

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig(),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);
    await vi.advanceTimersByTimeAsync(0);

    // Should try to ack the failure
    expect(client.ackOutbound).toHaveBeenCalledWith(expect.objectContaining({
      outboundMessageId: 'msg-throw',
      success: false,
      error: 'Connection reset',
      retryable: true,
      durationMs: expect.any(Number),
    }));

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('handles poll failure (continues to next cycle)', async () => {
    const client = makeMockRelayClient();
    // First poll fails, second succeeds with a message
    const msg = makeOutboundMessage({ id: 'msg-after-fail' });
    (client.pollOutbound as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce([msg]);

    const deliver: DeliverFunction = vi.fn().mockResolvedValue({ success: true });

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ pollIntervalSeconds: 5 }),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);

    // First poll (fails)
    await vi.advanceTimersByTimeAsync(0);
    expect(client.pollOutbound).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled(); // No delivery attempt on poll failure

    // Second poll (succeeds) after interval
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.pollOutbound).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(msg.envelope);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('stops when signal is aborted', async () => {
    const client = makeMockRelayClient();
    const deliver: DeliverFunction = vi.fn().mockResolvedValue({ success: true });

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ pollIntervalSeconds: 5 }),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);

    // First poll
    await vi.advanceTimersByTimeAsync(0);
    expect(client.pollOutbound).toHaveBeenCalledTimes(1);

    // Abort
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise; // Should resolve cleanly

    // Advance significantly — no more polls
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.pollOutbound).toHaveBeenCalledTimes(1);
  });

  it('handles empty message array', async () => {
    const client = makeMockRelayClient();
    (client.pollOutbound as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const deliver: DeliverFunction = vi.fn();

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ pollIntervalSeconds: 5 }),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);

    // First poll returns empty
    await vi.advanceTimersByTimeAsync(0);
    expect(client.pollOutbound).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();

    // Second poll also empty
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.pollOutbound).toHaveBeenCalledTimes(2);
    expect(deliver).not.toHaveBeenCalled();

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('skips duplicate message on re-poll after ack failure', async () => {
    const client = makeMockRelayClient();
    const msg = makeOutboundMessage({ id: 'msg-dup' });

    // First poll: message delivered successfully, but ack throws
    (client.pollOutbound as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([msg])   // poll 1: deliver + ack fails
      .mockResolvedValueOnce([msg]);  // poll 2: same message re-queued by server

    const deliver: DeliverFunction = vi.fn().mockResolvedValue({
      success: true,
      platformMessageId: 'p-dup',
    });

    // First ack throws (simulating network blip), subsequent acks succeed
    (client.ackOutbound as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(undefined);

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ pollIntervalSeconds: 5 }),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);

    // Poll 1: deliver succeeds, ack fails (message tracked as delivered)
    await vi.advanceTimersByTimeAsync(0);
    expect(deliver).toHaveBeenCalledTimes(1);

    // Poll 2: same message re-appears — should be SKIPPED (no second deliver)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deliver).toHaveBeenCalledTimes(1); // Still 1 — not called again
    expect(client.pollOutbound).toHaveBeenCalledTimes(2);

    // ackOutbound calls:
    //   1st: success ack (throws — simulated network blip)
    //   2nd: catch-block error ack (from processOutboundMessage error handler)
    //   3rd: re-ack for duplicate on second poll
    expect(client.ackOutbound).toHaveBeenCalledTimes(3);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('delivers multiple messages in sequence', async () => {
    const client = makeMockRelayClient();
    const msg1 = makeOutboundMessage({ id: 'msg-1', envelope: { channel: 'whatsapp', conversationId: 'c1', text: 'First' } });
    const msg2 = makeOutboundMessage({ id: 'msg-2', envelope: { channel: 'whatsapp', conversationId: 'c2', text: 'Second' } });
    (client.pollOutbound as ReturnType<typeof vi.fn>).mockResolvedValueOnce([msg1, msg2]);

    const deliver: DeliverFunction = vi.fn().mockResolvedValue({ success: true, platformMessageId: 'p-id' });

    const options: OutboundPollerOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig(),
      deliver,
      signal: controller.signal,
    };

    const promise = startOutboundPoller(options);
    await vi.advanceTimersByTimeAsync(0);

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(msg1.envelope);
    expect(deliver).toHaveBeenCalledWith(msg2.envelope);
    expect(client.ackOutbound).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });
});
