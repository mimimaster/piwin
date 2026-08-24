import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  parseArtifactRenderSnapshot,
  type ArtifactDescriptor,
  type ArtifactFrameMode,
  type ArtifactRenderMode,
} from '@piwin/artifact';

export type ArtifactSandboxView = {
  mode: ArtifactRenderMode;
  descriptor: ArtifactDescriptor;
  renderSource: string;
  srcdoc: string;
  frameMode: ArtifactFrameMode;
};

const ARTIFACT_STREAM_RENDER_THROTTLE_MS = 300;

export type ArtifactDocument = {
  documentKey: string;
  documentUrl: string;
  streamLifecycle: boolean;
};

/** Encode the CSP-protected Artifact document as an isolated iframe URL. */
export function buildArtifactDocumentDataUrl(srcdoc: string): string {
  const bytes = new TextEncoder().encode(srcdoc);
  const chunks: string[] = [];
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:text/html;charset=utf-8;base64,${btoa(chunks.join(''))}`;
}

/**
 * A stream keeps its first iframe document through completion. Direct final
 * renders get their own immutable document URL.
 */
export function useArtifactDocument(decision: ArtifactSandboxView): ArtifactDocument {
  const streamLifecycleRef = useRef(decision.mode === 'stream-preview');
  if (decision.mode === 'stream-preview') {
    streamLifecycleRef.current = true;
  }
  const streamLifecycle = streamLifecycleRef.current;
  const documentKey = streamLifecycle
    ? `stream:${decision.descriptor.id}`
    : `final:${decision.descriptor.id}:${decision.srcdoc}`;
  const documentRef = useRef({
    key: documentKey,
    documentUrl: buildArtifactDocumentDataUrl(decision.srcdoc),
  });
  if (documentRef.current.key !== documentKey) {
    documentRef.current = {
      key: documentKey,
      documentUrl: buildArtifactDocumentDataUrl(decision.srcdoc),
    };
  }
  return { documentKey, documentUrl: documentRef.current.documentUrl, streamLifecycle };
}

type StreamPublisherInput = {
  channelId: string;
  decision: ArtifactSandboxView;
  frameMode: ArtifactFrameMode;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  enabled: boolean;
  streamLifecycle: boolean;
};

type StreamPublisher = {
  onIframeLoad: () => void;
};

function postStreamSnapshot(
  iframe: HTMLIFrameElement | null,
  channelId: string,
  revision: number,
  source: string,
  frameMode: ArtifactFrameMode,
  final: boolean,
): boolean {
  const target = iframe?.contentWindow;
  if (!target) {
    return false;
  }
  const snapshot = parseArtifactRenderSnapshot({
    type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
    channelId,
    revision,
    source,
    frameMode,
    final,
  });
  if (!snapshot) {
    return false;
  }
  target.postMessage(snapshot, '*');
  return true;
}

/** Push stream DOM at most every 300ms; final source commits immediately. FrameMode stays live. */
export function useArtifactStreamPublisher(input: StreamPublisherInput): StreamPublisher {
  const latestRef = useRef(input);
  latestRef.current = input;
  const postedOnceRef = useRef(false);
  const lastPostAtRef = useRef(0);
  const lastFinalSourceRef = useRef<string | undefined>(undefined);
  const lastPostedFrameModeRef = useRef<ArtifactFrameMode | undefined>(undefined);
  const pendingSourceRef = useRef<string | undefined>(undefined);
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const postCurrent = useCallback((force = false): void => {
    const current = latestRef.current;
    if (!current.enabled) {
      return;
    }
    const final = current.decision.mode !== 'stream-preview';
    const source = current.decision.renderSource;
    const frameMode = current.frameMode;
    const frameModeChanged = lastPostedFrameModeRef.current !== frameMode;
    if (!current.streamLifecycle) {
      if (!frameModeChanged) {
        return;
      }
    } else if (!force && final && lastFinalSourceRef.current === source && !frameModeChanged) {
      return;
    }
    if (
      postStreamSnapshot(
        current.iframeRef.current,
        current.channelId,
        revisionRef.current,
        source,
        frameMode,
        final,
      )
    ) {
      revisionRef.current += 1;
      postedOnceRef.current = true;
      lastPostAtRef.current = Date.now();
      lastPostedFrameModeRef.current = frameMode;
      if (final) {
        lastFinalSourceRef.current = source;
      }
    }
  }, []);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }
    if (!input.streamLifecycle) {
      postCurrent();
      return;
    }
    if (input.decision.mode !== 'stream-preview') {
      clearTimer();
      pendingSourceRef.current = undefined;
      postCurrent();
      return;
    }

    const elapsed = Date.now() - lastPostAtRef.current;
    if (!postedOnceRef.current || elapsed >= ARTIFACT_STREAM_RENDER_THROTTLE_MS) {
      clearTimer();
      pendingSourceRef.current = undefined;
      postCurrent();
      return;
    }

    pendingSourceRef.current = input.decision.renderSource;
    if (timerRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (pendingSourceRef.current !== undefined) {
        pendingSourceRef.current = undefined;
        postCurrent();
      }
    }, ARTIFACT_STREAM_RENDER_THROTTLE_MS - elapsed);
  }, [
    clearTimer,
    input.decision.mode,
    input.decision.renderSource,
    input.enabled,
    input.frameMode,
    input.streamLifecycle,
    postCurrent,
  ]);

  useEffect(() => clearTimer, [clearTimer]);

  const onIframeLoad = useCallback((): void => {
    clearTimer();
    pendingSourceRef.current = undefined;
    postCurrent(true);
  }, [clearTimer, postCurrent]);

  return { onIframeLoad };
}
