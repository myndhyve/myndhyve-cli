import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startHeartbeatLoop, type HeartbeatLoopOptions } from '../heartbeat.js';
import type { RelayClient } from '../client.js';
import type { HeartbeatConfig } from '../../config/types.js';

/**
 * Create a mock RelayClient with only the heartbeat method mocked.
 */
function makeMockRelayClient() {
  return {
    heartbeat: vi.fn().mockResolvedValue({
      ok: true,
      hasPendingOutbound: false,
      heartbeatIntervalSeconds: 30,
    }),
  } as unknown as RelayClient;
}

function makeConfig(overrides?: Partial<HeartbeatConfig>): HeartbeatConfig {
  return {
    intervalSeconds: 30,
    ...overrides,
  };
}

describe('startHeartbeatLoop', () => {
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

  it('calls relayClient.heartbeat() on each interval', async () => {
    const client = makeMockRelayClient();
    const options: HeartbeatLoopOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ intervalSeconds: 10 }),
      getPlatformStatus: () => 'connected',
      getUptimeSeconds: () => 120,
      signal: controller.signal,
    };

    const promise = startHeartbeatLoop(options);

    // First heartbeat fires immediately (start of while loop)
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // Advance to second interval
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    // Advance to third interval
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(3);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('passes correct relayId and status', async () => {
    const client = makeMockRelayClient();
    const options: HeartbeatLoopOptions = {
      relayClient: client,
      relayId: 'relay-xyz',
      config: makeConfig({ intervalSeconds: 5 }),
      getPlatformStatus: () => 'authenticated',
      getUptimeSeconds: () => 300,
      signal: controller.signal,
    };

    const promise = startHeartbeatLoop(options);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledWith('relay-xyz', expect.objectContaining({
      platformStatus: 'authenticated',
      uptimeSeconds: 300,
    }));

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('stops when signal is aborted', async () => {
    const client = makeMockRelayClient();
    const options: HeartbeatLoopOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ intervalSeconds: 10 }),
      getPlatformStatus: () => 'connected',
      getUptimeSeconds: () => 0,
      signal: controller.signal,
    };

    const promise = startHeartbeatLoop(options);

    // First heartbeat
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // Abort before next interval
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    await promise; // Should resolve cleanly

    // Advance time significantly — no more heartbeats should fire
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('continues on heartbeat failure (non-fatal)', async () => {
    const client = makeMockRelayClient();
    // First call fails, second succeeds
    (client.heartbeat as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValue({
        ok: true,
        hasPendingOutbound: false,
        heartbeatIntervalSeconds: 30,
      });

    const options: HeartbeatLoopOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ intervalSeconds: 5 }),
      getPlatformStatus: () => 'connected',
      getUptimeSeconds: () => 0,
      signal: controller.signal,
    };

    const promise = startHeartbeatLoop(options);

    // First heartbeat (fails)
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // Second heartbeat (succeeds) — proves the loop didn't crash
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });

  it('uses configured interval', async () => {
    const client = makeMockRelayClient();
    const options: HeartbeatLoopOptions = {
      relayClient: client,
      relayId: 'relay-001',
      config: makeConfig({ intervalSeconds: 60 }),
      getPlatformStatus: () => 'connected',
      getUptimeSeconds: () => 0,
      signal: controller.signal,
    };

    const promise = startHeartbeatLoop(options);

    // First heartbeat fires immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // 30 seconds is not enough — should NOT fire second heartbeat
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // At 60 seconds — should fire
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  });
});
