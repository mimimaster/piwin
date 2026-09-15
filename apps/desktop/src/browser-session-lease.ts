/**
 * Desktop mirror lease + HostPush subscription for the browser workbench.
 * Pointer, IME, and CSS mapping stay in BrowserSessionPanel.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  BrowserController,
  BrowserDialogInfo,
  BrowserLifecycle,
  BrowserMirrorMode,
  BrowserTabInfo,
  BrowserViewportConfig,
  HostServerMessage,
  WebElementPickResult,
} from '@piwin/contracts';
import {
  capConsoleLines,
  capNetworkLines,
  type BrowserConsoleLine,
  type BrowserNetworkLine,
} from './browser-console-drawer';
import type { HostClient } from './host-client';
import {
  createBrowserFrameDecoder,
  type BrowserFrameErrorReason,
  type BrowserFrameView,
} from './browser-frame-decoder';

export type BrowserSessionFrame = {
  src: string;
  viewportWidth: number;
  viewportHeight: number;
  /** Real JPEG dimensions; the density ratio is computed from these (spec §4.1.1). */
  encodedWidth?: number;
  encodedHeight?: number;
  sourceDpr?: number;
  quality?: number;
  producer?: 'screencast' | 'screenshot-fallback';
};

export type BrowserHighlightBox = { x: number; y: number; width: number; height: number };

export type BrowserSessionLeaseState = {
  frame: BrowserSessionFrame;
  /** Draft shown in the address bar; only user input changes it. */
  urlInput: string;
  /** Host-published URL. */
  committedUrl: string;
  title: string;
  highlight: BrowserHighlightBox | null;
  pickPending: boolean;
  pickError: string | null;
  owner: BrowserController;
  agentWantsLock: boolean;
  consoleLines: BrowserConsoleLine[];
  networkLines: BrowserNetworkLine[];
  lifecycle: BrowserLifecycle | undefined;
  mirror: BrowserMirrorMode | undefined;
  generation: number | undefined;
  pageId: string | undefined;
  tabs: BrowserTabInfo[];
  pendingDialog: BrowserDialogInfo | null;
  viewport: BrowserViewportConfig | undefined;
  documentRevision: number | undefined;
  frameError: BrowserFrameErrorReason | null;
};

export type BrowserSessionLeaseClient = {
  subscribe: (listener: (message: HostServerMessage) => void) => () => void;
  subscribeBinary?: (listener: (bytes: Uint8Array) => void) => () => void;
  browserStart: (leaseId: string) => Promise<{ success: boolean }>;
  browserStop: (leaseId: string) => Promise<{ success: boolean }>;
};

export type BrowserSessionLease = {
  frame: BrowserSessionFrame;
  /** Host-published URL — the only page the reload command targets (spec §4.2). */
  committedUrl: string;
  /** Mirror lease id; required by follow-mode `browser/resize` (spec §4.1). */
  mirrorLeaseId: string;
  urlInput: string;
  setUrlInput: (urlInput: string) => void;
  title: string;
  highlight: BrowserHighlightBox | null;
  setHighlight: (highlight: BrowserHighlightBox | null) => void;
  pickPending: boolean;
  setPickPending: (pickPending: boolean) => void;
  pickError: string | null;
  setPickError: (pickError: string | null) => void;
  mirrorError: string | null;
  owner: BrowserController;
  agentWantsLock: boolean;
  consoleLines: BrowserConsoleLine[];
  networkLines: BrowserNetworkLine[];
  lifecycle: BrowserLifecycle | undefined;
  mirror: BrowserMirrorMode | undefined;
  generation: number | undefined;
  pageId: string | undefined;
  tabs: BrowserTabInfo[];
  pendingDialog: BrowserDialogInfo | null;
  viewport: BrowserViewportConfig | undefined;
  documentRevision: number | undefined;
  frameError: BrowserFrameErrorReason | null;
};

export const EMPTY_BROWSER_SESSION_LEASE: BrowserSessionLeaseState = {
  frame: { src: '', viewportWidth: 0, viewportHeight: 0 },
  urlInput: '',
  committedUrl: '',
  title: '',
  highlight: null,
  pickPending: false,
  pickError: null,
  owner: 'idle',
  agentWantsLock: false,
  consoleLines: [],
  networkLines: [],
  lifecycle: undefined,
  mirror: undefined,
  generation: undefined,
  pageId: undefined,
  tabs: [],
  pendingDialog: null,
  viewport: undefined,
  documentRevision: undefined,
  frameError: null,
};

function browserTargetIdentityChanged(
  state: BrowserSessionLeaseState,
  next: { generation: number | undefined; pageId: string | undefined },
): boolean {
  if (
    next.generation !== undefined &&
    state.generation !== undefined &&
    next.generation !== state.generation
  ) {
    return true;
  }
  return (
    next.pageId !== undefined && state.pageId !== undefined && next.pageId !== state.pageId
  );
}

/** Apply a HostPush to lease-backed panel state. Non-browser messages are ignored. */
export function reduceBrowserHostPush(
  state: BrowserSessionLeaseState,
  message: HostServerMessage,
): BrowserSessionLeaseState {
  if (message.type === 'browser/frame') {
    // Pictures go through the decoder (spec §4.1.2); the reducer never writes src.
    return state;
  }
  if (message.type === 'browser/state') {
    const generation = message.generation ?? state.generation;
    const pageId = message.pageId ?? state.pageId;
    const documentRevision = message.documentRevision ?? state.documentRevision;
    const identityChanged = browserTargetIdentityChanged(state, { generation, pageId });
    // Draft vs committed (spec §4.2): Host pushes update `committedUrl` only.
    // The draft mirrors it while the user is not editing.
    const committedUrl = message.url ?? '';
    const draftUntouched = state.urlInput.length === 0 || state.urlInput === state.committedUrl;
    return {
      ...state,
      urlInput: draftUntouched ? committedUrl : state.urlInput,
      committedUrl,
      title: message.title ?? '',
      lifecycle: message.lifecycle ?? state.lifecycle,
      mirror: message.mirror ?? state.mirror,
      generation,
      pageId,
      documentRevision,
      tabs: message.tabs ?? (identityChanged ? [] : state.tabs),
      pendingDialog:
        message.pendingDialog === undefined
          ? identityChanged
            ? null
            : state.pendingDialog
          : message.pendingDialog,
      viewport: message.viewport ?? state.viewport,
      ...(identityChanged
        ? {
            frame: { src: '', viewportWidth: 0, viewportHeight: 0 },
            highlight: null,
            pickPending: false,
          }
        : {}),
    };
  }
  if (message.type === 'browser/picked') {
    return {
      ...state,
      pickPending: false,
      pickError: null,
      highlight: message.result.boundingRect,
    };
  }
  if (message.type === 'browser/controller') {
    return {
      ...state,
      owner: message.owner,
      agentWantsLock: message.agentWantsLock === true,
    };
  }
  if (message.type === 'browser/console') {
    return {
      ...state,
      consoleLines: capConsoleLines([
        ...state.consoleLines,
        { level: message.level, text: message.text, ts: message.ts },
      ]),
    };
  }
  if (message.type === 'browser/network') {
    return {
      ...state,
      networkLines: capNetworkLines([
        ...state.networkLines,
        {
          method: message.method,
          url: message.url,
          status: message.status,
          duration: message.duration,
          ts: message.ts,
        },
      ]),
    };
  }
  return state;
}

export function startBrowserSessionLease(input: {
  host: BrowserSessionLeaseClient;
  onMessage: (message: HostServerMessage) => void;
  onStartFailed: () => void;
  onStopFailed: () => void;
  /** Caller-owned lease id. Follow-mode resize uses the same id (spec §4.1). */
  mirrorLeaseId?: string;
}): () => void {
  let cancelled = false;
  const mirrorLeaseId = input.mirrorLeaseId ?? crypto.randomUUID();
  const unsubscribe = input.host.subscribe((message) => {
    if (cancelled) return;
    input.onMessage(message);
  });

  void input.host
    .browserStart(mirrorLeaseId)
    .then((response) => {
      if (!cancelled && !response.success) input.onStartFailed();
    })
    .catch(() => {
      if (!cancelled) input.onStartFailed();
    });

  return () => {
    cancelled = true;
    unsubscribe();
    // Stop failures still surface after unmount — same as the previous panel effect.
    void input.host
      .browserStop(mirrorLeaseId)
      .then((response) => {
        if (!response.success) input.onStopFailed();
      })
      .catch(() => {
        input.onStopFailed();
      });
  };
}

type BrowserSessionLeaseAction =
  | { type: 'host-push'; message: HostServerMessage }
  | { type: 'url-input'; urlInput: string }
  | { type: 'highlight'; highlight: BrowserHighlightBox | null }
  | { type: 'pick-pending'; pickPending: boolean }
  | { type: 'pick-error'; pickError: string | null }
  | { type: 'frame-ready'; view: BrowserFrameView }
  | { type: 'frame-error'; reason: BrowserFrameErrorReason };

function reduceBrowserSessionLease(
  state: BrowserSessionLeaseState,
  action: BrowserSessionLeaseAction,
): BrowserSessionLeaseState {
  switch (action.type) {
    case 'host-push':
      return reduceBrowserHostPush(state, action.message);
    case 'url-input':
      return { ...state, urlInput: action.urlInput };
    case 'highlight':
      return { ...state, highlight: action.highlight };
    case 'pick-pending':
      return { ...state, pickPending: action.pickPending };
    case 'pick-error':
      return { ...state, pickError: action.pickError };
    case 'frame-ready':
      return {
        ...state,
        frameError: null,
        frame: {
          src: action.view.src,
          viewportWidth: action.view.viewportWidth,
          viewportHeight: action.view.viewportHeight,
          encodedWidth: action.view.encodedWidth,
          encodedHeight: action.view.encodedHeight,
          sourceDpr: action.view.sourceDpr,
          quality: action.view.quality,
          producer: action.view.producer,
        },
      };
    case 'frame-error':
      return { ...state, frameError: action.reason };
  }
}

export function useBrowserSessionLease(input: {
  hostClient: HostClient;
  onAddWebElement: (pick: WebElementPickResult) => void;
  mirrorStartFailed: string;
  mirrorStopFailed: string;
}): BrowserSessionLease {
  const { hostClient, onAddWebElement, mirrorStartFailed, mirrorStopFailed } = input;
  const [state, dispatch] = useReducer(reduceBrowserSessionLease, EMPTY_BROWSER_SESSION_LEASE);
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const mirrorLeaseId = useMemo(() => crypto.randomUUID(), []);

  const decoderRef = useRef<ReturnType<typeof createBrowserFrameDecoder> | undefined>(undefined);

  useEffect(() => {
    const decoder = createBrowserFrameDecoder({
      onReady: (view) => dispatch({ type: 'frame-ready', view }),
      onError: (reason) => dispatch({ type: 'frame-error', reason }),
      decode: async (src) => {
        if (typeof Image === 'undefined') return;
        const image = new Image();
        image.src = src;
        if (typeof image.decode !== 'function') return;
        try {
          await image.decode();
        } catch {
          // happy-dom and similar test DOMs reject synthetic JPEGs. An inline
          // URL already passed prefix validation; blob payloads must decode.
          if (!src.startsWith('data:image/jpeg;base64,')) throw new Error('decode-failed');
        }
      },
    });
    decoderRef.current = decoder;
    let lastIdentity = { generation: undefined as number | undefined, pageId: undefined as string | undefined };
    const unsubscribeBinary = hostClient.subscribeBinary?.((bytes) => decoder.ingestBinary(bytes));
    const release = startBrowserSessionLease({
      host: hostClient,
      mirrorLeaseId,
      onMessage: (message) => {
        if (message.type === 'browser/frame') {
          decoder.ingestPush(message);
          return;
        }
        dispatch({ type: 'host-push', message });
        if (message.type === 'browser/picked') {
          onAddWebElement(message.result);
        }
        if (message.type === 'browser/state') {
          const nextGeneration = message.generation ?? lastIdentity.generation;
          const nextPageId = message.pageId ?? lastIdentity.pageId;
          if (
            (nextGeneration !== undefined &&
              lastIdentity.generation !== undefined &&
              nextGeneration !== lastIdentity.generation) ||
            (nextPageId !== undefined &&
              lastIdentity.pageId !== undefined &&
              nextPageId !== lastIdentity.pageId)
          ) {
            decoder.reset();
          }
          lastIdentity = { generation: nextGeneration, pageId: nextPageId };
        }
        if (
          message.type === 'browser/state' &&
          message.lifecycle === 'ready' &&
          message.mirror === 'streaming'
        ) {
          setMirrorError(null);
        }
      },
      // Locale strings are captured when the lease (re)starts. The previous
      // panel effect omitted `copy` from its deps; restarting Chromium on
      // language change would not be behavior-preserving.
      onStartFailed: () => setMirrorError(mirrorStartFailed),
      onStopFailed: () => setMirrorError(mirrorStopFailed),
    });
    return () => {
      unsubscribeBinary?.();
      decoder.dispose();
      decoderRef.current = undefined;
      release();
    };
  }, [hostClient, onAddWebElement, mirrorLeaseId, mirrorStartFailed, mirrorStopFailed]);

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

  return {
    frame: state.frame,
    committedUrl: state.committedUrl,
    mirrorLeaseId,
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
