import { REMOTE_CHANNEL_CLOSE } from '@piwin/contracts';
import { RELAY_PEER_PREFIX_BYTES, rewriteRelayFramePeer } from '@piwin/host-transport';
import type { RawData, WebSocket } from 'ws';
import { sendWithinBudget, toBytes, type RelayContext, type RelayRoute } from './relay-context.js';
import { effectiveUserLimits } from './relay-limits.js';

/**
 * One client socket on `/v1/u/<userId>/connect?hostId=…`. Unknown user,
 * disabled user, denied or offline Host all close with the same 4404 so a
 * client cannot probe another user's Hosts.
 */
export function runRelayPeerSession(
  context: RelayContext,
  socket: WebSocket,
  route: RelayRoute,
): void {
  const user = context.registry.find(route.userId);
  if (user === undefined || user.disabled || context.registry.isHostDenied(route.hostId)) {
    unavailable();
    return;
  }
  const host = context.rooms.findHost(route.userId, route.hostId);
  if (host === undefined) {
    unavailable();
    return;
  }
  const joined = context.rooms.joinPeer(
    route.userId,
    route.hostId,
    socket,
    effectiveUserLimits(context.limits, user).maxPeersPerHost,
  );
  if (joined === undefined) {
    context.log({ kind: 'peer-rejected', code: REMOTE_CHANNEL_CLOSE.limited });
    socket.close(REMOTE_CHANNEL_CLOSE.limited, 'too many devices');
    return;
  }
  const { peer } = joined;
  sendWithinBudget(context, joined.host, JSON.stringify({ t: 'peer-joined', peer }));
  context.log({
    kind: 'peer-joined',
    ...route,
    peer,
    peers: context.rooms.peerCount(route.userId, route.hostId),
  });

  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (!isBinary) {
      socket.close(REMOTE_CHANNEL_CLOSE.badRequest, 'clients send binary only');
      return;
    }
    const bytes = toBytes(data);
    if (bytes.length > context.limits.maxFrameBytes) {
      socket.close(REMOTE_CHANNEL_CLOSE.frameTooLarge, 'frame too large');
      return;
    }
    if (bytes.length < RELAY_PEER_PREFIX_BYTES) {
      socket.close(REMOTE_CHANNEL_CLOSE.badRequest, 'invalid frame');
      return;
    }
    const target = context.rooms.findHost(route.userId, route.hostId);
    if (target === undefined) {
      socket.close(REMOTE_CHANNEL_CLOSE.unavailable, 'host offline');
      return;
    }
    // Whatever peer id the client wrote, the Host sees the one the relay assigned.
    sendWithinBudget(context, target, rewriteRelayFramePeer(bytes, peer));
  });

  socket.on('close', (code) => {
    if (!context.rooms.leavePeer(route.userId, route.hostId, peer, socket)) {
      return;
    }
    const current = context.rooms.findHost(route.userId, route.hostId);
    if (current !== undefined) {
      sendWithinBudget(context, current, JSON.stringify({ t: 'peer-left', peer }));
    }
    context.log({ kind: 'peer-left', ...route, peer, code });
  });

  function unavailable(): void {
    context.log({ kind: 'peer-rejected', code: REMOTE_CHANNEL_CLOSE.unavailable });
    socket.close(REMOTE_CHANNEL_CLOSE.unavailable, 'unavailable');
  }
}
