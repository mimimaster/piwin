import { describe, expect, it } from 'vitest';
import { ARTIFACT_BRIDGE_READY_TYPE, ARTIFACT_BRIDGE_RESIZE_TYPE } from './constants.js';
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
    expect(csp).toContain('frame-src https://www.youtube.com');
    expect(csp).toContain("object-src 'none'");
  });

  it('uses frame-src none when disabled', () => {
    const csp = buildStrictArtifactCsp(createDefaultArtifactIframePolicy('disabled'));
    expect(csp).toContain("frame-src 'none'");
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
    expect(srcdoc).toContain(ARTIFACT_BRIDGE_RESIZE_TYPE);
    expect(srcdoc).toContain('ch-1');
    expect(srcdoc).toContain('data-piwin-artifact-bridge-bootstrap');
    expect(csp).toContain("default-src 'none'");
  });

  it('centers fixed-width native SVG fences within the responsive artifact measure', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<svg width="500" height="400" viewBox="0 0 500 400"></svg>',
      channelId: 'svg-centered',
    });

    expect(srcdoc).toContain('.piwin-artifact-root > svg');
    expect(srcdoc).toContain('width: auto;');
    expect(srcdoc).toContain('margin-inline: auto;');
  });

  it('can omit bridge when requested', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>x</div>',
      channelId: 'ch-2',
      includeBridge: false,
    });
    expect(srcdoc).not.toContain('data-piwin-artifact-bridge-bootstrap');
  });

  it('measures visible box height without counting clipped overflow', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<section><div class="panel">Hi</div></section>',
      channelId: 'ch-3',
    });
    expect(srcdoc).toContain('rect.height');
    expect(srcdoc).toContain('element.offsetHeight');
    expect(srcdoc).toContain('element.scrollHeight');
    expect(srcdoc).toContain('overflowY');
    expect(srcdoc).toContain('overflow-y: auto !important');
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
  querySelectorAll: () => FakeElement[];
  getBoundingClientRect: () => FakeRect;
};

type FakeDocument = {
  body: FakeElement;
  documentElement: FakeElement;
  querySelector: (selector: string) => FakeElement | null;
};

type FakeWindow = {
  [key: string]: unknown;
  scrollY: number;
  addEventListener: () => void;
  getComputedStyle: (element: FakeElement) => FakeStyle;
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

function runBridgeMeasurement(fixture: BridgeFixture): number {
  const messages: BridgeMessage[] = [];
  const documentObject: FakeDocument = {
    body: fixture.body,
    documentElement: fixture.documentElement,
    querySelector: (selector) => (selector === '.piwin-artifact-root' ? fixture.root : null),
  };
  const windowObject: FakeWindow = {
    scrollY: 0,
    addEventListener: () => undefined,
    getComputedStyle: (element): FakeStyle => ({
      display: 'block',
      visibility: 'visible',
      overflowY: element.overflowY,
    }),
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
    () => 0,
    () => undefined,
    (handler) => {
      handler();
      return 0;
    },
  );
  const readyMessage = messages.find((message) => message.type === 'piwin-artifact:ready');
  if (!readyMessage) {
    throw new Error('ready message missing');
  }
  return readyMessage.height;
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['type'] === 'string' && typeof record['height'] === 'number';
}
