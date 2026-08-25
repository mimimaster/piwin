import { randomUUID } from 'node:crypto';
import type {
  HostHydrationFrame,
  HostMode,
  HostReplayDoneFrame,
  HostSnapshotFrame,
  HostWireMessage,
  RemoteCapabilitySummary,
  RemoteHostStatusData,
  RemotePendingPermission,
  RemoteSessionMessagesData,
  RemoteSessionSummary,
  RemoteTranscriptMessage,
} from '@piwin/contracts';
import { HOST_PROTOCOL_VERSION, LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import type { HostRuntime } from '@piwin/host-runtime';
import {
  projectRemoteResponse,
  projectRemoteStatusData,
  redactRemoteHostPaths,
  type RemoteProjectionContext,
} from './remote-projection.js';
import type { HostEgressChannel } from './host-egress-channel.js';
import type { HostEgressHub } from './host-egress-hub.js';
import type { HostConnectionEvent } from './host-connection-lifecycle.js';
import {
  MAX_HYDRATION_MESSAGES_PER_SESSION,
  MAX_HYDRATION_SESSIONS,
  fitHydrationFrame,
  isRecord,
  isRemoteSessionSummary,
  limitHydrationMessage,
  normalizeHydrationSessionIds,
  normalizeSeq,
  toError,
  truncateUtf8,
} from './host-server-support.js';

export type HydrationConnection = {
  hydrationEnabled: boolean;
  liveSubscriptions: boolean;
  subscribedSessionIds: string[];
  egressChannel: HostEgressChannel | undefined;
  egressClientId: string | undefined;
  connectionId: string;
  clientId: string | undefined;
};

export type HostHydrationHost = {
  runtime: Pick<HostRuntime, 'handleCommand'>;
  instanceId: string;
  mode: HostMode;
  capabilities: RemoteCapabilitySummary;
  remoteMediaPaths: Map<string, string>;
  egressHub: HostEgressHub;
  onError: (error: Error) => void;
  send: (connection: HydrationConnection, message: HostWireMessage) => void;
  sendError: (
    connection: HydrationConnection,
    code: Extract<HostWireMessage, { type: 'error' }>['code'],
    message: string,
    requestId?: string,
  ) => void;
  onConnectionEvent: (event: HostConnectionEvent) => void;
};

export function projectionContext(host: HostHydrationHost): RemoteProjectionContext {
  return {
    hostInstanceId: host.instanceId,
    mode: host.mode,
    capabilities: host.capabilities,
    remoteMediaPaths: host.remoteMediaPaths,
  };
}

export async function replayHostConnection(
  host: HostHydrationHost,
  connection: HydrationConnection,
  requestId: string,
  sinceSeq: number,
  forceHydration = false,
  subscriptions?: { sessionIds?: string[] },
): Promise<void> {
  const egressChannel = connection.egressChannel;
  if (egressChannel === undefined) {
    host.sendError(connection, 'replay-failed', 'Host egress channel is not ready', requestId);
    return;
  }
  egressChannel.setPaused(true);
  try {
    const normalizedSinceSeq = normalizeSeq(sinceSeq);
    const initialReplay = host.egressHub.listReplay(normalizedSinceSeq);
    const shouldHydrate = forceHydration || !initialReplay.complete;
    let replay = initialReplay;
    let replaySinceSeq = normalizedSinceSeq;
    if (shouldHydrate && connection.hydrationEnabled) {
      // Fence before async I/O so snapshotSeq cannot include pushes that
      // are absent from the hydration payload.
      const fenceSeq = host.egressHub.getCurrentSeq();
      const hydration = await createHydrationFrame(
        host,
        forceHydration ? 'host-instance-changed' : 'replay-too-old',
        subscriptions,
        fenceSeq,
      );
      host.send(connection, hydration);
      host.onConnectionEvent({
        phase: 'hydration',
        connectionId: connection.connectionId,
        ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
        seq: fenceSeq,
      });
      replaySinceSeq = hydration.snapshot.snapshotSeq;
      egressChannel.advanceCursor(replaySinceSeq);
      replay = host.egressHub.listReplay(replaySinceSeq);
    } else if (!initialReplay.complete) {
      host.egressHub.noteSnapshotFallback();
      const snapshot: HostSnapshotFrame = {
        type: 'snapshot',
        reason: 'replay-too-old',
        currentSeq: replay.currentSeq,
        status: await getRemoteStatus(host),
      };
      host.send(connection, snapshot);
      host.onConnectionEvent({
        phase: 'snapshot',
        connectionId: connection.connectionId,
        ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
        seq: snapshot.currentSeq,
      });
      // Snapshot fences the client at currentSeq; only replay the live tail.
      replaySinceSeq = snapshot.currentSeq;
      egressChannel.advanceCursor(replaySinceSeq);
      replay = host.egressHub.listReplay(replaySinceSeq);
    }

    const fromSeq = replaySinceSeq + 1;
    egressChannel.sendReplay(replay.records);
    // The same records may have accumulated in the paused live queue while
    // the replay/snapshot was being built. Advance the channel fence after
    // replay so unpausing cannot send those records a second time; pushes
    // that arrived after currentSeq remain queued for the live tail.
    egressChannel.advanceCursor(replay.currentSeq);
    const toSeq = replay.records.at(-1)?.sequence.seq ?? replaySinceSeq;
    const replayDone: HostReplayDoneFrame = {
      type: 'replay/done',
      requestId,
      fromSeq,
      toSeq,
      currentSeq: replay.currentSeq,
      // Must reflect the post-hydration / post-snapshot continuous window,
      // not the pre-fence initialReplay gap that triggered recovery.
      complete: replay.complete,
    };
    host.send(connection, replayDone);
    host.onConnectionEvent({
      phase: 'replay-done',
      connectionId: connection.connectionId,
      ...(connection.clientId === undefined ? {} : { clientId: connection.clientId }),
      seq: replay.currentSeq,
    });
  } finally {
    egressChannel.setPaused(false);
  }
}

export async function createHydrationFrame(
  host: HostHydrationHost,
  reason: HostHydrationFrame['reason'],
  subscriptions: { sessionIds?: string[] } | undefined,
  fenceSeq: number,
): Promise<HostHydrationFrame> {
  const status = await getRemoteStatus(host);
  const context = projectionContext(host);
  const sessions = await loadHydrationSessions(host, context);
  const requestedSessionIds = normalizeHydrationSessionIds(subscriptions?.sessionIds);
  const messagesBySession: Record<string, RemoteTranscriptMessage[]> = {};
  const queuedTurnsBySession: Record<string, import('@piwin/contracts').QueuedTurnRecord[]> = {};
  const truncatedSessionIds: string[] = [];
  const pendingPermissions = await loadHydrationPendingPermissions(host, requestedSessionIds);

  for (const sessionId of requestedSessionIds) {
    try {
      const command = { type: 'session/messages' as const, sessionId };
      const response = await host.runtime.handleCommand(command);
      const projected = projectRemoteResponse(command, response, context);
      const data = projected.success && isRecord(projected.data) ? projected.data : undefined;
      const messageData = data as RemoteSessionMessagesData | undefined;
      const messages = Array.isArray(messageData?.messages) ? messageData.messages : [];
      const boundedMessages = messages
        .slice(-MAX_HYDRATION_MESSAGES_PER_SESSION)
        .map(limitHydrationMessage);
      if (messages.length > boundedMessages.length) {
        truncatedSessionIds.push(sessionId);
      }
      messagesBySession[sessionId] = boundedMessages;
      const queueCommand = { type: 'session/queued-turn-list' as const, sessionId };
      const queueResponse = await host.runtime.handleCommand(queueCommand);
      const projectedQueue = projectRemoteResponse(queueCommand, queueResponse, context);
      const queueData = projectedQueue.success ? projectedQueue.data : undefined;
      const queueRecords =
        queueData !== null && typeof queueData === 'object' && 'queuedTurns' in queueData
          ? (queueData as { queuedTurns?: unknown }).queuedTurns
          : undefined;
      if (Array.isArray(queueRecords)) {
        queuedTurnsBySession[sessionId] = queueRecords as import('@piwin/contracts').QueuedTurnRecord[];
      }
    } catch (error) {
      host.onError(toError(error, `Unable to hydrate session ${sessionId}`));
    }
  }

  return fitHydrationFrame({
    type: 'hydration',
    reason,
    snapshot: {
      snapshotId: randomUUID(),
      hostInstanceId: host.instanceId,
      snapshotSeq: fenceSeq,
      status,
      sessions,
      messagesBySession,
      queuedTurnsBySession,
      pendingPermissions,
      truncatedSessionIds,
    },
  });
}

async function getRemoteStatus(host: HostHydrationHost): Promise<RemoteHostStatusData> {
  try {
    const response = await host.runtime.handleCommand({
      type: 'host/status',
      id: `remote-snapshot-${randomUUID()}`,
    });
    if (response.success) {
      return projectRemoteStatusData(response.data, projectionContext(host));
    }
  } catch (error) {
    host.onError(toError(error, 'Unable to read Host status for snapshot'));
  }
  return {
    hostInstanceId: host.instanceId,
    protocolVersion: HOST_PROTOCOL_VERSION,
    mode: host.mode,
    ready: false,
    mock: false,
    activeSessionCount: 0,
    capabilities: host.capabilities,
  };
}

async function loadHydrationSessions(
  host: HostHydrationHost,
  context: RemoteProjectionContext,
): Promise<RemoteSessionSummary[]> {
  try {
    const command = { type: 'session/list' as const, maxItems: MAX_HYDRATION_SESSIONS };
    const response = await host.runtime.handleCommand(command);
    const projected = projectRemoteResponse(command, response, context);
    const data = projected.success && isRecord(projected.data) ? projected.data : undefined;
    const sessions = data?.sessions;
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions.filter(isRemoteSessionSummary).slice(0, MAX_HYDRATION_SESSIONS);
  } catch (error) {
    host.onError(toError(error, 'Unable to hydrate session list'));
    return [];
  }
}

async function loadHydrationPendingPermissions(
  host: HostHydrationHost,
  sessionIds: string[],
): Promise<RemotePendingPermission[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const allowed = new Set(sessionIds);
  try {
    const command = { type: 'permission/pending-list' as const };
    const response = await host.runtime.handleCommand(command);
    if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.permissions)) {
      return [];
    }
    const projected: RemotePendingPermission[] = [];
    for (const item of response.data.permissions) {
      if (projected.length >= 32) {
        break;
      }
      const record = isRecord(item) ? item : undefined;
      if (
        record === undefined ||
        typeof record.sessionId !== 'string' ||
        !allowed.has(record.sessionId) ||
        typeof record.requestId !== 'string' ||
        typeof record.action !== 'string' ||
        typeof record.detail !== 'string' ||
        (record.defaultDecision !== 'allow' &&
          record.defaultDecision !== 'deny' &&
          record.defaultDecision !== 'ask')
      ) {
        continue;
      }
      const permission: RemotePendingPermission = {
        sessionId: record.sessionId,
        requestId: record.requestId,
        action: record.action,
        detail: redactRemoteHostPaths(truncateUtf8(record.detail, 4 * 1024)),
        defaultDecision: record.defaultDecision,
      };
      if (typeof record.runId === 'string') {
        permission.runId = record.runId;
      }
      projected.push(permission);
    }
    return projected;
  } catch (error) {
    host.onError(toError(error, 'Unable to hydrate pending permissions'));
    return [];
  }
}

export async function applyLiveSubscriptionUpdate(
  host: HostHydrationHost,
  connection: HydrationConnection,
  frame: Extract<HostWireMessage, { type: 'client/subscriptions' }>,
): Promise<void> {
  const egressChannel = connection.egressChannel;
  const egressClientId = connection.egressClientId;
  if (!connection.liveSubscriptions || egressChannel === undefined || egressClientId === undefined) {
    host.sendError(
      connection,
      'bad-message',
      'This connection did not negotiate liveSubscriptions',
      frame.requestId,
    );
    return;
  }
  const nextIds = normalizeHydrationSessionIds(frame.subscriptions.sessionIds).slice(
    0,
    LIVE_SUBSCRIPTION_MAX_SESSION_IDS,
  );
  const previous = new Set(connection.subscribedSessionIds);
  const added = nextIds.filter((sessionId) => !previous.has(sessionId));
  egressChannel.setPaused(true);
  try {
    const fenceSeq = host.egressHub.getCurrentSeq();
    if (added.length > 0 && connection.hydrationEnabled) {
      const hydration = await createHydrationFrame(host, 'requested', { sessionIds: added }, fenceSeq);
      host.send(connection, hydration);
    }
    connection.subscribedSessionIds = nextIds;
    egressChannel.setLiveFilter({ sessionIds: new Set(nextIds) });
    const tail = host.egressHub.listReplay(fenceSeq);
    egressChannel.sendReplay(tail.records);
    egressChannel.advanceCursor(tail.currentSeq);
    host.send(connection, {
      type: 'subscriptions/applied',
      requestId: frame.requestId,
      revision: frame.revision,
      fenceSeq,
    });
  } finally {
    egressChannel.setPaused(false);
  }
}
