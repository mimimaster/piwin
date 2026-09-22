import { ARTIFACT_BRIDGE_SIZE_TYPE } from './constants.js';
import { buildArtifactBridgeBootstrapScript } from './srcdoc-bridge.js';
import type { ArtifactFrameMode } from './types.js';

type MeasuredRoot = {
  height: number;
  scrollHeight?: number;
  getBoundingClientRect: () => { height: number };
};

type SizeMessage = {
  type: string;
  channelId: string;
  height: number;
  viewportHeight: number;
  revision: number;
  seq?: number;
};

export function createMeasuredRoot(height: number): MeasuredRoot {
  const root: MeasuredRoot = {
    height,
    getBoundingClientRect: () => ({ height: root.height }),
  };
  return root;
}

export function runBridgeSession(
  root: MeasuredRoot | null,
  options: {
    enableRenderCommand?: boolean;
    frameMode?: ArtifactFrameMode;
    nativeHandler?: boolean;
    nativeFailure?: 'webkit' | 'messageHandlers' | 'piwinArtifact' | 'postMessage';
    suspendAnimationFrames?: boolean;
    bodyHeight?: number;
    omitBody?: boolean;
    readyState?: string;
  } = {},
): {
  messages: SizeMessage[];
  /** Every parent post in order, for channels other than the size stream. */
  postedMessages: unknown[];
  nativeMessages: SizeMessage[];
  documentElement: { attributes: Record<string, string> };
  observerCount: () => number;
  contentObserverCount: () => number;
  mutate: () => void;
  listenerCount: () => number;
  scriptActivateCount: () => number;
  observeWithoutFlush: () => void;
  flushAnimationFrames: () => void;
  flushTimeouts: () => void;
  remeasure: () => void;
  dispatchRenderCommand: (data: unknown) => void;
  attachStreamRoot: (nextRoot: MeasuredRoot) => void;
  flushDocumentReady: () => void;
  /** Fire a non-`message` window event (`error`, `unhandledrejection`). */
  dispatchWindowEvent: (type: string, event: unknown) => void;
} {
  const messages: SizeMessage[] = [];
  /** Every parent post, not just the size stream. */
  const postedMessages: unknown[] = [];
  const nativeMessages: SizeMessage[] = [];
  const resizeCallbacks = new Set<() => void>();
  const mutationCallbacks = new Set<() => void>();
  const animationCallbacks: Array<() => void> = [];
  const timeoutCallbacks: Array<() => void> = [];
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const windowListeners = new Map<string, Array<(event: unknown) => void>>();
  const documentListeners = new Map<string, Array<() => void>>();
  const documentElement = {
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    },
  };
  const windowObject = {
    innerHeight: 80,
    setTimeout: (callback: () => void): number => {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    },
    dispatchEvent: () => undefined,
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type === 'message') {
        messageListeners.push(listener);
        return;
      }
      const existing = windowListeners.get(type) ?? [];
      existing.push(listener as (event: unknown) => void);
      windowListeners.set(type, existing);
    },
    removeEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type !== 'message') return;
      const index = messageListeners.indexOf(listener);
      if (index >= 0) messageListeners.splice(index, 1);
    },
    ResizeObserver: class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(): void {
        resizeCallbacks.add(this.callback);
      }
      disconnect(): void {
        resizeCallbacks.delete(this.callback);
      }
    },
    MutationObserver: class {
      constructor(private callback: () => void) {}
      observe(): void {
        mutationCallbacks.add(this.callback);
      }
      disconnect(): void {
        mutationCallbacks.delete(this.callback);
      }
    },
    webkit: undefined as
      | {
          messageHandlers: {
            piwinArtifact: { postMessage: (body: string) => void };
          };
        }
      | undefined,
  };
  if (options.nativeHandler === true) {
    windowObject.webkit = {
      messageHandlers: {
        piwinArtifact: {
          postMessage(body: string): void {
            const parsed: unknown = JSON.parse(body);
            if (isSizeMessage(parsed)) nativeMessages.push(parsed);
          },
        },
      },
    };
  }
  if (options.nativeFailure) {
    const failNative = (): never => { throw new Error('Native handler unavailable'); };
    const native = { postMessage: failNative };
    const handlers = { piwinArtifact: native };
    const webkit = { messageHandlers: handlers };
    windowObject.webkit = webkit;
    const property = options.nativeFailure;
    if (property !== 'postMessage') {
      const owner = property === 'webkit' ? windowObject
        : property === 'messageHandlers' ? webkit : handlers;
      Object.defineProperty(owner, property, { get: failNative });
    }
  }
  let scriptActivations = 0;
  function wrapStreamRoot(nextRoot: MeasuredRoot) {
    return {
      ...nextRoot,
      get scrollHeight() {
        return nextRoot.scrollHeight;
      },
      firstChild: null as unknown,
      querySelectorAll: (selector: string) =>
        selector === 'script'
          ? [{ attributes: [], textContent: '', replaceWith: () => undefined }]
          : [],
    };
  }
  let fragmentRoot = root === null ? null : wrapStreamRoot(root);
  const bodyNode = createMeasuredRoot(options.bodyHeight ?? (root === null ? 0 : root.height));
  const documentObject = {
    readyState: options.readyState ?? 'complete',
    documentElement,
    body: options.omitBody === true ? null : bodyNode,
    querySelector: (selector: string) =>
      selector === '.piwin-artifact-root' ? fragmentRoot : null,
    addEventListener: (type: string, listener: () => void) => {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    createElement: (tag: string) => {
      if (tag === 'template') {
        return { innerHTML: '', content: { firstChild: null } };
      }
      if (tag === 'script') {
        scriptActivations += 1;
      }
      return { attributes: [], textContent: '', setAttribute: () => undefined };
    },
    dispatchEvent: () => undefined,
  };
  const parentObject = {
    postMessage: (data: unknown): void => {
      postedMessages.push(data);
      if (isSizeMessage(data)) messages.push(data);
    },
  };
  const source = buildArtifactBridgeBootstrapScript(
    'test-channel',
    options.enableRenderCommand !== false,
    options.frameMode ?? 'inline-flow',
  );
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('bridge script missing');

  const execute = new Function(
    'window',
    'document',
    'parent',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'HTMLAnchorElement',
    script,
  ) as (
    windowValue: unknown,
    documentValue: unknown,
    parentValue: unknown,
    requestAnimationFrameValue: (callback: () => void) => number,
    cancelAnimationFrameValue: (handle: number) => void,
    htmlAnchorElementValue: unknown,
  ) => void;
  execute(
    windowObject,
    documentObject,
    parentObject,
    (callback) => {
      animationCallbacks.push(callback);
      return animationCallbacks.length;
    },
    (handle) => { animationCallbacks[handle - 1] = () => undefined; },
    {
      prototype: { click: () => undefined },
    },
  );

  const flushAnimationFrames = (): void => {
    if (options.suspendAnimationFrames) return;
    while (animationCallbacks.length > 0) animationCallbacks.shift()?.();
  };
  flushAnimationFrames();

  return {
    messages,
    postedMessages,
    nativeMessages,
    documentElement,
    observerCount: () => resizeCallbacks.size,
    contentObserverCount: () => mutationCallbacks.size,
    mutate: (): void => {
      for (const callback of mutationCallbacks) callback();
      flushAnimationFrames();
    },
    listenerCount: () => messageListeners.length,
    scriptActivateCount: () => scriptActivations,
    observeWithoutFlush: (): void => {
      for (const callback of [...resizeCallbacks]) callback();
    },
    flushAnimationFrames,
    flushTimeouts: (): void => {
      while (timeoutCallbacks.length > 0) timeoutCallbacks.shift()?.();
      flushAnimationFrames();
    },
    remeasure: (): void => {
      for (const callback of [...resizeCallbacks]) callback();
      flushAnimationFrames();
    },
    dispatchRenderCommand: (data: unknown): void => {
      for (const listener of [...messageListeners]) listener({ data });
      flushAnimationFrames();
    },
    dispatchWindowEvent: (type: string, event: unknown): void => {
      for (const listener of [...(windowListeners.get(type) ?? [])]) listener(event);
    },
    attachStreamRoot: (nextRoot: MeasuredRoot): void => {
      fragmentRoot = wrapStreamRoot(nextRoot);
      documentObject.body = nextRoot;
    },
    flushDocumentReady: (): void => {
      documentObject.readyState = 'complete';
      for (const listener of documentListeners.get('DOMContentLoaded') ?? []) {
        listener();
      }
      flushAnimationFrames();
    },
  };
}

function isSizeMessage(value: unknown): value is SizeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['type'] === ARTIFACT_BRIDGE_SIZE_TYPE &&
    typeof record['channelId'] === 'string' &&
    typeof record['height'] === 'number' &&
    typeof record['viewportHeight'] === 'number' &&
    typeof record['revision'] === 'number'
  );
}
