import type { HostResponse, SideChatContextRef } from '@piwin/contracts';
import type { HostCommandRequestClient } from './host-client-request-port.js';

/**
 * Side chat commands (spec §8). Builders only: the source session and the
 * side-chat record stay Host authority.
 */

/** Open a side chat from a main session. */
export function requestSideChatOpen(
  client: HostCommandRequestClient,
  sourceSessionId: string,
  options?: {
    name?: string;
    sourceMessageId?: string;
    refs?: SideChatContextRef[];
  },
): Promise<HostResponse> {
  return client.request({
    type: 'side-chat/open',
    sourceSessionId,
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}),
    ...(options?.refs && options.refs.length > 0 ? { refs: options.refs } : {}),
  });
}

/** List side chats for a source session. */
export function requestSideChatList(
  client: HostCommandRequestClient,
  sourceSessionId: string,
  options?: { includeArchived?: boolean },
): Promise<HostResponse> {
  return client.request({
    type: 'side-chat/list',
    sourceSessionId,
    ...(options?.includeArchived ? { includeArchived: true } : {}),
  });
}

/** Sync a side chat's context from its source session. */
export function requestSideChatSync(
  client: HostCommandRequestClient,
  sideChatSessionId: string,
): Promise<HostResponse> {
  return client.request({ type: 'side-chat/sync', sideChatSessionId });
}
