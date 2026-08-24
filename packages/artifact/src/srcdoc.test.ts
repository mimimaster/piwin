import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BRIDGE_SIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_FRAME_MODES,
} from './constants.js';
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import {
  buildArtifactBridgeBootstrapScript,
  buildHtmlArtifactSrcdoc,
  buildStrictArtifactCsp,
} from './srcdoc.js';
import type { ArtifactFrameMode } from './types.js';

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
  it('embeds a fragment, CSP meta, and the single size bridge', () => {
    const raw = '<button>Click</button>';
    const { srcdoc, csp } = buildHtmlArtifactSrcdoc({
      source: raw,
      channelId: 'ch-1',
    });
    expect(srcdoc).toContain(raw);
    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain('piwin-artifact-root');
    expect(srcdoc).toContain(ARTIFACT_BRIDGE_SIZE_TYPE);
    expect(srcdoc).toContain('ch-1');
    expect(srcdoc).toContain('data-piwin-artifact-bridge-bootstrap');
    expect(csp).toContain("default-src 'none'");
  });

  it('reports one revisioned root-box stream over native and browser transports', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>completed</div>',
      channelId: 'ch-completed',
    });
    expect(srcdoc).toContain('window.webkit.messageHandlers.piwinArtifact');
    expect(srcdoc).toContain('nativeHandler.postMessage(JSON.stringify(message))');
    expect(srcdoc).toContain('post(actionType, { action: action, payload: payload || {} })');
    expect(srcdoc).toContain("parent.postMessage(message, '*')");
    expect(srcdoc).toContain('window.ResizeObserver');
    expect(srcdoc).toContain('heightObserver.observe(root)');
    expect(srcdoc).toContain('root.getBoundingClientRect().height');
    expect(srcdoc).toContain('revision: sizeRevision');
    expect(srcdoc).toContain('height === lastReportedHeight');
    expect(srcdoc).not.toContain("window.addEventListener('resize', scheduleHeight)");
    expect(srcdoc).not.toContain("root.querySelector('canvas, video')");
    expect(srcdoc).not.toContain('MutationObserver');
    expect(srcdoc).not.toContain('scheduleMeasureLadder');
  });

  it('updates DOM only during streaming and keeps the frameMode listener after final', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>streaming</div>',
      channelId: 'ch-stream',
      enableStreamUpdates: true,
    });
    expect(srcdoc).toContain(ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE);
    expect(srcdoc).toContain('syncChildren(root, template.content)');
    expect(srcdoc).toContain('sourceFrozen = true');
    expect(srcdoc).toContain('if (sourceFrozen) return');
    expect(srcdoc).not.toContain("window.removeEventListener('message', onRenderCommand)");
    expect(srcdoc).toContain('scheduleHeight();');
    expect(srcdoc).toContain('activateFinalScripts(root)');
    expect(srcdoc).not.toContain('MutationObserver');
  });

  it('keeps Inline content in natural flow without a document scrollport', () => {
    const modelSource =
      '<style>body { overflow: auto !important; }</style><section>Flowing content</section>';
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: modelSource,
      channelId: 'inline-flow',
      surface: 'inline',
    });

    expect(srcdoc).toContain('data-frame-mode="inline-flow"');
    expect(srcdoc).toContain('html[data-frame-mode="inline-flow"]');
    expect(srcdoc).toContain('overflow-y: hidden !important');
    expect(srcdoc).toContain('overflow-x: hidden !important');
    expect(srcdoc).toContain('container-type: inline-size');
    expect(srcdoc.indexOf('data-piwin-artifact-frame-mode-policy')).toBeGreaterThan(
      srcdoc.indexOf(modelSource),
    );
  });

  it('preserves a full document for Canvas and omits height measurement', () => {
    const modelSource =
      '<!DOCTYPE html><html class="app"><head><title>Ink</title></head><body data-app="ink"><main>Workspace</main></body></html>';
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: modelSource,
      channelId: 'canvas-document',
      surface: 'canvas',
      documentKind: 'document',
    });

    expect(srcdoc).toContain('<html class="app" data-frame-mode="canvas">');
    expect(srcdoc).toContain('<body data-app="ink"><main>Workspace</main></body>');
    expect(srcdoc.match(/<html\b/gi)).toHaveLength(1);
    expect(srcdoc).toContain('html[data-frame-mode="canvas"]');
    expect(srcdoc).toContain('overflow-y: auto !important');
    expect(srcdoc).toContain('overflow: hidden !important');
    expect(srcdoc).not.toContain('<div class="piwin-artifact-root">');
    expect(srcdoc).toContain("currentFrameMode !== 'canvas'");
  });

  it('hosts a body-only document without nesting a second body', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<body data-app="body-only"><main>Workspace</main></body>',
      channelId: 'canvas-body-only',
      surface: 'canvas',
      documentKind: 'document',
    });

    expect(srcdoc.match(/<body\b/gi)).toHaveLength(1);
    expect(srcdoc).toContain('<body data-app="body-only">');
    expect(srcdoc).toContain('data-piwin-artifact-theme');
  });

  it('can omit the bridge', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<div>x</div>',
      channelId: 'ch-2',
      includeBridge: false,
    });
    expect(srcdoc).not.toContain('data-piwin-artifact-bridge-bootstrap');
  });

  it('emits syntactically valid bridges for every frame mode', () => {
    for (const frameMode of ARTIFACT_FRAME_MODES) {
      const source = buildArtifactBridgeBootstrapScript('syntax-channel', true, frameMode);
      const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
      expect(script).toBeDefined();
      expect(() => new Function(script ?? '')).not.toThrow();
    }
  });

  it('embeds all four frame-mode CSS contracts in every sandbox document', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<section>Card</section>',
      channelId: 'modes',
      frameMode: 'inline-flow',
    });
    for (const frameMode of ARTIFACT_FRAME_MODES) {
      expect(srcdoc).toContain(`html[data-frame-mode="${frameMode}"]`);
    }
  });

  it('places the no-motion policy after fragment source', () => {
    const modelSource =
      '<style>@keyframes blink { from { opacity: 0 } }</style><div class="blink">Hi</div>';
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: modelSource,
      channelId: 'no-motion',
    });
    expect(srcdoc.indexOf('data-piwin-artifact-motion-policy')).toBeGreaterThan(
      srcdoc.indexOf(modelSource),
    );
    expect(srcdoc).toContain('animation: none !important');
    expect(srcdoc).toContain('transition: none !important');
  });

  it('reports natural root height once per distinct ResizeObserver revision', () => {
    const root = createMeasuredRoot(240);
    const session = runBridgeSession(root);
    expect(session.messages).toEqual([
      {
        type: ARTIFACT_BRIDGE_SIZE_TYPE,
        channelId: 'test-channel',
        height: 240,
        viewportHeight: 80,
        revision: 0,
      },
    ]);

    session.remeasure();
    expect(session.messages).toHaveLength(1);

    root.height = 360;
    session.remeasure();
    expect(session.messages.at(-1)).toMatchObject({ height: 360, revision: 1 });
  });

  it('switches flow to viewport: data-frame-mode, observer disconnect, one size', () => {
    const root = createMeasuredRoot(240);
    const session = runBridgeSession(root, { enableRenderCommand: true });
    expect(session.documentElement.attributes['data-frame-mode']).toBe('inline-flow');
    expect(session.observerCount()).toBe(1);

    session.dispatchRenderCommand({
      type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
      channelId: 'test-channel',
      revision: 0,
      source: '<div>next</div>',
      frameMode: 'inline-viewport',
      final: false,
    });
    expect(session.documentElement.attributes['data-frame-mode']).toBe('inline-viewport');
    expect(session.observerCount()).toBe(0);

    session.remeasure();
    expect(session.observerCount()).toBe(0);

    session.dispatchRenderCommand({
      type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
      channelId: 'test-channel',
      revision: 1,
      source: '<div>back</div>',
      frameMode: 'inline-flow',
      final: false,
    });
    expect(session.documentElement.attributes['data-frame-mode']).toBe('inline-viewport');
  });

  it('applies flow→viewport after final without replaying scripts', () => {
    const root = createMeasuredRoot(240);
    const session = runBridgeSession(root, { enableRenderCommand: true });
    session.dispatchRenderCommand({
      type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
      channelId: 'test-channel',
      revision: 0,
      source: '<div>done</div><script>window.ready=true</script>',
      frameMode: 'inline-flow',
      final: true,
    });
    expect(session.scriptActivateCount()).toBe(1);
    expect(session.documentElement.attributes['data-frame-mode']).toBe('inline-flow');
    expect(session.listenerCount()).toBe(1);

    session.dispatchRenderCommand({
      type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
      channelId: 'test-channel',
      revision: 1,
      source: '<div>ignore</div><script>window.ready=2</script>',
      frameMode: 'inline-viewport',
      final: true,
    });
    expect(session.documentElement.attributes['data-frame-mode']).toBe('inline-viewport');
    expect(session.scriptActivateCount()).toBe(1);
    expect(session.observerCount()).toBe(0);
  });
});

type MeasuredRoot = {
  height: number;
  getBoundingClientRect: () => { height: number };
};

type SizeMessage = {
  type: string;
  channelId: string;
  height: number;
  viewportHeight: number;
  revision: number;
};

function createMeasuredRoot(height: number): MeasuredRoot {
  const root: MeasuredRoot = {
    height,
    getBoundingClientRect: () => ({ height: root.height }),
  };
  return root;
}

function runBridgeSession(
  root: MeasuredRoot,
  options: { enableRenderCommand?: boolean; frameMode?: ArtifactFrameMode } = {},
): {
  messages: SizeMessage[];
  documentElement: { attributes: Record<string, string> };
  observerCount: () => number;
  listenerCount: () => number;
  scriptActivateCount: () => number;
  remeasure: () => void;
  dispatchRenderCommand: (data: unknown) => void;
} {
  const messages: SizeMessage[] = [];
  const resizeCallbacks = new Set<() => void>();
  const animationCallbacks: Array<() => void> = [];
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const documentElement = {
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    },
  };
  const windowObject = {
    innerHeight: 80,
    dispatchEvent: () => undefined,
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type === 'message') messageListeners.push(listener);
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
  };
  let scriptActivations = 0;
  const fragmentRoot = {
    ...root,
    firstChild: null as unknown,
    querySelectorAll: (selector: string) =>
      selector === 'script'
        ? [{ attributes: [], textContent: '', replaceWith: () => undefined }]
        : [],
  };
  const documentObject = {
    readyState: 'complete',
    documentElement,
    querySelector: (selector: string) =>
      selector === '.piwin-artifact-root' ? fragmentRoot : null,
    addEventListener: () => undefined,
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
    'HTMLAnchorElement',
    script,
  ) as (
    windowValue: unknown,
    documentValue: unknown,
    parentValue: unknown,
    requestAnimationFrameValue: (callback: () => void) => number,
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
    {
      prototype: { click: () => undefined },
    },
  );

  const flushAnimationFrames = (): void => {
    while (animationCallbacks.length > 0) animationCallbacks.shift()?.();
  };
  flushAnimationFrames();

  return {
    messages,
    documentElement,
    observerCount: () => resizeCallbacks.size,
    listenerCount: () => messageListeners.length,
    scriptActivateCount: () => scriptActivations,
    remeasure: (): void => {
      for (const callback of [...resizeCallbacks]) callback();
      flushAnimationFrames();
    },
    dispatchRenderCommand: (data: unknown): void => {
      for (const listener of [...messageListeners]) listener({ data });
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
