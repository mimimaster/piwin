import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sanitizeLiveSpeakableResult,
  type HostServerMessage,
  type LiveCallView,
  type LiveOwnerEvent,
  type LiveReadyMissing,
  type LiveStartData,
  type LiveStatusData,
} from '@piwin/contracts';
import type { HostClient } from '../host-client.js';
import { canStartLive, liveProviderAuthError, resolveLiveStartChannel } from './live-call-copy.js';
import {
  adoptLiveStatus,
  desktopLiveCapabilities,
  emptyLiveStatus,
  preferFresherLiveCall,
  withoutLiveCallBusy,
} from './live-capabilities.js';
import { createDesktopLiveMediaRegistry } from './media/create-live-media-registry.js';
import type { DesktopLiveMediaDriver } from './media/live-media-driver.js';
import { LivePeerStartError, type LivePeer, type LivePeerSnapshot } from './live-peer.js';
import {
  canFeedLiveSessionResult,
  type LiveSessionAssistant,
} from './live-session-result.js';

export {
  canStartLive,
  liveMissingLabel,
  liveProviderAuthError,
  liveStartErrorLabel,
  resolveLiveStartChannel,
} from './live-call-copy.js';

export type LiveCallController = {
  status: LiveStatusData | null;
  call: LiveCallView | null;
  peer: LivePeerSnapshot;
  starting: boolean;
  error: string | null;
  canStart: boolean;
  start: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  end: () => Promise<void>;
  dismissError: () => void;
};

const IDLE_PEER: LivePeerSnapshot = { phase: 'idle', muted: false, errorCode: null };

export function useLiveCall(input: {
  hostClient: HostClient;
  sessionId: string | null;
  ensureSession?: () => Promise<string | null>;
  sessionStreaming?: boolean;
  lastAssistant?: LiveSessionAssistant | null;
  /** Test seam; production owns one browser WebRTC peer per mounted controller. */
  createPeer?: () => LivePeer;
  /** Called after Live is torn down because it failed. Do not keep a red bar. */
  onFail?: (error: string) => void;
}): LiveCallController {
  const [status, setStatus] = useState<LiveStatusData | null>(null);
  const statusRef = useRef<LiveStatusData | null>(null);
  statusRef.current = status;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peerSnapshot, setPeerSnapshot] = useState<LivePeerSnapshot>(IDLE_PEER);
  const driverRef = useRef<DesktopLiveMediaDriver | null>(null);
  const unsubscribePeerRef = useRef<(() => void) | null>(null);
  const unsubscribeEventsRef = useRef<(() => void) | null>(null);
  const callRef = useRef<LiveCallView | null>(null);
  const startingRef = useRef(false);
  const startEpochRef = useRef(0);
  const userEndedRef = useRef(false);
  const endChainRef = useRef(Promise.resolve());
  const sessionIdRef = useRef(input.sessionId);
  sessionIdRef.current = input.sessionId;
  const sessionId = input.sessionId;
  const lastDelegationIdRef = useRef<string | null>(null);
  const fedResultKeyRef = useRef<string | null>(null);

  const rejectIncomingCall = useCallback(
    (call: LiveCallView): void => {
      callRef.current = null;
      setStatus((current) => emptyLiveStatus(current));
      void input.hostClient.request({
        type: 'voice/live/end',
        input: {
          callId: call.callId,
          expectedRevision: call.revision,
          reason: 'user',
        },
      });
    },
    [input.hostClient],
  );
  const rejectIncomingCallRef = useRef(rejectIncomingCall);
  rejectIncomingCallRef.current = rejectIncomingCall;
  const failCloseInFlightRef = useRef(false);
  const onFailRef = useRef(input.onFail);
  onFailRef.current = input.onFail;

  const failAndClose = useCallback(
    async (code: string): Promise<void> => {
      if (userEndedRef.current || failCloseInFlightRef.current) return;
      failCloseInFlightRef.current = true;
      startEpochRef.current += 1;
      startingRef.current = false;
      setStarting(false);
      setError(null);
      const call = callRef.current;
      callRef.current = null;
      setStatus((current) => ({
        ...emptyLiveStatus(current),
        ready: current?.ready ?? true,
        missing: withoutLiveCallBusy(current?.missing ?? []),
      }));
      try {
        await driverRef.current?.close();
        if (call) {
          await input.hostClient
            .request({
              type: 'voice/live/end',
              input: {
                callId: call.callId,
                expectedRevision: call.revision,
                reason: 'error',
              },
            })
            .catch(() => undefined);
        }
        onFailRef.current?.(code);
      } finally {
        failCloseInFlightRef.current = false;
      }
    },
    [input.hostClient],
  );
  const failAndCloseRef = useRef(failAndClose);
  failAndCloseRef.current = failAndClose;

  const refreshStatus = useCallback(async () => {
    const response = await input.hostClient.request({
      type: 'voice/live/status',
      input: {
        ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
        capabilities: desktopLiveCapabilities(),
      },
    });
    if (!response.success || !response.data || typeof response.data !== 'object') {
      const empty = emptyLiveStatus(statusRef.current);
      statusRef.current = empty;
      setStatus(empty);
      return;
    }
    const next = response.data as LiveStatusData;
    if (next.call && userEndedRef.current) {
      rejectIncomingCallRef.current(next.call);
      return;
    }
    const merged = adoptLiveStatus(
      { ...emptyLiveStatus(statusRef.current), call: callRef.current },
      next,
    );
    statusRef.current = merged;
    setStatus(merged);
    callRef.current = merged.call;
    const peerPhase = driverRef.current?.snapshot().phase ?? 'idle';
    if (
      next.call &&
      !startingRef.current &&
      !userEndedRef.current &&
      !failCloseInFlightRef.current &&
      (peerPhase === 'idle' || peerPhase === 'ended' || peerPhase === 'error')
    ) {
      rejectIncomingCallRef.current(next.call);
    }
  }, [input.hostClient]);
  const refreshStatusRef = useRef(refreshStatus);
  refreshStatusRef.current = refreshStatus;

  useEffect(() => {
    void refreshStatusRef.current();
    const unsubscribe = input.hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'voice/live-updated') {
        if (message.call && userEndedRef.current) {
          rejectIncomingCallRef.current(message.call);
          return;
        }
        const hadCall = callRef.current !== null;
        const call = preferFresherLiveCall(callRef.current, message.call);
        callRef.current = call;
        setStatus((current) =>
          adoptLiveStatus(current, {
            ...emptyLiveStatus(current),
            ready: current?.ready ?? false,
            missing: withoutLiveCallBusy(current?.missing ?? []),
            call,
          }),
        );
        // A failed Host create also pushes null. Stopping the peer here aborts
        // the in-flight start() and hides the real error as cancelled.
        if (!message.call && hadCall && !startingRef.current) {
          void driverRef.current?.close();
          if (!userEndedRef.current && !failCloseInFlightRef.current) {
            onFailRef.current?.('live-disconnected');
          }
        }
        return;
      }
      if (message.type === 'voice/live-owner-action') {
        if (message.action === 'release-media' && startingRef.current) {
          return;
        }
        if (message.action === 'ack-delegation' && message.providerDelegationId) {
          lastDelegationIdRef.current = message.providerDelegationId;
        }
        void driverRef.current?.handleOwnerAction(message);
      }
    });
    return () => {
      unsubscribe();
      unsubscribePeerRef.current?.();
      unsubscribePeerRef.current = null;
      unsubscribeEventsRef.current?.();
      unsubscribeEventsRef.current = null;
      void driverRef.current?.close();
      driverRef.current = null;
    };
  }, [input.hostClient]);

  const reportEvent = useCallback(
    async (event: LiveOwnerEvent) => {
      const call = callRef.current;
      if (!call) return;
      await input.hostClient.request({
        type: 'voice/live/report-event',
        input: {
          callId: call.callId,
          expectedRevision: call.revision,
          event,
        },
      });
    },
    [input.hostClient],
  );

  useEffect(() => {
    const call = status?.call ?? callRef.current;
    const activity = call?.activity;
    if (
      !canFeedLiveSessionResult({
        activity,
        sessionStreaming: input.sessionStreaming === true,
        assistant: input.lastAssistant ?? null,
      })
    ) {
      return;
    }
    const assistant = input.lastAssistant;
    if (!assistant || !call) return;
    const key = `${call.callId}:${assistant.messageId}`;
    if (fedResultKeyRef.current === key) return;
    fedResultKeyRef.current = key;
    const content = sanitizeLiveSpeakableResult({
      assistantText: assistant.text,
      completed: assistant.done,
    });
    const delegationId = lastDelegationIdRef.current;
    driverRef.current?.appendContext({
      target: 'session',
      channel: 'speakable',
      content,
    });
    if (delegationId) {
      driverRef.current?.appendContext({
        target: 'delegation',
        channel: 'speakable',
        content,
        providerDelegationId: delegationId,
      });
    }
    callRef.current = { ...call, activity: 'listening' };
    setStatus((current) => ({
      ...emptyLiveStatus(current),
      ready: current?.ready ?? true,
      missing: current?.missing ?? [],
      call: callRef.current,
    }));
    void reportEvent({ type: 'activity', activity: 'listening' });
  }, [input.lastAssistant, input.sessionStreaming, reportEvent, status?.call]);

  const start = useCallback(async () => {
    await endChainRef.current.catch(() => undefined);
    if (startingRef.current) return;
    userEndedRef.current = false;
    const epoch = ++startEpochRef.current;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    let sessionId = sessionIdRef.current;
    if (!sessionId && input.ensureSession) {
      sessionId = await input.ensureSession();
      sessionIdRef.current = sessionId;
    }
    if (!sessionId) {
      if (epoch === startEpochRef.current) {
        startingRef.current = false;
        setStarting(false);
        void failAndCloseRef.current('live-session-unavailable');
      }
      return;
    }
    const leftover = callRef.current;
    if (leftover) {
      callRef.current = null;
      setStatus((current) => ({
        ...emptyLiveStatus(current),
        ready: current?.ready ?? true,
        missing: withoutLiveCallBusy(current?.missing ?? []),
      }));
      await input.hostClient
        .request({
          type: 'voice/live/end',
          input: {
            callId: leftover.callId,
            expectedRevision: leftover.revision,
            reason: 'error',
          },
        })
        .catch(() => undefined);
    }
    await refreshStatus();
    if (epoch !== startEpochRef.current) return;
    const channel = resolveLiveStartChannel(statusRef.current);
    if (!channel.ok) {
      startingRef.current = false;
      setStarting(false);
      void failAndCloseRef.current(channel.error);
      return;
    }
    const idempotencyKey = `live-${sessionId}-${Date.now().toString(36)}`;
    const driverId = channel.mediaDriverId;
    const registry = createDesktopLiveMediaRegistry(
      input.createPeer ? { createPeer: input.createPeer } : {},
    );
    const driver = registry.create(driverId);
    unsubscribePeerRef.current?.();
    unsubscribeEventsRef.current?.();
    unsubscribePeerRef.current = driver.subscribe(setPeerSnapshot);
    unsubscribeEventsRef.current = driver.subscribeEvents((event) => {
      if (epoch !== startEpochRef.current) return;
      if (event.type === 'media-failed') {
        void failAndCloseRef.current(event.mappedCode ?? 'peer-failed');
      } else if (event.type === 'media-closed') {
        void failAndCloseRef.current('live-disconnected');
      }
      void reportEvent(event);
    });
    driverRef.current = driver;
    const startAbort = new AbortController();
    try {
      const clientBootstrap = await driver.prepareStart();
      if (epoch !== startEpochRef.current) return;
      const response = await input.hostClient.request({
        type: 'voice/live/start',
        input: {
          sessionId,
          providerId: channel.providerId,
          settingsRevision: statusRef.current?.settingsRevision ?? 0,
          idempotencyKey,
          bootstrap: clientBootstrap,
        },
      });
      if (!response.success) throw new Error(response.error ?? 'live-protocol-failed');
      const data = response.data as LiveStartData | undefined;
      if (!data?.call || !data.bootstrap) throw new Error('negotiate missing answer');
      if (epoch !== startEpochRef.current) {
        throw new DOMException('aborted', 'AbortError');
      }
      callRef.current = data.call;
      await driver.connect(data.bootstrap, startAbort.signal);
      if (epoch !== startEpochRef.current) return;
      await reportEvent({ type: 'media-active' });
      await refreshStatus();
    } catch (caught: unknown) {
      if (epoch !== startEpochRef.current) return;
      if (isAbortError(caught)) {
        if (!userEndedRef.current) void failAndCloseRef.current('live-start-cancelled');
        return;
      }
      const raw =
        caught instanceof LivePeerStartError
          ? caught.code
          : caught instanceof Error
            ? caught.message
            : 'live-protocol-failed';
      const message =
        raw === 'live-provider-auth' ? liveProviderAuthError(channel.providerId) : raw;
      await failAndCloseRef.current(message);
    } finally {
      if (epoch === startEpochRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [input.createPeer, input.ensureSession, input.hostClient, refreshStatus, reportEvent]);

  const setMuted = useCallback(
    async (muted: boolean) => {
      const call = callRef.current;
      if (!call) return;
      driverRef.current?.setMuted(muted);
      await input.hostClient.request({
        type: 'voice/live/set-muted',
        input: { callId: call.callId, expectedRevision: call.revision, muted },
      });
    },
    [input.hostClient],
  );

  const end = useCallback(async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = endChainRef.current;
    endChainRef.current = gate;
    await previous.catch(() => undefined);
    try {
      const wasStarting = startingRef.current;
      startEpochRef.current += 1;
      userEndedRef.current = true;
      startingRef.current = false;
      setStarting(false);
      const call = callRef.current;
      callRef.current = null;
      setStatus((current) => emptyLiveStatus(current));
      await driverRef.current?.close();
      if (call) {
        await input.hostClient.request({
          type: 'voice/live/end',
          input: { callId: call.callId, expectedRevision: call.revision, reason: 'user' },
        });
      } else if (wasStarting) {
        await input.hostClient.request({
          type: 'voice/live/end',
          input: { reason: 'user' },
        });
      }
      await refreshStatusRef.current();
    } finally {
      release();
    }
  }, [input.hostClient]);

  const missing: LiveReadyMissing[] = [
    ...(status?.missing ?? []),
    ...(sessionId ? [] : (['session'] as const)),
  ];
  const canStart = canStartLive({
    sessionId,
    call: status?.call ?? null,
    starting,
    missing,
  });

  return {
    status,
    call: status?.call ?? null,
    peer: peerSnapshot,
    starting,
    error,
    canStart,
    start,
    setMuted,
    end,
    dismissError: () => {
      setError(null);
      const leftover = callRef.current;
      const peerPhase = driverRef.current?.snapshot().phase;
      if (leftover && peerPhase !== 'connected' && peerPhase !== 'negotiating') {
        void end();
      }
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
