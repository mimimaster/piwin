/**
 * Desktop mirror lease + HostPush subscription for the browser workbench.
 * Pointer, IME, and CSS mapping stay in BrowserSessionPanel.
 */
import { useCallback, useEffect, useReducer, useState } from 'react';
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

export type BrowserSessionFrame = {
  src: string;
  viewportWidth: number;
  viewportHeight: number;
};

export type BrowserHighlightBox = { x: number; y: number; width: number; height: number };

export type BrowserSessionLeaseState = {
  frame: BrowserSessionFrame;
  urlInput: string;
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
};

export type BrowserSessionLeaseClient = {
  subscribe: (listener: (message: HostServerMessage) => void) => () => void;
  browserStart: (leaseId: string) => Promise<{ success: boolean }>;
  browserStop: (leaseId: string) => Promise<{ success: boolean }>;
};

export type BrowserSessionLease = {
  frame: BrowserSessionFrame;
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
};

export const EMPTY_BROWSER_SESSION_LEASE: BrowserSessionLeaseState = {
  frame: { src: '', viewportWidth: 0, viewportHeight: 0 },
  urlInput: '',
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
    return {
      ...state,
      frame: {
        src: message.dataUrl,
        viewportWidth: message.width,
        viewportHeight: message.height,
      },
    };
  }
  if (message.type === 'browser/state') {
    const generation = message.generation ?? state.generation;
    const pageId = message.pageId ?? state.pageId;
    const identityChanged = browserTargetIdentityChanged(state, { generation, pageId });
    return {
      ...state,
      urlInput: message.url ?? '',
      title: message.title ?? '',
      lifecycle: message.lifecycle ?? state.lifecycle,
      mirror: message.mirror ?? state.mirror,
      generation,
      pageId,
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
}): () => void {
  let cancelled = false;
  const mirrorLeaseId = crypto.randomUUID();
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
  | { type: 'pick-error'; pickError: string | null };

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

  useEffect(() => {
    return startBrowserSessionLease({
      host: hostClient,
      onMessage: (message) => {
        dispatch({ type: 'host-push', message });
        if (message.type === 'browser/picked') {
          onAddWebElement(message.result);
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
  }, [hostClient, onAddWebElement]);

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
  };
}
