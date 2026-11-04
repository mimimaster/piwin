/** Pure browser mirror state and Host push reduction, separate from lease I/O. */
import type {
  BrowserController,
  BrowserDialogInfo,
  BrowserLifecycle,
  BrowserMirrorMode,
  BrowserTabInfo,
  BrowserViewportConfig,
  HostServerMessage,
} from '@piwin/contracts';
import {
  capConsoleLines,
  capNetworkLines,
  type BrowserConsoleLine,
  type BrowserNetworkLine,
} from './browser-console-drawer';
import type { BrowserFrameErrorReason, BrowserFrameView } from './browser-frame-decoder';

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
  return next.pageId !== undefined && state.pageId !== undefined && next.pageId !== state.pageId;
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

type BrowserSessionLeaseAction =
  | { type: 'reset' }
  | { type: 'host-push'; message: HostServerMessage }
  | { type: 'url-input'; urlInput: string }
  | { type: 'highlight'; highlight: BrowserHighlightBox | null }
  | { type: 'pick-pending'; pickPending: boolean }
  | { type: 'pick-error'; pickError: string | null }
  | { type: 'frame-ready'; view: BrowserFrameView }
  | { type: 'frame-error'; reason: BrowserFrameErrorReason };

export function reduceBrowserSessionLease(
  state: BrowserSessionLeaseState,
  action: BrowserSessionLeaseAction,
): BrowserSessionLeaseState {
  switch (action.type) {
    case 'reset':
      return EMPTY_BROWSER_SESSION_LEASE;
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
