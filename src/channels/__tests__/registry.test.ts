import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChannelPlugin } from '../types.js';
import type { RelayChannel, ChatIngressEnvelope, ChatEgressEnvelope } from '../../relay/types.js';

/**
 * The channel registry uses a module-level Map. We use vi.resetModules()
 * before each test and dynamically import the registry to get a fresh Map.
 */

type RegistryModule = {
  registerChannel: (plugin: ChannelPlugin) => void;
  getChannel: (channel: RelayChannel) => ChannelPlugin | undefined;
  listChannels: () => ChannelPlugin[];
  listSupportedChannels: () => ChannelPlugin[];
};

let registry: RegistryModule;

/**
 * Create a mock ChannelPlugin for testing.
 */
function makeMockPlugin(
  channel: RelayChannel,
  overrides?: Partial<ChannelPlugin>
): ChannelPlugin {
  return {
    channel,
    displayName: `${channel} Plugin`,
    isSupported: true,
    login: async () => {},
    isAuthenticated: async () => false,
    start: async (_onInbound: (e: ChatIngressEnvelope) => Promise<void>, _signal: AbortSignal) => {},
    deliver: async (_envelope: ChatEgressEnvelope) => ({ success: true }),
    getStatus: () => 'disconnected',
    logout: async () => {},
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  registry = await import('../registry.js') as RegistryModule;
});

describe('registerChannel', () => {
  it('adds plugin to registry', () => {
    const plugin = makeMockPlugin('whatsapp');
    registry.registerChannel(plugin);

    const retrieved = registry.getChannel('whatsapp');
    expect(retrieved).toBe(plugin);
  });
});

describe('getChannel', () => {
  it('returns registered plugin', () => {
    const plugin = makeMockPlugin('signal');
    registry.registerChannel(plugin);

    expect(registry.getChannel('signal')).toBe(plugin);
  });

  it('returns undefined for unknown channel', () => {
    expect(registry.getChannel('whatsapp')).toBeUndefined();
    expect(registry.getChannel('signal')).toBeUndefined();
    expect(registry.getChannel('imessage')).toBeUndefined();
  });
});

describe('listChannels', () => {
  it('returns all registered plugins', () => {
    const wa = makeMockPlugin('whatsapp');
    const sig = makeMockPlugin('signal');
    const imsg = makeMockPlugin('imessage');

    registry.registerChannel(wa);
    registry.registerChannel(sig);
    registry.registerChannel(imsg);

    const all = registry.listChannels();
    expect(all).toHaveLength(3);
    expect(all).toContain(wa);
    expect(all).toContain(sig);
    expect(all).toContain(imsg);
  });

  it('returns empty array when no plugins registered', () => {
    expect(registry.listChannels()).toEqual([]);
  });
});

describe('listSupportedChannels', () => {
  it('filters to supported-only plugins', () => {
    const waSupported = makeMockPlugin('whatsapp', { isSupported: true });
    const sigUnsupported = makeMockPlugin('signal', {
      isSupported: false,
      unsupportedReason: 'Signal not installed',
    });
    const imsgSupported = makeMockPlugin('imessage', { isSupported: true });

    registry.registerChannel(waSupported);
    registry.registerChannel(sigUnsupported);
    registry.registerChannel(imsgSupported);

    const supported = registry.listSupportedChannels();
    expect(supported).toHaveLength(2);
    expect(supported).toContain(waSupported);
    expect(supported).toContain(imsgSupported);
    expect(supported).not.toContain(sigUnsupported);
  });

  it('returns empty array when no plugins are supported', () => {
    registry.registerChannel(makeMockPlugin('whatsapp', { isSupported: false }));
    registry.registerChannel(makeMockPlugin('signal', { isSupported: false }));

    expect(registry.listSupportedChannels()).toEqual([]);
  });

  it('returns empty array when no plugins registered', () => {
    expect(registry.listSupportedChannels()).toEqual([]);
  });
});

describe('registration overwrites', () => {
  it('overwrites existing plugin for same channel', () => {
    const pluginV1 = makeMockPlugin('whatsapp', { displayName: 'WhatsApp v1' });
    const pluginV2 = makeMockPlugin('whatsapp', { displayName: 'WhatsApp v2' });

    registry.registerChannel(pluginV1);
    expect(registry.getChannel('whatsapp')?.displayName).toBe('WhatsApp v1');

    registry.registerChannel(pluginV2);
    expect(registry.getChannel('whatsapp')?.displayName).toBe('WhatsApp v2');

    // Should still be only 1 entry total
    expect(registry.listChannels()).toHaveLength(1);
  });
});
