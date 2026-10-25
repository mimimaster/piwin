import {
  decodeRelayControlFrame,
  REMOTE_CHANNEL_CLOSE,
  type RelayHostAuthFrame,
} from '@piwin/contracts';
import {
  createRelayChallengeNonce,
  normalizeRemoteDisplayName,
  unpackRelayFrame,
  verifyRelayHostAuth,
} from '@piwin/host-transport';
import type { RawData, WebSocket } from 'ws';
import { sendWithinBudget, toBytes, type RelayContext, type RelayRoute } from './relay-context.js';
import { effectiveUserLimits } from './relay-limits.js';
import { shortId } from './relay-log.js';

/**
 * One Host socket on `/v1/u/<userId>/host?hostId=…`: challenge, double
 * signature, registration check, then routing its frames to single peers.
 */
export function runRelayHostSession(
  context: RelayContext,
  socket: WebSocket,
  route: RelayRoute,
): void {
  const nonce = createRelayChallengeNonce();
  let authStarted = false;
  let ready = false;
  const authTimer = setTimeout(
    () => reject(REMOTE_CHANNEL_CLOSE.hostAuthFailed, 'auth timeout'),
    context.limits.hostAuthTimeoutMs,
  );

  socket.send(JSON.stringify({ t: 'challenge', nonce }));

  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (!ready) {
      if (authStarted) {
        socket.close(REMOTE_CHANNEL_CLOSE.badRequest, 'message before ready');
        return;
      }
      authStarted = true;
      void authenticate(data, isBinary);
      return;
    }
    if (!isBinary) {
      closePeerOnRequest(toBytes(data).toString());
      return;
    }
    routeHostFrame(toBytes(data));
  });

  socket.on('close', (code) => {
    clearTimeout(authTimer);
    if (!ready) return;
    const peers = context.rooms.detachHost(route.userId, route.hostId, socket);
    for (const peer of peers) {
      peer.close(REMOTE_CHANNEL_CLOSE.unavailable, 'host offline');
    }
    context.log({ kind: 'host-closed', userId: route.userId, hostId: route.hostId, code });
  });

  async function authenticate(data: RawData, isBinary: boolean): Promise<void> {
    clearTimeout(authTimer);
    const frame = isBinary ? undefined : decodeRelayControlFrame(toBytes(data).toString());
    if (frame?.t !== 'auth') {
      reject(REMOTE_CHANNEL_CLOSE.badRequest, 'expected auth');
      return;
    }
    const verdict = verifyRelayHostAuth(frame, { nonce, ...route });
    if (!verdict.ok) {
      reject(REMOTE_CHANNEL_CLOSE.hostAuthFailed, verdict.reason);
      return;
    }
    if (context.registry.isHostDenied(route.hostId)) {
      reject(REMOTE_CHANNEL_CLOSE.forbidden, 'host denied');
      return;
    }
    if (!(await ensureUser(frame))) {
      return;
    }
    const user = context.registry.find(route.userId);
    if (user === undefined || user.disabled) {
      reject(REMOTE_CHANNEL_CLOSE.forbidden, 'user disabled');
      return;
    }
    const replacing = context.rooms.findHost(route.userId, route.hostId) !== undefined;
    if (
      !replacing &&
      context.rooms.hostCount(route.userId) >= effectiveUserLimits(context.limits, user).maxHosts
    ) {
      reject(REMOTE_CHANNEL_CLOSE.limited, 'too many hosts');
      return;
    }
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    const previous = context.rooms.attachHost(route.userId, route.hostId, socket);
    ready = true;
    if (previous !== undefined) {
      previous.send(JSON.stringify({ t: 'host-replaced' }));
      previous.close(REMOTE_CHANNEL_CLOSE.replaced, 'host replaced');
      // Their channels were with the old socket's sessions; they re-handshake.
      for (const peer of context.rooms.dropPeers(route.userId, route.hostId)) {
        peer.close(REMOTE_CHANNEL_CLOSE.unavailable, 'host reconnected');
      }
    }
    socket.send(JSON.stringify({ t: 'ready' }));
    context.log({ kind: 'host-ready', ...route, replaced: previous !== undefined });
  }

  /** Unknown user: self-enroll with a valid token, otherwise refuse like a bad signature. */
  async function ensureUser(frame: RelayHostAuthFrame): Promise<boolean> {
    if (context.registry.find(route.userId) !== undefined) {
      return true;
    }
    if (context.enrollToken === undefined || !context.enrollToken.matches(frame.enrollToken)) {
      reject(REMOTE_CHANNEL_CLOSE.hostAuthFailed, 'user not registered');
      return false;
    }
    const name =
      normalizeRemoteDisplayName(frame.userName ?? '') ?? `user-${shortId(route.userId)}`;
    context.registry.addUser({ userId: route.userId, publicKey: frame.userPub, name });
    try {
      await context.persistRegistry();
    } catch (error) {
      context.registry.removeUser(route.userId);
      context.log({
        kind: 'registry-error',
        detail: error instanceof Error ? error.message : 'save failed',
      });
      reject(REMOTE_CHANNEL_CLOSE.hostAuthFailed, 'enrollment not saved');
      return false;
    }
    context.log({ kind: 'user-enrolled', userId: route.userId });
    return true;
  }

  function routeHostFrame(bytes: Uint8Array): void {
    if (bytes.length > context.limits.maxFrameBytes) {
      socket.close(REMOTE_CHANNEL_CLOSE.frameTooLarge, 'frame too large');
      return;
    }
    const frame = unpackRelayFrame(bytes);
    // Peer 0 would be a broadcast; every peer has its own keys, so there is none.
    if (frame === undefined || frame.peer === 0) {
      socket.close(REMOTE_CHANNEL_CLOSE.badRequest, 'invalid frame');
      return;
    }
    const target = context.rooms.findPeer(route.userId, route.hostId, frame.peer);
    if (target !== undefined) {
      sendWithinBudget(context, target, bytes);
    }
  }

  /** The only text a ready Host may send: close one of its own clients. */
  function closePeerOnRequest(text: string): void {
    const frame = decodeRelayControlFrame(text);
    if (frame?.t !== 'peer-close') {
      socket.close(REMOTE_CHANNEL_CLOSE.badRequest, 'unexpected text');
      return;
    }
    context.rooms
      .findPeer(route.userId, route.hostId, frame.peer)
      ?.close(frame.code, frame.reason ?? 'closed by host');
  }

  function reject(code: number, detail: string): void {
    context.log({ kind: 'host-rejected', ...route, code, detail });
    socket.close(code, code === REMOTE_CHANNEL_CLOSE.hostAuthFailed ? 'host auth failed' : detail);
  }
}
