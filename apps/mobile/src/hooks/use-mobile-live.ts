import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LiveCallView,
  LiveMediaDriverId,
  LiveOwnerActionPush,
  LiveOwnerEvent,
  LiveReadyMissing,
  LiveStartData,
  LiveStatusData,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { isNativeTauriRuntime } from '../mobile-device-credential-vault.js';
import { createMobileLiveMediaRegistry } from '../live/create-mobile-live-media-registry.js';
import {
  adoptLiveStatus,
  emptyLiveStatus,
  isLiveStatusData,
  withoutLiveCallBusy,
} from '../live/mobile-live-state.js';
import type {
  MobileLiveMediaDriver,
  MobileLivePeerSnapshot,
} from '../live/mobile-live-media-driver.js';

const IDLE_PEER: MobileLivePeerSnapshot = { phase: 'idle', muted: false, errorCode: null };

export type MobileLiveCallController = {
  status: LiveStatusData | null;
  call: LiveCallView | null;
  owned: boolean;
  peer: MobileLivePeerSnapshot;
  starting: boolean;
  error: string | null;
  canStart: boolean;
  start: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  end: () => Promise<void>;
  dismissError: () => void;
};

export function mobileLiveCapabilities(): {
  microphone: boolean;
  mediaDriverIds: LiveMediaDriverId[];
} {
  const mediaDriverIds: LiveMediaDriverId[] = [];
  if (typeof RTCPeerConnection === 'function') mediaDriverIds.push('codex-webrtc-v1');
  if (typeof WebSocket === 'function') mediaDriverIds.push('gemini-live-v1beta');
  // OpenAI-compatible providers require an Authorization header. The Tauri
  // socket plugin supplies it without putting the provider key in a URL.
  if (isNativeTauriRuntime()) mediaDriverIds.push('openai-realtime-ws-v1');
  return {
    microphone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
    mediaDriverIds,
  };
}

export function useMobileLive(input: {
  hostClient: HostClient | undefined;
  sessionId: string | undefined;
  ensureSession?: () => Promise<string | undefined>;
}): MobileLiveCallController {
  const [status, setStatus] = useState<LiveStatusData | null>(null);
  const statusRef = useRef<LiveStatusData | null>(null);
  const [peer, setPeer] = useState(IDLE_PEER);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const driverRef = useRef<MobileLiveMediaDriver | null>(null);
  const unsubscribeDriverRef = useRef<(() => void) | null>(null);
  const unsubscribeEventsRef = useRef<(() => void) | null>(null);
  const callRef = useRef<LiveCallView | null>(null);
  const startingRef = useRef(false);
  const userEndedRef = useRef(false);
  const failCloseInFlightRef = useRef(false);
  const epochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(input.sessionId);
  sessionRef.current = input.sessionId;
  const clientRef = useRef(input.hostClient);
  clientRef.current = input.hostClient;
  const endChainRef = useRef(Promise.resolve());

  const refreshStatus = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === undefined) return;
    try {
      const response = await client.request({
        type: 'voice/live/status',
        input: {
          ...(sessionRef.current === undefined ? {} : { sessionId: sessionRef.current }),
          capabilities: mobileLiveCapabilities(),
        },
      });
      if (clientRef.current !== client) return;
      if (!response.success || !isLiveStatusData(response.data)) {
        const empty = emptyLiveStatus(statusRef.current);
        statusRef.current = empty;
        setStatus(empty);
        return;
      }
      const next = adoptLiveStatus(statusRef.current, response.data);
      statusRef.current = next;
      setStatus(next);
      if (callRef.current && next.call?.callId === callRef.current.callId) {
        callRef.current = next.call;
      }
    } catch (caught: unknown) {
      if (clientRef.current === client) {
        setError(caught instanceof Error ? caught.message : '读取 Live 状态失败');
      }
    }
  }, []);

  const reportEvent = useCallback(async (event: LiveOwnerEvent): Promise<void> => {
    const client = clientRef.current;
    const call = callRef.current;
    if (client === undefined || call === null) return;
    await client.request({
      type: 'voice/live/report-event',
      input: { callId: call.callId, expectedRevision: call.revision, event },
    });
  }, []);

  const failAndClose = useCallback(async (reason: string): Promise<void> => {
    if (userEndedRef.current || failCloseInFlightRef.current) return;
    failCloseInFlightRef.current = true;
    try {
      abortRef.current?.abort();
      abortRef.current = null;
      const call = callRef.current;
      callRef.current = null;
      startingRef.current = false;
      setStarting(false);
      unsubscribeDriverRef.current?.();
      unsubscribeDriverRef.current = null;
      unsubscribeEventsRef.current?.();
      unsubscribeEventsRef.current = null;
      const driver = driverRef.current;
      driverRef.current = null;
      await driver?.close().catch(() => undefined);
      const client = clientRef.current;
      if (client !== undefined && call !== null) {
        await client
          .request({
            type: 'voice/live/end',
            input: { callId: call.callId, expectedRevision: call.revision, reason: 'error' },
          })
          .catch(() => undefined);
      }
      const current = statusRef.current;
      const next = emptyLiveStatus(current);
      statusRef.current = next;
      setStatus(next);
      setPeer(IDLE_PEER);
      setError(reason);
    } finally {
      failCloseInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    statusRef.current = null;
    callRef.current = null;
    setStatus(null);
    setError(null);
    if (input.hostClient === undefined) return;
    void refreshStatus();
    const unsubscribePush = input.hostClient.subscribePush((push) => {
      if (push.type === 'voice/live-updated') {
        const current = statusRef.current;
        const next = adoptLiveStatus(current, {
          ready: current?.ready ?? true,
          selectedProviderId: current?.selectedProviderId ?? '',
          settingsRevision: current?.settingsRevision ?? 0,
          missing: withoutLiveCallBusy(current?.missing ?? []),
          call: push.call,
          ...(current?.mediaKind ? { mediaKind: current.mediaKind } : {}),
          ...(current?.mediaDriverId ? { mediaDriverId: current.mediaDriverId } : {}),
        });
        statusRef.current = next;
        setStatus(next);
        if (callRef.current && next.call?.callId === callRef.current.callId) {
          callRef.current = next.call;
        }
        if (push.call === null && callRef.current !== null && !startingRef.current) {
          void failAndClose('live-disconnected');
        }
        return;
      }
      if (push.type === 'voice/live-owner-action') {
        void driverRef.current?.handleOwnerAction(push as LiveOwnerActionPush).catch(() => {
          void failAndClose('live-protocol-failed');
        });
      }
    });
    const unsubscribeState = input.hostClient.subscribeState((state) => {
      if (state.kind === 'ready') return;
      if (callRef.current !== null && !startingRef.current) {
        void failAndClose('live-owner-disconnected');
      }
    });
    return () => {
      unsubscribePush();
      unsubscribeState();
      abortRef.current?.abort();
      abortRef.current = null;
      unsubscribeDriverRef.current?.();
      unsubscribeEventsRef.current?.();
      unsubscribeDriverRef.current = null;
      unsubscribeEventsRef.current = null;
      void driverRef.current?.close();
      driverRef.current = null;
    };
  }, [failAndClose, input.hostClient, refreshStatus]);

  const start = useCallback(async (): Promise<void> => {
    await endChainRef.current.catch(() => undefined);
    if (startingRef.current || input.hostClient === undefined) return;
    userEndedRef.current = false;
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    startingRef.current = true;
    setStarting(true);
    setError(null);

    let sessionId = sessionRef.current;
    if (sessionId === undefined && input.ensureSession !== undefined) {
      sessionId = await input.ensureSession();
      sessionRef.current = sessionId;
    }
    if (sessionId === undefined) {
      await failAndClose('live-session-unavailable');
      return;
    }

    const staleCall = statusRef.current?.call;
    if (staleCall && callRef.current === null) {
      await input.hostClient
        .request({
          type: 'voice/live/end',
          input: {
            callId: staleCall.callId,
            expectedRevision: staleCall.revision,
            reason: 'error',
          },
        })
        .catch(() => undefined);
      statusRef.current = emptyLiveStatus(statusRef.current);
      setStatus(statusRef.current);
    }

    await refreshStatus();
    if (epoch !== epochRef.current) return;
    const currentStatus = statusRef.current;
    const providerId = currentStatus?.selectedProviderId?.trim() ?? '';
    const mediaDriverId = currentStatus?.mediaDriverId;
    if (!providerId || mediaDriverId === undefined) {
      await failAndClose('live-provider-unavailable');
      return;
    }
    const driver = createMobileLiveMediaRegistry().create(mediaDriverId);
    if (!driver.isSupported()) {
      await failAndClose('live-media-unsupported');
      return;
    }
    driverRef.current = driver;
    unsubscribeDriverRef.current = driver.subscribe(setPeer);
    unsubscribeEventsRef.current = driver.subscribeEvents((event) => {
      if (epoch !== epochRef.current) return;
      if (event.type === 'media-failed') {
        void failAndClose(event.mappedCode ?? 'live-protocol-failed');
      } else if (event.type === 'media-closed') {
        void failAndClose('live-disconnected');
      }
      void reportEvent(event).catch(() => undefined);
    });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const bootstrap = await driver.prepareStart();
      if (epoch !== epochRef.current) return;
      const response = await input.hostClient.request({
        type: 'voice/live/start',
        input: {
          sessionId,
          providerId,
          settingsRevision: statusRef.current?.settingsRevision ?? 0,
          idempotencyKey: `live-mobile-${sessionId}-${Date.now().toString(36)}`,
          bootstrap,
        },
      });
      if (!response.success) throw new Error(response.error);
      const data = response.data as LiveStartData | undefined;
      if (!data?.call || !data.bootstrap) throw new Error('live-protocol-failed');
      callRef.current = data.call;
      await driver.connect(data.bootstrap, abort.signal);
      if (epoch !== epochRef.current) return;
      await reportEvent({ type: 'media-active' });
      await refreshStatus();
    } catch (caught: unknown) {
      if (epoch !== epochRef.current || isAbortError(caught)) return;
      const reason = caught instanceof Error ? caught.message : 'live-protocol-failed';
      await failAndClose(reason);
    } finally {
      if (epoch === epochRef.current) {
        abortRef.current = null;
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [failAndClose, input.ensureSession, input.hostClient, refreshStatus, reportEvent]);

  const setMuted = useCallback(async (muted: boolean): Promise<void> => {
    const client = clientRef.current;
    const call = callRef.current;
    if (client === undefined || call === null) return;
    driverRef.current?.setMuted(muted);
    await client.request({
      type: 'voice/live/set-muted',
      input: { callId: call.callId, expectedRevision: call.revision, muted },
    });
  }, []);

  const end = useCallback(async (): Promise<void> => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = endChainRef.current;
    endChainRef.current = gate;
    await previous.catch(() => undefined);
    try {
      epochRef.current += 1;
      userEndedRef.current = true;
      const call = callRef.current;
      callRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      startingRef.current = false;
      setStarting(false);
      await driverRef.current?.close();
      driverRef.current = null;
      unsubscribeDriverRef.current?.();
      unsubscribeEventsRef.current?.();
      unsubscribeDriverRef.current = null;
      unsubscribeEventsRef.current = null;
      const client = clientRef.current;
      if (client !== undefined) {
        await client.request({
          type: 'voice/live/end',
          input: call
            ? { callId: call.callId, expectedRevision: call.revision, reason: 'user' }
            : { reason: 'user' },
        });
      }
      const next = emptyLiveStatus(statusRef.current);
      statusRef.current = next;
      setStatus(next);
      setPeer(IDLE_PEER);
    } finally {
      release();
    }
  }, []);

  const call = status?.call ?? null;
  const owned = callRef.current !== null && call?.callId === callRef.current.callId;
  const missing: LiveReadyMissing[] = [
    ...(status?.missing ?? []),
    ...(input.sessionId === undefined && input.ensureSession === undefined
      ? (['session'] as const)
      : []),
  ];
  const hostReadyForStart =
    status !== null &&
    (status.ready || (status.missing.includes('session') && input.ensureSession !== undefined));
  const canStart =
    hostReadyForStart &&
    !starting &&
    call === null &&
    !missing.includes('provider-auth') &&
    !missing.includes('provider-unavailable') &&
    !missing.includes('media-unsupported') &&
    !missing.includes('microphone') &&
    !missing.includes('invalid-settings') &&
    !(missing.includes('session') && input.ensureSession === undefined);

  return {
    status,
    call,
    owned,
    peer,
    starting,
    error,
    canStart,
    start,
    setMuted,
    end,
    dismissError: () => setError(null),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
