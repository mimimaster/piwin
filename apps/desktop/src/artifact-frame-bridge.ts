import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE,
  ARTIFACT_FALLBACK_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  clampArtifactHeight,
  parseArtifactActionMessage,
  parseArtifactBridgeMessage,
  readArtifactPostSeq,
  resolveArtifactViewportFrameHeight,
  shouldEnterArtifactInlineOverflow,
  type ArtifactActionMessage,
  type ArtifactFrameMode,
} from '@piwin/artifact';
import { subscribeNativeArtifactBridge } from './artifact-native-bridge.js';
import type { ArtifactSandboxView } from './artifact-frame-stream.js';
export type ArtifactBridgeStatus = 'loading' | 'streaming' | 'ready' | 'fallback';

export type ArtifactFrameBridge = {
  height: number;
  /** Unclamped root box from the iframe. Used to detect overflow. */
  contentHeight: number;
  overflowsInlineFlow: boolean;
  status: ArtifactBridgeStatus;
  onIframeLoad: () => void;
  retryMeasurement: () => void;
};

type BridgeInput = {
  channelId: string;
  documentKey: string;
  decision: ArtifactSandboxView;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  enabled: boolean;
  measureHeight: boolean;
  bootstrapHeight: number;
  frameMode: ArtifactFrameMode;
  presentation: 'inline' | 'canvas';
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  onContentGrew?: () => void;
};

function hostOwnsViewport(frameMode: ArtifactFrameMode): boolean {
  return frameMode === 'inline-viewport' || frameMode === 'inline-overflow';
}

/**
 * Browser-channel trust. Prefer Window identity when WKWebView preserves it.
 * Sandboxed data: frames often fail `event.source === iframe.contentWindow`,
 * so a non-parent source is accepted and bound by channelId — the same
 * selector the native handler already uses.
 */
function isTrustedArtifactFrameSource(
  event: MessageEvent,
  iframeWindow: Window | null | undefined,
): boolean {
  if (event.source === iframeWindow) {
    return true;
  }
  return event.source !== null && event.source !== undefined && event.source !== window;
}

function resolvePaneHeight(input: BridgeInput): number | null {
  const paneHeight = input.iframeRef.current?.closest<HTMLElement>(
    '.conversation-pane-session',
  )?.clientHeight;
  return paneHeight !== undefined && paneHeight > 0 ? paneHeight : null;
}

function resolveViewportFrameHeight(input: BridgeInput): number {
  const paneHeight = resolvePaneHeight(input);
  const viewportHeight = paneHeight ?? (typeof window === 'undefined' ? 640 : window.innerHeight);
  const preferredHeight = resolveArtifactViewportFrameHeight(viewportHeight);
  return paneHeight === null
    ? preferredHeight
    : Math.min(preferredHeight, Math.max(MIN_ARTIFACT_IFRAME_HEIGHT, paneHeight));
}

function resolveStageHeight(input: BridgeInput): number {
  if (input.presentation === 'canvas') {
    return input.bootstrapHeight;
  }
  if (hostOwnsViewport(input.frameMode)) {
    return resolveViewportFrameHeight(input);
  }
  return input.bootstrapHeight;
}

/** Owns the revisioned Inline size stream and whitelisted Artifact actions. */
export function useArtifactFrameBridge(input: BridgeInput): ArtifactFrameBridge {
  const initialStatus: ArtifactBridgeStatus = input.measureHeight
    ? input.decision.mode === 'stream-preview'
      ? 'streaming'
      : 'loading'
    : 'ready';
  const [height, setHeight] = useState(() => resolveStageHeight(input));
  const [contentHeight, setContentHeight] = useState(input.bootstrapHeight);
  const [overflowsInlineFlow, setOverflowsInlineFlow] = useState(false);
  const [status, setStatus] = useState<ArtifactBridgeStatus>(initialStatus);
  const latestRef = useRef(input);
  latestRef.current = input;
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heightRef = useRef(input.bootstrapHeight);
  const overflowRef = useRef(false);
  const lastRevisionRef = useRef(-1);
  const lastPostSeqRef = useRef(-1);
  const statusRef = useRef<ArtifactBridgeStatus>(initialStatus);
  const dataHandlerRef = useRef<(data: unknown, trustedSource: boolean) => void>(() => undefined);

  const updateStatus = useCallback((nextStatus: ArtifactBridgeStatus): void => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const requestMeasurement = useCallback((fallbackViewport: boolean, force = true): void => {
    const current = latestRef.current;
    if (!current.measureHeight || hostOwnsViewport(current.frameMode)) return;
    current.iframeRef.current?.contentWindow?.postMessage(
      {
        type: ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE,
        channelId: current.channelId,
        fallbackViewport,
        force,
      },
      '*',
    );
  }, []);

  const clearReadyTimer = useCallback((): void => {
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  }, []);

  const startReadyTimer = useCallback((): void => {
    clearReadyTimer();
    const current = latestRef.current;
    if (!current.measureHeight) {
      return;
    }
    readyTimerRef.current = setTimeout(() => {
      readyTimerRef.current = null;
      const fallbackHeight = ARTIFACT_FALLBACK_HEIGHT;
      heightRef.current = fallbackHeight;
      setHeight(fallbackHeight);
      updateStatus('fallback');
      requestMeasurement(true);
      console.warn(
        'Artifact height bridge timed out; keeping the preview in a scrollable recovery viewport.',
        {
          channelId: current.channelId,
          fallbackHeight,
        },
      );
    }, ARTIFACT_READY_TIMEOUT_MS);
  }, [clearReadyTimer, requestMeasurement, updateStatus]);

  dataHandlerRef.current = (data, trustedSource): void => {
    const current = latestRef.current;
    const postSeq = readArtifactPostSeq(data);
    if (postSeq !== null && postSeq <= lastPostSeqRef.current) {
      return;
    }
    const action = parseArtifactActionMessage(data);
    if (action) {
      if (!trustedSource || action.channelId !== current.channelId) {
        return;
      }
      if (postSeq !== null) {
        lastPostSeqRef.current = postSeq;
      }
      if (
        current.presentation === 'canvas' &&
        current.onComposerProposal &&
        action.action === 'composer/propose-text'
      ) {
        current.onComposerProposal(action.payload);
      } else if (current.onArtifactAction && action.action === 'artifact/download-unsupported') {
        current.onArtifactAction(action);
      }
      return;
    }

    const message = parseArtifactBridgeMessage(data);
    if (
      !trustedSource ||
      !current.measureHeight ||
      hostOwnsViewport(current.frameMode) ||
      !message ||
      message.channelId !== current.channelId ||
      message.revision <= lastRevisionRef.current
    ) {
      return;
    }
    if (postSeq !== null) {
      lastPostSeqRef.current = postSeq;
    }
    lastRevisionRef.current = message.revision;
    const wasRecovering = statusRef.current === 'fallback';
    const rawHeight = message.height;
    setContentHeight(rawHeight);
    clearReadyTimer();
    // Frame modes only advance. Once the iframe owns scrolling, later
    // measurements must not turn its chrome back into a tall flow block.
    if (overflowRef.current || shouldEnterArtifactInlineOverflow(rawHeight)) {
      overflowRef.current = true;
      const chromeHeight = resolveViewportFrameHeight(current);
      const grew = chromeHeight > heightRef.current;
      heightRef.current = chromeHeight;
      setOverflowsInlineFlow(true);
      setHeight(chromeHeight);
      updateStatus(current.decision.mode === 'stream-preview' ? 'streaming' : 'ready');
      if (wasRecovering) requestMeasurement(false, false);
      if (grew) current.onContentGrew?.();
      return;
    }
    const measuredHeight = clampArtifactHeight(
      rawHeight,
      MIN_ARTIFACT_IFRAME_HEIGHT,
      MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
      ARTIFACT_BOOTSTRAP_HEIGHT,
    );
    const grew = measuredHeight > heightRef.current;
    heightRef.current = measuredHeight;
    setHeight(measuredHeight);
    updateStatus(current.decision.mode === 'stream-preview' ? 'streaming' : 'ready');
    if (wasRecovering) requestMeasurement(false, false);
    if (grew) current.onContentGrew?.();
  };

  const onIframeLoad = useCallback((): void => {
    lastRevisionRef.current = -1;
    lastPostSeqRef.current = -1;
    startReadyTimer();
    requestMeasurement(false);
  }, [requestMeasurement, startReadyTimer]);

  const retryMeasurement = useCallback((): void => {
    startReadyTimer();
    requestMeasurement(true);
  }, [requestMeasurement, startReadyTimer]);

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }
    const nextHeight = resolveStageHeight(input);
    heightRef.current = nextHeight;
    lastRevisionRef.current = -1;
    lastPostSeqRef.current = -1;
    setHeight(nextHeight);
    updateStatus(
      input.measureHeight
        ? input.decision.mode === 'stream-preview'
          ? 'streaming'
          : 'loading'
        : 'ready',
    );
    if (!hostOwnsViewport(input.frameMode)) {
      overflowRef.current = false;
      setOverflowsInlineFlow(false);
      setContentHeight(input.bootstrapHeight);
    }

    const onWindowMessage = (event: MessageEvent): void => {
      const iframeWindow = latestRef.current.iframeRef.current?.contentWindow;
      dataHandlerRef.current(event.data, isTrustedArtifactFrameSource(event, iframeWindow));
    };
    window.addEventListener('message', onWindowMessage);

    let disposed = false;
    let unlistenNative: (() => void) | null = null;
    void subscribeNativeArtifactBridge(input.channelId, (payload) =>
      dataHandlerRef.current(payload, true),
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          unlistenNative = unlisten;
          requestMeasurement(false);
        }
      })
      .catch((error: unknown) => {
        console.warn('Unable to attach native Artifact bridge.', error);
      });

    return () => {
      disposed = true;
      window.removeEventListener('message', onWindowMessage);
      unlistenNative?.();
      clearReadyTimer();
    };
  }, [
    clearReadyTimer,
    input.channelId,
    input.documentKey,
    input.enabled,
    input.frameMode,
    input.measureHeight,
    requestMeasurement,
    updateStatus,
  ]);

  useLayoutEffect(() => {
    if (!input.enabled || input.presentation === 'canvas') return;
    if (!hostOwnsViewport(input.frameMode) && !overflowsInlineFlow) return;
    const updateViewport = (): void => {
      const current = latestRef.current;
      const nextHeight = resolveViewportFrameHeight(current);
      const grew = nextHeight > heightRef.current;
      heightRef.current = nextHeight;
      setHeight(nextHeight);
      if (grew) current.onContentGrew?.();
    };
    updateViewport();
    const pane = input.iframeRef.current?.closest('.conversation-pane-session');
    const observer =
      pane && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateViewport) : null;
    if (pane) observer?.observe(pane);
    window.addEventListener('resize', updateViewport);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, [input.enabled, input.frameMode, input.presentation, input.iframeRef, overflowsInlineFlow]);

  return { height, contentHeight, overflowsInlineFlow, status, onIframeLoad, retryMeasurement };
}
