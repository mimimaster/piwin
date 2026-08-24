import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_FALLBACK_HEIGHT,
  ARTIFACT_READY_TIMEOUT_MS,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  clampArtifactHeight,
  parseArtifactActionMessage,
  parseArtifactBridgeMessage,
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

function resolveStageHeight(input: BridgeInput): number {
  if (input.presentation === 'canvas') {
    return input.bootstrapHeight;
  }
  if (hostOwnsViewport(input.frameMode)) {
    const viewportHeight = typeof window === 'undefined' ? 640 : window.innerHeight;
    return resolveArtifactViewportFrameHeight(viewportHeight);
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
  const lastRevisionRef = useRef(-1);
  const dataHandlerRef = useRef<(data: unknown, trustedSource: boolean) => void>(() => undefined);

  const clearReadyTimer = useCallback((): void => {
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  }, []);

  const startReadyTimer = useCallback((): void => {
    clearReadyTimer();
    const current = latestRef.current;
    if (!current.measureHeight || current.decision.mode === 'stream-preview') {
      return;
    }
    readyTimerRef.current = setTimeout(() => {
      readyTimerRef.current = null;
      const fallbackHeight = clampArtifactHeight(
        ARTIFACT_FALLBACK_HEIGHT,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
        ARTIFACT_BOOTSTRAP_HEIGHT,
      );
      heightRef.current = fallbackHeight;
      setHeight(fallbackHeight);
      setStatus('fallback');
      console.warn(
        'Artifact height bridge timed out; keeping the preview in a bounded fallback viewport.',
        {
          channelId: current.channelId,
          fallbackHeight,
        },
      );
    }, ARTIFACT_READY_TIMEOUT_MS);
  }, [clearReadyTimer]);

  dataHandlerRef.current = (data, trustedSource): void => {
    const current = latestRef.current;
    const action = parseArtifactActionMessage(data);
    if (action) {
      if (!trustedSource || action.channelId !== current.channelId) {
        return;
      }
      if (
        current.onArtifactAction &&
        (action.action === 'flashcard/rate' || action.action === 'flashcard/open-source') &&
        current.decision.descriptor.source.includes(`data-card-id="${action.payload.cardId}"`)
      ) {
        current.onArtifactAction(action);
      } else if (
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
    lastRevisionRef.current = message.revision;
    const rawHeight = message.height;
    setContentHeight(rawHeight);
    clearReadyTimer();
    if (shouldEnterArtifactInlineOverflow(rawHeight)) {
      const viewportHeight = typeof window === 'undefined' ? 640 : window.innerHeight;
      const chromeHeight = resolveArtifactViewportFrameHeight(viewportHeight);
      const grew = chromeHeight > heightRef.current;
      heightRef.current = chromeHeight;
      setOverflowsInlineFlow(true);
      setHeight(chromeHeight);
      setStatus(current.decision.mode === 'stream-preview' ? 'streaming' : 'ready');
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
    setStatus(current.decision.mode === 'stream-preview' ? 'streaming' : 'ready');
    if (grew) current.onContentGrew?.();
  };

  const onIframeLoad = useCallback((): void => {
    startReadyTimer();
  }, [startReadyTimer]);

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }
    const nextHeight = resolveStageHeight(input);
    heightRef.current = nextHeight;
    lastRevisionRef.current = -1;
    setHeight(nextHeight);
    setStatus(initialStatus);
    if (!hostOwnsViewport(input.frameMode)) {
      setOverflowsInlineFlow(false);
      setContentHeight(input.bootstrapHeight);
    }

    const onWindowMessage = (event: MessageEvent): void => {
      const iframeWindow = latestRef.current.iframeRef.current?.contentWindow;
      const trustedSource =
        iframeWindow !== null && iframeWindow !== undefined && event.source === iframeWindow;
      dataHandlerRef.current(event.data, trustedSource);
    };
    window.addEventListener('message', onWindowMessage);

    let disposed = false;
    let unlistenNative: (() => void) | null = null;
    void subscribeNativeArtifactBridge((payload) => dataHandlerRef.current(payload, true))
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenNative = unlisten;
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
  }, [clearReadyTimer, input.documentKey, input.enabled, input.frameMode]);

  return { height, contentHeight, overflowsInlineFlow, status, onIframeLoad };
}
