/**
 * MyndHyve CLI — Channel Registry
 *
 * Manages available channel plugins. Plugins register themselves
 * at import time and the registry provides lookup by channel name.
 */

import type { ChannelPlugin } from './types.js';
import type { RelayChannel } from '../relay/types.js';

const channels = new Map<RelayChannel, ChannelPlugin>();

export function registerChannel(plugin: ChannelPlugin): void {
  channels.set(plugin.channel, plugin);
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
