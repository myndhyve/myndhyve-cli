/**
 * MyndHyve CLI — Channel Registry
 *
 * Manages available channel plugins. Plugins register themselves
 * at import time and the registry provides lookup by channel name.
 *
 * Plugins are lazy-loaded on first access via `ensureChannelsLoaded()`
 * to keep startup fast for non-relay commands.
 */

import type { ChannelPlugin } from './types.js';
import type { RelayChannel } from '../relay/types.js';

const channels = new Map<RelayChannel, ChannelPlugin>();
let loadPromise: Promise<void> | null = null;

export function registerChannel(plugin: ChannelPlugin): void {
  channels.set(plugin.channel, plugin);
}

/**
 * Lazy-load all channel plugins. Idempotent — safe to call concurrently.
 * This triggers the side-effect imports that register each plugin.
 */
export async function ensureChannelsLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = Promise.all([
    import('./whatsapp/index.js'),
    import('./signal/index.js'),
    import('./imessage/index.js'),
  ]).then(() => {});

  return loadPromise;
}

export function getChannel(channel: RelayChannel): ChannelPlugin | undefined {
  return channels.get(channel);
}

export function listChannels(): ChannelPlugin[] {
  return Array.from(channels.values());
}

export function listSupportedChannels(): ChannelPlugin[] {
  return listChannels().filter((ch) => ch.isSupported);
}
