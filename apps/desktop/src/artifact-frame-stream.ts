import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  buildStableArtifactRevealFrames,
  parseArtifactRenderSnapshot,
  projectHtmlSourceForStreamRoot,
  type ArtifactDescriptor,
  type ArtifactFrameMode,
  type ArtifactRenderMode,
} from '@piwin/artifact';
import { isTauriRuntime } from './tauri-pty.js';

export type ArtifactSandboxView = {
  mode: ArtifactRenderMode;
  descriptor: ArtifactDescriptor;
  renderSource: string;
  srcdoc: string;
  frameMode: ArtifactFrameMode;
};

const ARTIFACT_STREAM_RENDER_THROTTLE_MS = 300;
const ARTIFACT_STABLE_REPLAY_INTERVAL_MS = 140;
const ARTIFACT_STABLE_REPLAY_MIN_BYTES = 4_096;
const ARTIFACT_STABLE_REPLAY_MAX_FRAMES = 8;

export type ArtifactDocumentPhase = 'empty-stream' | 'seeded-stream' | 'final';

export type ArtifactDocument = {
  documentKey: string;
  /** Store key for the Tauri piwin-artifact scheme. */
  documentId: string;
  /** Exactly what `documentUrl` loads (published over IPC under Tauri). */
  documentSource: string;
  documentUrl: string;
  streamLifecycle: boolean;
  streamSeeded: boolean;
};

export function initialArtifactDocumentPhase(
  mode: ArtifactRenderMode,
  renderSource: string,
): ArtifactDocumentPhase {
  if (mode !== 'stream-preview') {
    return 'final';
  }
  return renderSource.trim().length > 0 ? 'seeded-stream' : 'empty-stream';
}

export function advanceArtifactDocumentPhase(
  current: ArtifactDocumentPhase,
  mode: ArtifactRenderMode,
  renderSource: string,
): ArtifactDocumentPhase {
  if (mode === 'stream-preview') {
    if (current === 'final') {
      return initialArtifactDocumentPhase(mode, renderSource);
    }
    return renderSource.trim().length > 0 ? 'seeded-stream' : current;
  }
  return 'final';
}

export function artifactDocumentKey(
  phase: ArtifactDocumentPhase,
  id: string,
  srcdoc: string,
): string {
  if (phase === 'empty-stream') {
    return `stream:${id}`;
  }
  if (phase === 'seeded-stream') {
    return `stream:${id}:seeded`;
  }
  return `final:${id}:${srcdoc}`;
}

/**
 * Encode the CSP-protected Artifact document as an isolated iframe URL.
 * Browser/e2e keep this data: URL; packaged Tauri uses `buildArtifactDocumentUrl`.
 */
export function buildArtifactDocumentDataUrl(srcdoc: string): string {
  const bytes = new TextEncoder().encode(srcdoc);
  const chunks: string[] = [];
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return `data:text/html;charset=utf-8;base64,${btoa(chunks.join(''))}`;
}

export const ARTIFACT_DOCUMENT_SCHEME = 'piwin-artifact';
const ARTIFACT_DOCUMENT_PUT_COMMAND = 'artifact_document_put';

/** Unguessable store key; the Rust store accepts 16–64 `[A-Za-z0-9_-]` chars. */
export function createArtifactDocumentId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function convertArtifactDocumentSrc(documentId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        convertFileSrc?: (filePath: string, protocol?: string) => string;
      };
    }
  ).__TAURI_INTERNALS__;
  return typeof internals?.convertFileSrc === 'function'
    ? internals.convertFileSrc(documentId, ARTIFACT_DOCUMENT_SCHEME)
    : null;
}

/**
 * Tauri: load through the piwin-artifact scheme so the frame does not inherit
 * the app page CSP (Tauri appends script hashes, which disables 'unsafe-inline'
 * in inherited data: documents). The document itself is published over IPC —
 * wry rejects scheme URLs over 65 534 bytes, so it cannot ride in the URL.
 * Browser/e2e: data: URL.
 */
export function buildArtifactDocumentUrl(documentId: string, srcdoc: string): string {
  if (!isTauriRuntime()) {
    return buildArtifactDocumentDataUrl(srcdoc);
  }
  const converted = convertArtifactDocumentSrc(documentId);
  if (converted) {
    return converted;
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')) {
    return `http://${ARTIFACT_DOCUMENT_SCHEME}.localhost/${documentId}`;
  }
  return `${ARTIFACT_DOCUMENT_SCHEME}://localhost/${documentId}`;
}

export async function publishArtifactDocument(documentId: string, srcdoc: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(ARTIFACT_DOCUMENT_PUT_COMMAND, { id: documentId, html: srcdoc });
}

/**
 * Publishes the current document whenever a live iframe will request it:
 * each document swap and each re-host after recycling (the store is an LRU).
 * Runs in the commit that mounts the iframe; the scheme handler waits for it.
 */
export function usePublishedArtifactDocument(document: ArtifactDocument, hosted: boolean): void {
  const { documentId, documentSource } = document;
  useLayoutEffect(() => {
    if (!hosted || !isTauriRuntime()) {
      return;
    }
    publishArtifactDocument(documentId, documentSource).catch((error: unknown) => {
      console.warn('Unable to publish Artifact document.', error);
    });
  }, [documentId, documentSource, hosted]);
}

type ArtifactDocumentRecord = {
  key: string;
  documentId: string;
  documentSource: string;
  documentUrl: string;
};

function createArtifactDocumentRecord(key: string, srcdoc: string): ArtifactDocumentRecord {
  const documentId = createArtifactDocumentId();
  return {
    key,
    documentId,
    documentSource: srcdoc,
    documentUrl: buildArtifactDocumentUrl(documentId, srcdoc),
  };
}

/**
 * Empty stream shells stay mounted only until the first stable snapshot.
 * That snapshot is baked into a new document so the canvas is not an empty
 * iframe waiting on postMessage. Later tokens still reconcile in place.
 * Completion navigates to the final document — the same path history uses —
 * instead of freezing the stream shell and hoping a last snapshot lands.
 */
export function useArtifactDocument(decision: ArtifactSandboxView): ArtifactDocument {
  const phaseRef = useRef(
    initialArtifactDocumentPhase(decision.mode, decision.renderSource),
  );
  phaseRef.current = advanceArtifactDocumentPhase(
    phaseRef.current,
    decision.mode,
    decision.renderSource,
  );
  const phase = phaseRef.current;
  const streamLifecycle = phase !== 'final';
  const streamSeeded = phase === 'seeded-stream';
  const documentKey = artifactDocumentKey(
    phase,
    decision.descriptor.id,
    decision.srcdoc,
  );
  const documentRef = useRef<ArtifactDocumentRecord | null>(null);
  if (documentRef.current?.key !== documentKey) {
    documentRef.current = createArtifactDocumentRecord(documentKey, decision.srcdoc);
  }
  return {
    documentKey,
    documentId: documentRef.current.documentId,
    documentSource: documentRef.current.documentSource,
    documentUrl: documentRef.current.documentUrl,
    streamLifecycle,
    streamSeeded,
  };
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

/**
 * Push native stream DOM at most every 300ms. If a late stylesheet unlocks a
 * previously withheld large scene, replay a bounded set of closed structural
 * prefixes before committing the latest/final source. FrameMode stays urgent.
 */
export function useArtifactStreamPublisher(input: StreamPublisherInput): StreamPublisher {
  const latestRef = useRef(input);
  latestRef.current = input;
  const postedOnceRef = useRef(false);
  const lastPostAtRef = useRef(0);
  const lastFinalSourceRef = useRef<string | undefined>(undefined);
  const lastPostedSourceRef = useRef<string | undefined>(undefined);
  const lastPostedFrameModeRef = useRef<ArtifactFrameMode | undefined>(undefined);
  const pendingSourceRef = useRef<string | undefined>(undefined);
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayActiveRef = useRef(false);

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearReplayTimer = useCallback((): void => {
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    replayActiveRef.current = false;
  }, []);

  const postSnapshot = useCallback(
    (source: string, frameMode: ArtifactFrameMode, final: boolean): boolean => {
      const current = latestRef.current;
      // Stream shells are fragment roots. Flatten full HTML documents so
      // styles/body/scripts land under `.piwin-artifact-root` (including the
      // final interactive commit on a streamLifecycle iframe).
      const rootSource = projectHtmlSourceForStreamRoot(source);
      if (
        !current.enabled ||
        !postStreamSnapshot(
          current.iframeRef.current,
          current.channelId,
          revisionRef.current,
          rootSource,
          frameMode,
          final,
        )
      ) {
        return false;
      }
      revisionRef.current += 1;
      postedOnceRef.current = true;
      lastPostAtRef.current = Date.now();
      lastPostedSourceRef.current = source;
      lastPostedFrameModeRef.current = frameMode;
      if (final) {
        lastFinalSourceRef.current = source;
      }
      return true;
    },
    [],
  );

  const startStableReplay = useCallback(
    (frames: readonly string[]): void => {
      clearReplayTimer();
      replayActiveRef.current = true;
      let frameIndex = 0;

      const postNextFrame = (): void => {
        const current = latestRef.current;
        if (!current.enabled) {
          clearReplayTimer();
          return;
        }
        const frame = frames[frameIndex];
        if (frame !== undefined && postSnapshot(frame, current.frameMode, false)) {
          frameIndex += 1;
        }
        if (frameIndex < frames.length) {
          replayTimerRef.current = setTimeout(postNextFrame, ARTIFACT_STABLE_REPLAY_INTERVAL_MS);
          return;
        }

        replayTimerRef.current = null;
        replayActiveRef.current = false;
        const latest = latestRef.current;
        const latestSource = latest.decision.renderSource;
        const latestFinal = latest.decision.mode !== 'stream-preview';
        if (latestSource !== lastPostedSourceRef.current || latestFinal) {
          postSnapshot(latestSource, latest.frameMode, latestFinal);
        }
      };

      postNextFrame();
    },
    [clearReplayTimer, postSnapshot],
  );

  const postCurrent = useCallback(
    (force = false): void => {
      const current = latestRef.current;
      if (!current.enabled) {
        return;
      }
      const final = current.decision.mode !== 'stream-preview';
      const source = current.decision.renderSource;
      const frameMode = current.frameMode;
      const frameModeChanged = lastPostedFrameModeRef.current !== frameMode;
      if (replayActiveRef.current) {
        return;
      }
      if (!current.streamLifecycle) {
        if (!frameModeChanged) {
          return;
        }
      } else if (
        !force &&
        lastPostedSourceRef.current === source &&
        !frameModeChanged &&
        (!final || lastFinalSourceRef.current === source)
      ) {
        return;
      }

      if (
        !final &&
        lastPostedSourceRef.current === '' &&
        source.length >= ARTIFACT_STABLE_REPLAY_MIN_BYTES
      ) {
        const frames = buildStableArtifactRevealFrames(source, ARTIFACT_STABLE_REPLAY_MAX_FRAMES);
        if (frames.length > 1) {
          startStableReplay(frames);
          return;
        }
      }
      postSnapshot(source, frameMode, final);
    },
    [postSnapshot, startStableReplay],
  );

  useLayoutEffect(() => {
    if (!input.enabled) {
      return;
    }
    const frameModeChanged = lastPostedFrameModeRef.current !== input.frameMode;
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
    if (frameModeChanged) {
      clearTimer();
      pendingSourceRef.current = undefined;
      postCurrent();
      return;
    }
    if (lastPostedSourceRef.current === '' && input.decision.renderSource.length > 0) {
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

  useEffect(
    () => () => {
      clearTimer();
      clearReplayTimer();
    },
    [clearReplayTimer, clearTimer],
  );

  const onIframeLoad = useCallback((): void => {
    clearTimer();
    pendingSourceRef.current = undefined;
    postCurrent(true);
  }, [clearTimer, postCurrent]);

  return { onIframeLoad };
}
