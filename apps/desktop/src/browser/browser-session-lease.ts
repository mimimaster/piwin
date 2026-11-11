/**
 * Desktop mirror lease + HostPush subscription for the browser workbench.
 * Pointer, IME, and CSS mapping stay in BrowserSessionPanel.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { HostServerMessage, WebElementPickResult } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { isTauriRuntime } from '../host/host-client-transport-detect.js';
import { createBrowserSessionClient, type BrowserSessionClient } from './browser-session-client';
import { createBrowserFrameDecoder } from './browser-frame-decoder';
import { openBrowserFrameNativeStream } from './browser-frame-native-stream.js';
import {
  EMPTY_BROWSER_SESSION_LEASE, reduceBrowserSessionLease,
  type BrowserHighlightBox, type BrowserSessionLeaseState,
} from './browser-session-state';

export { EMPTY_BROWSER_SESSION_LEASE, reduceBrowserHostPush } from './browser-session-state';
export type { BrowserHighlightBox, BrowserSessionFrame, BrowserSessionLeaseState } from './browser-session-state';

export type BrowserSessionLeaseClient = {
  subscribe: (listener: (message: HostServerMessage) => void) => () => void;
  subscribeBinary?: (listener: (bytes: Uint8Array) => void) => () => void;
  browserStart: (leaseId: string) => Promise<{ success: boolean; error?: string }>;
  browserStop: (leaseId: string) => Promise<{ success: boolean; error?: string }>;
};

export type BrowserSessionLease = BrowserSessionLeaseState & {
  client: BrowserSessionClient;
  mirrorLeaseId: string;
  mirrorError: string | null;
  getCurrentFrameBlob: () => Blob | undefined;
  setUrlInput: (urlInput: string) => void;
  setHighlight: (highlight: BrowserHighlightBox | null) => void;
  setPickPending: (pickPending: boolean) => void;
  setPickError: (pickError: string | null) => void;
};

export function startBrowserSessionLease(input: {
  host: BrowserSessionLeaseClient;
  onMessage: (message: HostServerMessage) => void;
  onStartFailed: (error?: string) => void;
  onStopFailed: (error?: string) => void;
  /** Caller-owned lease id. Follow-mode resize uses the same id (spec §4.1). */
  mirrorLeaseId?: string;
}): () => void {
  let cancelled = false;
  let hostLost = false;
  const mirrorLeaseId = input.mirrorLeaseId ?? crypto.randomUUID();
  const acquire = (): void => {
    void input.host
      .browserStart(mirrorLeaseId)
      .then((response) => {
        if (!cancelled && !response.success) input.onStartFailed(response.error);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          input.onStartFailed(error instanceof Error ? error.message : undefined);
        }
      });
  };
  const unsubscribe = input.host.subscribe((message) => {
    if (cancelled) return;
    // The Host releases a dropped connection's lease (after a grace period),
    // so a panel that outlives the socket re-asserts the same id on reconnect.
    if (message.type === 'host/status') {
      if (!message.ready) {
        hostLost = true;
      } else if (hostLost) {
        hostLost = false;
        acquire();
      }
    }
    input.onMessage(message);
  });

  acquire();

  return () => {
    cancelled = true;
    unsubscribe();
    // Stop failures still surface after unmount — same as the previous panel effect.
    void input.host
      .browserStop(mirrorLeaseId)
      .then((response) => {
        if (!response.success) input.onStopFailed(response.error);
      })
      .catch((error: unknown) => {
        input.onStopFailed(error instanceof Error ? error.message : undefined);
      });
  };
}

export function useBrowserSessionLease(input: {
  hostClient: HostClient;
  sessionId?: string;
  hostInstanceId?: string | null;
  onAddWebElement: (pick: WebElementPickResult) => void;
  mirrorStartFailed: string;
  mirrorStopFailed: string;
  /**
   * The workbench keeps one owner for every Browser surface. While nothing
   * shows the browser the owner stays mounted but idle: no lease is acquired,
   * so a collapsed panel does not pin Chromium.
   */
  enabled?: boolean;
}): BrowserSessionLease {
  const inputsRef = useRef(input);
  inputsRef.current = input;
  const hostClient = useMemo(
    () => createBrowserSessionClient(input.hostClient, input.sessionId),
    [input.hostClient, input.sessionId, input.hostInstanceId],
  );
  const enabled = input.enabled !== false;
  const [state, dispatch] = useReducer(reduceBrowserSessionLease, EMPTY_BROWSER_SESSION_LEASE);
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const mirrorLeaseId = useMemo(() => crypto.randomUUID(), [hostClient, enabled]);
  const activeLeaseRef = useRef(mirrorLeaseId);
  activeLeaseRef.current = mirrorLeaseId;
  const [previousClient, setPreviousClient] = useState(hostClient);
  // Reset during render: no frame, URL, or pick from A may paint in B, even
  // before React runs the old subscription's effect cleanup.
  if (previousClient !== hostClient) {
    setPreviousClient(hostClient);
    dispatch({ type: 'reset' });
    setMirrorError(null);
  }

  const decoderRef = useRef<ReturnType<typeof createBrowserFrameDecoder> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      decoderRef.current = undefined;
      setMirrorError(null);
      // Nothing shows the browser any more: drop the last frame and URL so no
      // surface can keep itself visible on a picture whose lease is gone.
      dispatch({ type: 'reset' });
      return;
    }
    const decoder = createBrowserFrameDecoder({
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      onReady: (view) => {
        if (activeLeaseRef.current === mirrorLeaseId) dispatch({ type: 'frame-ready', view });
      },
      onError: (reason) => {
        if (activeLeaseRef.current === mirrorLeaseId) dispatch({ type: 'frame-error', reason });
      },
      decode: async (src, signal) => {
        if (typeof Image === 'undefined') return;
        const image = new Image();
        const abort = (): void => {
          image.src = '';
        };
        signal.addEventListener('abort', abort, { once: true });
        image.src = src;
        if (typeof image.decode !== 'function') {
          signal.removeEventListener('abort', abort);
          image.src = '';
          return;
        }
        try {
          await image.decode();
          if (signal.aborted) throw new Error('decode-aborted');
        } finally {
          signal.removeEventListener('abort', abort);
          image.src = '';
        }
      },
    });
    decoderRef.current = decoder;
    let lastIdentity: {
      generation: number | undefined;
      pageId: string | undefined;
      documentRevision: number | undefined;
    } = { generation: undefined, pageId: undefined, documentRevision: undefined };
    const abortSetup = new AbortController();
    let nativeStreamFailed = false;
    let nativeStream: Awaited<ReturnType<typeof openBrowserFrameNativeStream>> | undefined;
    let unsubscribeBinary: (() => void) | undefined;
    let release = (): void => {};
    const useNativeFrameStream =
      isTauriRuntime() &&
      typeof input.hostClient.getTransport === 'function' &&
      input.hostClient.getTransport() === 'live';

    const startLease = (): void => {
      if (!useNativeFrameStream) {
        unsubscribeBinary = hostClient.subscribeBinary?.((bytes) => decoder.ingestBinary(bytes));
      }
      release = startBrowserSessionLease({
        host: hostClient,
        mirrorLeaseId,
        onMessage: (message) => {
          if (activeLeaseRef.current !== mirrorLeaseId) return;
          if (
            message.type.startsWith('browser/') &&
            ('sessionId' in message ? message.sessionId : undefined) !== input.sessionId
          ) return;
          if (message.type === 'browser/frame') {
            if (!useNativeFrameStream) decoder.ingestPush(message);
            else if (!nativeStreamFailed && message.payload.kind === 'unavailable') {
              decoder.reportError(message.payload.reason);
            }
            return;
          }
          dispatch({ type: 'host-push', message });
          if (message.type === 'browser/picked') {
            inputsRef.current.onAddWebElement(message.result);
          }
          if (message.type === 'browser/state') {
            const nextGeneration = message.generation ?? lastIdentity.generation;
            const nextPageId = message.pageId ?? lastIdentity.pageId;
            const nextDocumentRevision = message.documentRevision ?? lastIdentity.documentRevision;
            decoder.setTarget({
              ...(nextGeneration === undefined ? {} : { generation: nextGeneration }),
              ...(nextPageId === undefined ? {} : { pageId: nextPageId }),
              ...(nextDocumentRevision === undefined ? {} : { documentRevision: nextDocumentRevision }),
            });
            lastIdentity = {
              generation: nextGeneration,
              pageId: nextPageId,
              documentRevision: nextDocumentRevision,
            };
          }
          if (
            message.type === 'browser/state' &&
            message.lifecycle === 'ready' &&
            message.mirror === 'streaming'
          ) {
            setMirrorError(null);
          }
        },
        onStartFailed: (error) => {
          if (activeLeaseRef.current !== mirrorLeaseId) return;
          setMirrorError(error?.trim() ? error : inputsRef.current.mirrorStartFailed);
        },
        onStopFailed: (error) => {
          if (activeLeaseRef.current !== mirrorLeaseId) {
            console.warn('[browser] previous mirror release failed', error);
            return;
          }
          setMirrorError(error?.trim() ? error : inputsRef.current.mirrorStopFailed);
        },
      });
    };

    if (useNativeFrameStream) {
      void openBrowserFrameNativeStream({
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        signal: abortSetup.signal,
        onFrame: (bytes) => decoder.ingestNativePacket(bytes),
        onError: () => {
          nativeStreamFailed = true;
          decoder.reportError('frame-channel-unavailable');
        },
      })
        .then((stream) => {
          if (abortSetup.signal.aborted) {
            void stream.close().catch((error: unknown) => {
              console.warn('[browser] failed to release an obsolete frame stream', error);
            });
            return;
          }
          nativeStream = stream;
          startLease();
        })
        .catch((error: unknown) => {
          if (abortSetup.signal.aborted) return;
          nativeStreamFailed = true;
          console.error('[browser] failed to open native frame stream', error);
          decoder.reportError('frame-channel-unavailable');
          startLease();
        });
    } else {
      startLease();
    }
    return () => {
      abortSetup.abort();
      unsubscribeBinary?.();
      decoder.dispose();
      decoderRef.current = undefined;
      release();
      if (nativeStream !== undefined) {
        void nativeStream.close().catch((error: unknown) => {
          console.warn('[browser] failed to close native frame stream', error);
        });
      }
    };
  }, [enabled, hostClient, input.sessionId, mirrorLeaseId]);

  const setUrlInput = useCallback((urlInput: string) => {
    dispatch({ type: 'url-input', urlInput });
  }, []);
  const setHighlight = useCallback((highlight: BrowserHighlightBox | null) => {
    dispatch({ type: 'highlight', highlight });
  }, []);
  const setPickPending = useCallback((pickPending: boolean) => {
    dispatch({ type: 'pick-pending', pickPending });
  }, []);
  const setPickError = useCallback((pickError: string | null) => {
    dispatch({ type: 'pick-error', pickError });
  }, []);
  const getCurrentFrameBlob = useCallback(() => decoderRef.current?.getCurrentBlob(), []);

  return {
    client: hostClient,
    frame: state.frame,
    committedUrl: state.committedUrl,
    mirrorLeaseId,
    getCurrentFrameBlob,
    urlInput: state.urlInput,
    setUrlInput,
    title: state.title,
    highlight: state.highlight,
    setHighlight,
    pickPending: state.pickPending,
    setPickPending,
    pickError: state.pickError,
    setPickError,
    mirrorError,
    owner: state.owner,
    agentWantsLock: state.agentWantsLock,
    consoleLines: state.consoleLines,
    networkLines: state.networkLines,
    lifecycle: state.lifecycle,
    mirror: state.mirror,
    generation: state.generation,
    pageId: state.pageId,
    tabs: state.tabs,
    pendingDialog: state.pendingDialog,
    viewport: state.viewport,
    documentRevision: state.documentRevision,
    frameError: state.frameError,
  };
}
