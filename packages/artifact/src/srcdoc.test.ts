import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_VIEWPORT_FILL_HEIGHT,
} from './constants.js';
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import {
  buildArtifactBridgeBootstrapScript,
  buildHtmlArtifactSrcdoc,
  buildStrictArtifactCsp,
} from './srcdoc.js';

describe('buildStrictArtifactCsp', () => {
  it('blocks network and limits frame-src to allowlist origins', () => {
    const csp = buildStrictArtifactCsp(createDefaultArtifactIframePolicy('allowlist'));
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('img-src data: blob:');
    expect(csp).toContain('frame-src https://www.youtube.com');
    expect(csp).toContain("object-src 'none'");
  });

  it('uses frame-src none when external frames are disabled', () => {
    const csp = buildStrictArtifactCsp(createDefaultArtifactIframePolicy('disabled'));
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain('frame-src https:');
  });
});

describe('buildHtmlArtifactSrcdoc', () => {
  it('embeds source, CSP meta, and height bridge', () => {
    const raw = '<button>Click</button>';
    const { srcdoc, csp } = buildHtmlArtifactSrcdoc({
      source: raw,
      channelId: 'ch-1',
    });
    expect(srcdoc).toContain(raw);
    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain('piwin-artifact-root');
    expect(srcdoc).toContain(ARTIFACT_BRIDGE_READY_TYPE);
    expect(srcdoc).toContain('ch-1');
    expect(srcdoc).toContain('data-piwin-artifact-bridge-bootstrap');
    expect(csp).toContain("default-src 'none'");
  });

  it('reports one deduplicated ResizeObserver height stream over native and browser transports', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>completed</div>',
      channelId: 'ch-completed',
    });
    expect(srcdoc).toContain('window.webkit.messageHandlers.piwinArtifact');
    expect(srcdoc).toContain('nativeHandler.postMessage(JSON.stringify(message))');
    expect(srcdoc).toContain('post(actionType, { action: action, payload: payload || {} })');
    expect(srcdoc).toContain("parent.postMessage(message, '*')");
    expect(srcdoc).toContain('window.ResizeObserver');
    expect(srcdoc).toContain('observer.observe(root)');
    expect(srcdoc).toContain("window.addEventListener('resize', scheduleHeight)");
    expect(srcdoc).toContain('height === lastReportedHeight');
    expect(srcdoc).toContain("root.querySelector('canvas, video')");
    expect(srcdoc).toContain('fillsViewport(scene, viewport)');
    expect(srcdoc).not.toContain('MutationObserver');
    expect(srcdoc).not.toContain('scheduleMeasureLadder');
    expect(srcdoc).not.toContain("addEventListener('click'");
  });

  it('updates DOM only during streaming and removes the stream listener at final', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>streaming</div>',
      channelId: 'ch-stream',
      enableStreamUpdates: true,
    });
    expect(srcdoc).toContain(ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE);
    expect(srcdoc).toContain('syncChildren(root, template.content)');
    expect(srcdoc).toContain("window.removeEventListener('message', onStreamUpdate)");
    expect(srcdoc).toContain('scheduleHeight();');
    expect(srcdoc).toContain('interactive scripts may change normal-flow size later');
    expect(srcdoc).not.toContain('MutationObserver');
    const script = srcdoc.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(() => new Function(script ?? '')).not.toThrow();
  });

  it('centers fixed-width native SVG fences within the responsive artifact measure', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<svg width="500" height="400" viewBox="0 0 500 400"></svg>',
      channelId: 'svg-centered',
    });

    expect(srcdoc).toContain('.piwin-artifact-root > svg');
    expect(srcdoc).toContain('width: auto;');
    expect(srcdoc).toContain('margin-inline: auto;');
    expect(srcdoc).toContain('align-items: center;');
    expect(srcdoc).toContain('.piwin-artifact-root > :not(svg)');
  });

  it('keeps the document canvas transparent and appends the theme guard after model content', () => {
    const modelSource = '<style>html,body{background:#fff}</style><main>card</main>';
    const dark = buildHtmlArtifactSrcdoc({
      source: modelSource,
      channelId: 'dark-bg',
      theme: {
        '--piwin-artifact-theme': 'dark',
        '--piwin-artifact-bg': 'transparent',
        '--piwin-artifact-surface': '#222',
        '--piwin-artifact-text': '#fff',
        '--piwin-artifact-muted': '#aaa',
        '--piwin-artifact-accent': '#6ea8fe',
        '--piwin-artifact-border': '#333',
        '--piwin-artifact-radius': '8px',
        '--piwin-artifact-font': 'sans-serif',
      },
    });
    expect(dark.srcdoc).toContain('--piwin-artifact-bg: transparent');
    expect(dark.srcdoc).toContain('data-piwin-artifact-theme-guard');
    expect(dark.srcdoc).toContain('background: transparent !important');
    expect(dark.srcdoc).toContain('.owi-artifact-root');
    expect(dark.srcdoc).toContain('[class*="bg-[rgba(255" i]');
    expect(dark.srcdoc.indexOf('data-piwin-artifact-theme-guard')).toBeGreaterThan(
      dark.srcdoc.indexOf(modelSource),
    );
    expect(dark.srcdoc).not.toContain('background:#141416');

    const light = buildHtmlArtifactSrcdoc({
      source: '<div>card</div>',
      channelId: 'light-bg',
      theme: {
        '--piwin-artifact-theme': 'light',
        '--piwin-artifact-bg': 'transparent',
        '--piwin-artifact-surface': '#fff',
        '--piwin-artifact-text': '#111',
        '--piwin-artifact-muted': '#666',
        '--piwin-artifact-accent': '#2563eb',
        '--piwin-artifact-border': '#ddd',
        '--piwin-artifact-radius': '8px',
        '--piwin-artifact-font': 'sans-serif',
      },
    });
    expect(light.srcdoc).toContain('--piwin-artifact-bg: transparent');
    expect(light.srcdoc).not.toContain('background:#f6f6f7');
  });

  it('lets Inline content flow without a document scrollport', () => {
    const modelSource =
      '<style>body { overflow: auto !important; }</style><section>Flowing content</section>';
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: modelSource,
      channelId: 'inline-flow',
      surface: 'inline',
    });

    expect(srcdoc).toContain('overflow-y: hidden !important');
    expect(srcdoc).toContain('overflow-x: hidden !important');
    expect(srcdoc).toContain('container-type: inline-size');
    expect(srcdoc).toContain('name="viewport"');
    expect(srcdoc.indexOf('data-piwin-artifact-surface-policy')).toBeGreaterThan(
      srcdoc.indexOf(modelSource),
    );
  });

  it('keeps document scrolling inside the Canvas surface', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<section>Wide workspace</section>',
      channelId: 'canvas-scroll',
      surface: 'canvas',
    });

    expect(srcdoc).toContain('overflow-y: auto !important');
    expect(srcdoc).toContain('overflow-x: auto !important');
    expect(srcdoc).not.toContain('container-type: inline-size');
  });

  it('can omit bridge when requested', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>x</div>',
      channelId: 'ch-2',
      includeBridge: false,
    });
    expect(srcdoc).not.toContain('data-piwin-artifact-bridge-bootstrap');
  });

  it('emits a syntactically valid one-shot bridge', () => {
    const completed = buildHtmlArtifactSrcdoc({
      source: '<div>Hi</div>',
      channelId: 'completed-channel',
    });
    const script = completed.srcdoc.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? '')).not.toThrow();
  });

  it('places a no-motion policy after model source', () => {
    const modelSource =
      '<style>@keyframes blink { from { opacity: 0 } }</style><div class="blink">Hi</div>';
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: modelSource,
      channelId: 'no-motion',
    });
    const modelSourceIndex = srcdoc.indexOf(modelSource);
    const motionPolicyIndex = srcdoc.indexOf('data-piwin-artifact-motion-policy');
    expect(modelSourceIndex).toBeGreaterThan(-1);
    expect(motionPolicyIndex).toBeGreaterThan(modelSourceIndex);
    expect(srcdoc).toContain('animation: none !important');
    expect(srcdoc).toContain('transition: none !important');
    expect(srcdoc).toContain('.piwin-artifact-root animateTransform');
  });

  it('uses one root box measurement without descendant traversal', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<section><div class="panel">Hi</div></section>',
      channelId: 'ch-3',
    });
    expect(srcdoc).toContain('Math.max(rect.height || 0, element.offsetHeight || 0, element.scrollHeight || 0)');
    expect(srcdoc).not.toContain("root.querySelectorAll('*')");
    expect(srcdoc).not.toContain('clipToAncestorBounds');
    expect(srcdoc).toContain('overflow-y: hidden !important');
  });

  it('keeps visible overflow content measurable and ignores clipped descendants', () => {
    const visibleOverflowRoot = createFakeElement({
      top: 0,
      height: 32,
      scrollHeight: 78,
      overflowY: 'visible',
    });
    const visibleOverflowChild = createFakeElement({
      top: 4,
      height: 24,
      scrollHeight: 74,
      overflowY: 'visible',
      parentElement: visibleOverflowRoot,
    });
    const visibleOverflowBody = createFakeElement({
      top: 0,
      height: 32,
      scrollHeight: 32,
      overflowY: 'visible',
    });
    const visibleOverflowDocument = createFakeElement({
      top: 0,
      height: 32,
      scrollHeight: 32,
      overflowY: 'visible',
    });
    visibleOverflowRoot.parentElement = visibleOverflowBody;
    visibleOverflowBody.parentElement = visibleOverflowDocument;
    visibleOverflowRoot.querySelectorAll = () => [visibleOverflowChild];

    expect(
      runBridgeMeasurement({
        root: visibleOverflowRoot,
        body: visibleOverflowBody,
        documentElement: visibleOverflowDocument,
      }),
    ).toBe(78);

    const clippedRoot = createFakeElement({
      top: 0,
      height: 48,
      scrollHeight: 48,
      overflowY: 'visible',
    });
    const clippedParent = createFakeElement({
      top: 4,
      height: 40,
      scrollHeight: 180,
      overflowY: 'hidden',
      parentElement: clippedRoot,
    });
    const clippedChild = createFakeElement({
      top: 4,
      height: 180,
      scrollHeight: 180,
      overflowY: 'visible',
      parentElement: clippedParent,
    });
    const clippedBody = createFakeElement({
      top: 0,
      height: 48,
      scrollHeight: 48,
      overflowY: 'visible',
    });
    const clippedDocument = createFakeElement({
      top: 0,
      height: 48,
      scrollHeight: 48,
      overflowY: 'visible',
    });
    clippedRoot.parentElement = clippedBody;
    clippedBody.parentElement = clippedDocument;
    clippedRoot.querySelectorAll = () => [clippedParent, clippedChild];

    expect(
      runBridgeMeasurement({
        root: clippedRoot,
        body: clippedBody,
        documentElement: clippedDocument,
      }),
    ).toBe(48);
  });

  it('does not treat the document scrollport as clipped content', () => {
    const scrollableBody = createFakeElement({
      top: 0,
      height: 40,
      scrollHeight: 240,
      overflowY: 'auto',
    });
    const scrollableDocument = createFakeElement({
      top: 0,
      height: 40,
      scrollHeight: 240,
      overflowY: 'auto',
    });
    const scrollableRoot = createFakeElement({
      top: 0,
      height: 240,
      scrollHeight: 240,
      overflowY: 'visible',
      parentElement: scrollableBody,
    });
    scrollableBody.parentElement = scrollableDocument;

    expect(
      runBridgeMeasurement({
        root: scrollableRoot,
        body: scrollableBody,
        documentElement: scrollableDocument,
      }),
    ).toBe(240);
  });

  it('stops a canvas innerHeight feedback loop at a stable scene height', () => {
    const canvas = createFakeElement({
      top: 0,
      height: 80,
      scrollHeight: 80,
      overflowY: 'visible',
    });
    const root = createFakeElement({
      top: 0,
      height: 88,
      scrollHeight: 88,
      overflowY: 'visible',
    });
    root.querySelector = (selector) => (selector === 'canvas, video' ? canvas : null);
    const body = createFakeElement({
      top: 0,
      height: 88,
      scrollHeight: 88,
      overflowY: 'visible',
    });
    const documentElement = createFakeElement({
      top: 0,
      height: 88,
      scrollHeight: 88,
      overflowY: 'visible',
    });
    root.parentElement = body;
    body.parentElement = documentElement;

    const session = runBridgeSession({
      root,
      body,
      documentElement,
      innerHeight: 80,
    });
    // Scene budget 400 + root padding 8 (the viewport-independent remainder).
    const pinnedHeight = ARTIFACT_VIEWPORT_FILL_HEIGHT + 8;
    expect(session.heights).toEqual([pinnedHeight]);

    // Iframe resized to the pinned height; the canvas followed innerHeight.
    canvas.getBoundingClientRect = () => ({
      top: 0,
      bottom: pinnedHeight,
      height: pinnedHeight,
      width: 100,
    });
    canvas.offsetHeight = pinnedHeight;
    canvas.scrollHeight = pinnedHeight;
    root.getBoundingClientRect = () => ({
      top: 0,
      bottom: pinnedHeight + 8,
      height: pinnedHeight + 8,
      width: 100,
    });
    root.offsetHeight = pinnedHeight + 8;
    root.scrollHeight = pinnedHeight + 8;
    session.setInnerHeight(pinnedHeight);
    session.remeasure();
    expect(session.heights).toEqual([pinnedHeight]);
  });
});

type FakeRect = {
  top: number;
  bottom: number;
  height: number;
  width: number;
};

type FakeStyle = {
  display: string;
  visibility: string;
  overflowY: string;
};

type FakeElement = {
  parentElement: FakeElement | null;
  offsetHeight: number;
  scrollHeight: number;
  overflowY: string;
  querySelector?: (selector: string) => FakeElement | null;
  querySelectorAll: () => FakeElement[];
  getBoundingClientRect: () => FakeRect;
};

type FakeDocument = {
  readyState: string;
  body: FakeElement;
  documentElement: FakeElement;
  querySelector: (selector: string) => FakeElement | null;
  addEventListener: (type: string, listener: unknown, capture?: boolean) => void;
};

type FakeWindow = {
  [key: string]: unknown;
  scrollY: number;
  innerHeight?: number;
  addEventListener: () => void;
  getComputedStyle: (element: FakeElement) => FakeStyle;
};

type BridgeSession = {
  heights: number[];
  setInnerHeight: (height: number) => void;
  remeasure: () => void;
};

type BridgeMessage = {
  type: string;
  height: number;
};

type BridgeExecutor = (
  windowObject: FakeWindow,
  documentObject: FakeDocument,
  parentObject: { postMessage: (data: unknown, targetOrigin: string) => void },
  setTimeoutFunction: (handler: () => void, delay?: number) => number,
  clearTimeoutFunction: (id: number) => void,
  requestAnimationFrameFunction: (handler: () => void) => number,
) => void;

type BridgeFixture = {
  root: FakeElement;
  body: FakeElement;
  documentElement: FakeElement;
};

function createFakeElement(input: {
  top: number;
  height: number;
  scrollHeight: number;
  overflowY: string;
  parentElement?: FakeElement;
}): FakeElement {
  const element: FakeElement = {
    parentElement: input.parentElement ?? null,
    offsetHeight: input.height,
    scrollHeight: input.scrollHeight,
    overflowY: input.overflowY,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({
      top: input.top,
      bottom: input.top + input.height,
      height: input.height,
      width: 100,
    }),
  };
  return element;
}

function runBridgeSession(
  fixture: BridgeFixture & { innerHeight?: number },
): BridgeSession {
  const messages: BridgeMessage[] = [];
  const resizeObservers: Array<() => void> = [];
  const documentObject: FakeDocument = {
    readyState: 'complete',
    body: fixture.body,
    documentElement: fixture.documentElement,
    querySelector: (selector) => (selector === '.piwin-artifact-root' ? fixture.root : null),
    addEventListener: () => undefined,
  };
  const windowObject: FakeWindow = {
    scrollY: 0,
    ...(fixture.innerHeight !== undefined ? { innerHeight: fixture.innerHeight } : {}),
    addEventListener: () => undefined,
    getComputedStyle: (element): FakeStyle => ({
      display: 'block',
      visibility: 'visible',
      overflowY: element.overflowY,
    }),
    ResizeObserver: class {
      constructor(callback: () => void) {
        resizeObservers.push(callback);
      }
      observe(): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    },
  };
  const parentObject = {
    postMessage: (data: unknown): void => {
      if (isBridgeMessage(data)) {
        messages.push(data);
      }
    },
  };
  const source = buildArtifactBridgeBootstrapScript('test-channel');
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script) {
    throw new Error('bridge script missing');
  }
  const execute = new Function(
    'window',
    'document',
    'parent',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    script,
  ) as unknown as BridgeExecutor;
  execute(
    windowObject,
    documentObject,
    parentObject,
    (handler) => {
      handler();
      return 0;
    },
    () => undefined,
    (handler) => {
      handler();
      return 0;
    },
  );
  return {
    get heights() {
      return messages.map((message) => message.height);
    },
    setInnerHeight(height: number): void {
      windowObject.innerHeight = height;
    },
    remeasure(): void {
      for (const observer of resizeObservers) {
        observer();
      }
    },
  };
}

function runBridgeMeasurement(fixture: BridgeFixture): number {
  const session = runBridgeSession(fixture);
  const readyHeight = session.heights[0];
  if (readyHeight === undefined) {
    throw new Error('ready message missing');
  }
  return readyHeight;
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['type'] === 'string' && typeof record['height'] === 'number';
}
