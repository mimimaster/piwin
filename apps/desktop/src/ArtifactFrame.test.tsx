/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactCapabilityReport, ArtifactRenderPlan } from '@piwin/artifact';
import { resetArtifactInitQueueForTests } from './artifact-init-queue.js';
import { resetArtifactLiveHostRegistryForTests } from './artifact-live-host-registry.js';
import { Button, PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ArtifactFrame } from './ArtifactFrame.js';
import { subscribeNativeArtifactBridge } from './artifact-native-bridge.js';

vi.mock('./artifact-native-bridge.js', () => ({
  subscribeNativeArtifactBridge: vi.fn(async () => () => undefined),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const EMPTY_CAPABILITIES: ArtifactCapabilityReport = {
  scripts: true,
  events: false,
  form: false,
  iframe: false,
  externalUrl: false,
  cssUrl: false,
  shadowHost: false,
  viewportDependency: false,
  isolation: false,
  blockReason: null,
  byteSize: 42,
  externalResources: [],
};

function makeRenderPlan(id = 'artifact-test-1'): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const source = '<div class="diagram">wide content</div><script>window.ready = true</script>';
  const descriptor = {
    id,
    type: 'html' as const,
    title: 'piwin architecture (simplified)',
    rawLanguage: 'artifact-html',
    alias: 'artifact-html',
    declaration: 'explicit' as const,
    documentKind: 'fragment' as const,
    surface: 'inline' as const,
    source,
  };
  return {
    kind: 'render',
    intent: {
      descriptor,
      capabilities: EMPTY_CAPABILITIES,
      surface: 'inline',
      layout: 'flow',
      renderer: 'sandbox',
    },
    frameMode: 'inline-flow',
    mode: 'interactive',
    renderSource: source,
    document: {
      kind: 'sandbox',
      srcdoc:
        '<!DOCTYPE html><html><body><div class="diagram">wide content</div><script>window.ready = true</script></body></html>',
      csp: "default-src 'none'",
    },
  };
}

function makeStreamPlan(
  source: string,
  srcdoc: string,
): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const plan = makeRenderPlan();
  return {
    ...plan,
    mode: 'stream-preview',
    intent: {
      ...plan.intent,
      descriptor: {
        ...plan.intent.descriptor,
        source,
      },
      renderer: 'sandbox',
    },
    renderSource: source,
    document: { kind: 'sandbox', srcdoc, csp: "default-src 'none'" },
  };
}

type FramePlan = Extract<ArtifactRenderPlan, { kind: 'render' } | { kind: 'blocked' }>;

function renderFrame(
  plan: FramePlan = makeRenderPlan(),
  presentation: 'inline' | 'canvas' = 'inline',
  extraHeaderAction?: ReactElement,
  locale: 'zh-CN' | 'en' = 'en',
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame
            plan={plan}
            presentation={presentation}
            locale={locale}
            {...(extraHeaderAction ? { extraHeaderAction } : {})}
          />
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

describe('ArtifactFrame chrome', () => {
  let instances: { container: HTMLDivElement; root: Root }[] = [];
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    instances = [];
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    vi.mocked(subscribeNativeArtifactBridge).mockReset();
    vi.mocked(subscribeNativeArtifactBridge).mockResolvedValue(() => undefined);
  });

  afterEach(() => {
    for (const { container, root } of instances) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('omits Expand and raw-source disclosure on inline render frames', async () => {
    const { container, root } = renderFrame();
    instances.push({ container, root });

    // Init queue is async; wait for grant + frame.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const frame = container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('data-artifact-layout')).toBe('inline');
    expect(frame?.classList.contains('is-expanded')).toBe(false);
    expect(frame?.hasAttribute('data-expanded')).toBe(false);
    // Source lives behind Show code from MarkdownView; no expand height toggle.
    expect(container.querySelector('[data-testid="artifact-expand-toggle"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  it('removes the permanent title bar and keeps only a floating action layer', async () => {
    const { container, root } = renderFrame(
      makeRenderPlan(),
      'inline',
      <Button size="compact">Show code</Button>,
    );
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.artifact-frame-header')).toBeNull();
    expect(container.querySelector('.artifact-frame-actions')?.textContent).toContain('Show code');
    expect(container.textContent).not.toContain('piwin architecture (simplified)');
    expect(container.textContent).not.toContain('42 bytes');
  });

  it('lets an Inline frame grow past the legacy 900px scrollport', async () => {
    const decision = makeRenderPlan();
    const { container, root } = renderFrame(decision);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:size',
            channelId: decision.intent.descriptor.id,
            height: 1_480,
            viewportHeight: 80,
            revision: 0,
          },
        }),
      );
    });

    // Measured height lives on the stage (iframe fills 100% of the stage).
    const stage = container.querySelector('.artifact-iframe-stage') as HTMLElement | null;
    expect(stage?.style.height).toBe('1480px');
    expect(stage?.style.maxHeight).toBe('16384px');
    expect(
      container
        .querySelector('[data-testid="artifact-frame"]')
        ?.hasAttribute('data-content-overflowing'),
    ).toBe(false);
  });

  it('rejects browser height messages from a foreign window', async () => {
    const decision = makeRenderPlan();
    const { container, root } = renderFrame(decision);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: 'piwin-artifact:size',
            channelId: decision.intent.descriptor.id,
            height: 920,
            viewportHeight: 80,
            revision: 0,
          },
        }),
      );
    });

    const stage = container.querySelector('.artifact-iframe-stage') as HTMLElement | null;
    expect(stage?.style.height).toBe('80px');
  });

  it('seeds SVG stage height from viewBox so the first paint is not an 80px strip', async () => {
    const base = makeRenderPlan();
    const svgSource =
      '<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="400"/></svg>';
    const decision: Extract<ArtifactRenderPlan, { kind: 'render' }> = {
      ...base,
      mode: 'stream-preview',
      intent: {
        ...base.intent,
        descriptor: {
          ...base.intent.descriptor,
          id: 'svg-seed-1',
          type: 'svg',
          rawLanguage: 'svg',
          alias: 'svg',
          source: svgSource,
        },
        renderer: 'sandbox',
      },
      renderSource: svgSource,
      document: {
        kind: 'sandbox',
        srcdoc: '<!DOCTYPE html><html><body><svg viewBox="0 0 800 400"></svg></body></html>',
        csp: "default-src 'none'",
      },
    };
    const { container, root } = renderFrame(decision);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const stage = container.querySelector('.artifact-iframe-stage') as HTMLElement | null;
    const heightPx = Number.parseInt(stage?.style.height ?? '0', 10);
    // viewBox 800×400 at fallback width ~780 → ~398+pad; never the 80px initial strip.
    expect(heightPx).toBeGreaterThan(120);
  });

  it('uses an opaque data document instead of the broken packaged srcdoc path', async () => {
    const { container, root } = renderFrame();
    instances.push({ container, root });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe?.getAttribute('srcdoc')).toBeNull();
    expect(iframe?.getAttribute('src')).toMatch(/^data:text\/html;charset=utf-8;base64,/);
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('covers an unstable stream prefix until a stable snapshot arrives', async () => {
    const preparing = makeStreamPlan('', '<html>empty stable stream shell</html>');
    const { container, root } = renderFrame(preparing, 'canvas', undefined, 'zh-CN');
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-stream-preparing"]')).not.toBeNull();
    expect(container.textContent).toContain('正在准备稳定画面');

    const stable = makeStreamPlan(
      '<style>.scene { display: grid; }</style><div class="scene">ready</div>',
      '<html>replacement must not mount</html>',
    );
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={stable} presentation="canvas" locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="artifact-stream-preparing"]')).toBeNull();
    expect(container.querySelector('iframe.artifact-iframe')).toBe(iframe);
  });

  it('keeps one iframe and pushes throttled DOM snapshots while output is streaming', async () => {
    const initial = makeStreamPlan('<div><p>Hel</p></div>', '<html>initial stream</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const initialDocumentUrl = iframe?.getAttribute('src');
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const next = makeStreamPlan(
      '<div><p>Hello</p><section>Next</section></div>',
      '<html>replacement must not mount</html>',
    );

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={next} />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    const updatedIframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(updatedIframe).toBe(iframe);
    expect(updatedIframe?.getAttribute('src')).toBe(initialDocumentUrl);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'piwin-artifact:stream-update',
        channelId: 'artifact-test-1',
        revision: expect.any(Number),
        source: next.renderSource,
        frameMode: 'inline-flow',
        final: false,
      },
      '*',
    );
  });

  it('replays a large newly-styled scene through stable prefixes', async () => {
    const initial = makeStreamPlan('', '<html>empty stream shell</html>');
    const { container, root } = renderFrame(initial, 'canvas');
    instances.push({ container, root });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const scene = [
      '<style>.scene { display: grid; } .part { min-height: 20px; }</style>',
      '<div class="scene">',
      ...Array.from(
        { length: 12 },
        (_unused, index) =>
          `<div class="part" data-part="${index}">${String(index).repeat(420)}</div>`,
      ),
      '</div>',
    ].join('');
    const styled = makeStreamPlan(scene, '<html>replacement must not mount</html>');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={styled} presentation="canvas" />
        </PiwinUiProvider>,
      );
    });

    const firstReplaySource = postMessage.mock.calls
      .map(([payload]) => payload)
      .find(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          'source' in payload &&
          typeof payload.source === 'string' &&
          payload.source.length > 0,
      ) as { source?: string } | undefined;
    expect(firstReplaySource?.source?.length).toBeGreaterThan(0);
    expect(firstReplaySource?.source?.length).toBeLessThan(scene.length);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_540));
    });
    const postedSources = postMessage.mock.calls
      .map(([payload]) => payload)
      .filter(
        (payload): payload is { source: string } =>
          typeof payload === 'object' &&
          payload !== null &&
          'source' in payload &&
          typeof payload.source === 'string',
      )
      .map((payload) => payload.source);
    expect(postedSources.at(-1)).toBe(scene);
    expect(new Set(postedSources).size).toBeGreaterThan(2);
    expect(container.querySelector('iframe.artifact-iframe')).toBe(iframe);
  });

  it('commits final DOM in place and does not replace the stream document', async () => {
    const initial = makeStreamPlan('<div><p>Hel</p></div>', '<html>stable stream shell</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const initialDocumentUrl = iframe?.getAttribute('src');
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const finalSource =
      '<div><p>Hello</p><button>Done</button></div><script>window.done=true</script>';
    const baseFinal = makeRenderPlan();
    const finalDecision: Extract<ArtifactRenderPlan, { kind: 'render' }> = {
      ...baseFinal,
      intent: {
        ...baseFinal.intent,
        descriptor: {
          ...baseFinal.intent.descriptor,
          source: finalSource,
        },
      },
      renderSource: finalSource,
      document: {
        kind: 'sandbox',
        srcdoc: '<html>replacement final document must not mount</html>',
        csp: "default-src 'none'",
      },
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={finalDecision} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const completedIframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(completedIframe).toBe(iframe);
    expect(completedIframe?.getAttribute('src')).toBe(initialDocumentUrl);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'piwin-artifact:stream-update',
        channelId: 'artifact-test-1',
        revision: expect.any(Number),
        source: finalSource,
        frameMode: 'inline-flow',
        final: true,
      },
      '*',
    );

    postMessage.mockClear();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={{ ...finalDecision }} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('upgrades inline-flow to inline-viewport on the same iframe', async () => {
    const initial = makeStreamPlan('<div><p>Hel</p></div>', '<html>initial stream</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const frame = container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-flow');
    expect(iframe?.getAttribute('data-frame-mode')).toBe('inline-flow');
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const viewportPlan: Extract<ArtifactRenderPlan, { kind: 'render' }> = {
      ...initial,
      frameMode: 'inline-viewport',
      intent: {
        ...initial.intent,
        layout: 'viewport',
      },
      renderSource: '<div><p>Hello viewport</p></div>',
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={viewportPlan} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const upgraded = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(upgraded).toBe(iframe);
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-frame-mode'),
    ).toBe('inline-viewport');
    expect(upgraded?.getAttribute('data-frame-mode')).toBe('inline-viewport');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'piwin-artifact:stream-update',
        frameMode: 'inline-viewport',
        final: false,
      }),
      '*',
    );

    const backToFlow: Extract<ArtifactRenderPlan, { kind: 'render' }> = {
      ...viewportPlan,
      frameMode: 'inline-flow',
      intent: { ...viewportPlan.intent, layout: 'flow' },
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={backToFlow} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-frame-mode'),
    ).toBe('inline-viewport');
    expect(container.querySelector('iframe.artifact-iframe')?.getAttribute('data-frame-mode')).toBe(
      'inline-viewport',
    );
  });

  it('applies every valid observed height through streaming and completion', async () => {
    const initial = makeStreamPlan('<div>Growing</div>', '<html>stream shell</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    let revision = 0;
    const dispatchHeight = (height: number): void => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'artifact-test-1',
            height,
            viewportHeight: 80,
            revision: revision++,
          },
        }),
      );
    };

    act(() => dispatchHeight(360));
    act(() => dispatchHeight(180));
    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    expect(stage?.style.height).toBe('180px');

    const finalDecision = makeRenderPlan();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={finalDecision} />
        </PiwinUiProvider>,
      );
    });
    act(() => dispatchHeight(900));
    expect(stage?.style.height).toBe('900px');
    act(() => dispatchHeight(420));
    expect(stage?.style.height).toBe('420px');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'artifact-test-1',
            height: 1_200,
            viewportHeight: 420,
            revision: 2,
          },
        }),
      );
    });
    expect(stage?.style.height).toBe('420px');
  });

  it('applies heights returned through WKWebView native frame messages', async () => {
    let nativeHandler: ((payload: unknown) => void) | null = null;
    vi.mocked(subscribeNativeArtifactBridge).mockImplementation(async (_channelId, handler) => {
      nativeHandler = handler;
      return () => undefined;
    });

    const decision = makeRenderPlan();
    const { container, root } = renderFrame(decision);
    instances.push({ container, root });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(subscribeNativeArtifactBridge).toHaveBeenCalledWith(
      decision.intent.descriptor.id,
      expect.any(Function),
    );

    act(() => {
      const handler = nativeHandler as ((payload: unknown) => void) | null;
      handler?.({
        type: 'piwin-artifact:size',
        channelId: decision.intent.descriptor.id,
        height: 684,
        viewportHeight: 80,
        revision: 0,
      });
    });

    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    expect(stage?.style.height).toBe('684px');
  });

  it('shows recovery chrome instead of marking a timed-out iframe done', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container, root } = renderFrame();
    instances.push({ container, root });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    act(() => {
      iframe?.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(5_000);
    });

    expect(container.querySelector('[data-testid="artifact-bridge-failure"]')).toBeNull();
    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    expect(stage?.style.display).not.toBe('none');
    expect(stage?.style.height).toBe('360px');
    expect(container.querySelector('iframe.artifact-iframe')).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="artifact-frame"]')
        ?.getAttribute('data-artifact-height-status'),
    ).toBe('fallback');
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-tool-status'),
    ).toBe('error');
    expect(container.querySelector('[data-testid="artifact-height-recovery"]')).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('applies the canvas presentation class without expand chrome', async () => {
    const { container, root } = renderFrame(makeRenderPlan(), 'canvas');
    instances.push({ container, root });

    // Init queue is async; wait for grant + frame.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const frame = container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.classList.contains('presentation-canvas')).toBe(true);
    expect(frame?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-testid="artifact-expand-toggle"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  it('ignores composer/propose-text from an Inline frame (Canvas-only action)', async () => {
    const onComposerProposal = vi.fn();
    const decision = makeRenderPlan();
    const { container, root } = renderFrame(decision, 'inline');
    instances.push({ container, root });
    // Override with the proposal handler via a second render.
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame
              plan={decision}
              presentation="inline"
              onComposerProposal={onComposerProposal}
            />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:action',
            channelId: 'artifact-test-1',
            action: 'composer/propose-text',
            payload: { text: 'Use React.' },
          },
        }),
      );
    });
    expect(onComposerProposal).not.toHaveBeenCalled();
  });

  it('forwards composer/propose-text to onComposerProposal in Canvas presentation', async () => {
    const onComposerProposal = vi.fn();
    const decision = makeRenderPlan();
    const { container, root } = renderFrame(decision, 'canvas');
    instances.push({ container, root });
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame
              plan={decision}
              presentation="canvas"
              onComposerProposal={onComposerProposal}
            />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:action',
            channelId: 'artifact-test-1',
            action: 'composer/propose-text',
            payload: { text: 'Use React.', label: 'Stack' },
          },
        }),
      );
    });
    expect(onComposerProposal).toHaveBeenCalledTimes(1);
    expect(onComposerProposal).toHaveBeenCalledWith({ text: 'Use React.', label: 'Stack' });
  });

  it('paints the iframe immediately without a loading shell overlay', async () => {
    const { container, root } = renderFrame();
    instances.push({ container, root });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const host = container
      .querySelector('[data-testid="artifact-frame"]')
      ?.getAttribute('data-artifact-host');
    expect(host).toBe('live');
    // No waiting overlay between mount and bridge ready — the iframe paints
    // right away (streaming previews draw progressively).
    expect(container.querySelector('[data-testid="artifact-iframe-loading"]')).toBeNull();
    expect(container.querySelector('iframe.artifact-iframe')).not.toBeNull();
  });

  it('keeps the painted frame when a parent re-render rebuilds an equivalent decision', async () => {
    // Clicking the composer re-renders the transcript; materializeArtifact
    // builds a fresh (but byte-equivalent) plan each render. The frame must not
    // reset its height or jump back to a waiting state.
    const decision = makeRenderPlan();
    const { container, root } = renderFrame(decision);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:size',
            channelId: decision.intent.descriptor.id,
            height: 640,
            viewportHeight: 80,
            revision: 0,
          },
        }),
      );
    });
    const stage = container.querySelector('.artifact-iframe-stage') as HTMLElement | null;
    expect(stage?.style.height).toBe('640px');

    // Equivalent decision object (same srcdoc) — e.g. composer focus re-render.
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={makeRenderPlan()} />
        </PiwinUiProvider>,
      );
    });

    const stageAfterRerender = container.querySelector(
      '.artifact-iframe-stage',
    ) as HTMLElement | null;
    expect(stageAfterRerender?.style.height).toBe('640px');
    expect(container.querySelector('[data-testid="artifact-iframe-loading"]')).toBeNull();
    expect(container.querySelector('iframe.artifact-iframe')).not.toBeNull();
  });

  it('offers Load preview when the live budget rejects the frame', async () => {
    const { MAX_LIVE_ARTIFACT_IFRAMES, claimArtifactLiveHost, releaseArtifactLiveHost } =
      await import('./artifact-live-host-registry.js');
    // Fill the budget with forceKeep hosts so the next claim is denied.
    for (let index = 0; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `force-fill-${index}`,
        forceKeep: true,
        priority: 1,
        evict: () => undefined,
      });
    }

    const { container, root } = renderFrame();
    instances.push({ container, root });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="artifact-iframe-placeholder"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-load-preview"]')).not.toBeNull();
    expect(container.querySelector('iframe.artifact-iframe')).toBeNull();

    // Free a slot then click load — should admit and mount iframe path.
    act(() => {
      releaseArtifactLiveHost('force-fill-0');
    });
    const loadBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-load-preview"]',
    );
    await act(async () => {
      loadBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-artifact-host'),
    ).toBe('live');
  });
});
