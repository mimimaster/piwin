/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactPreviewDecision } from '@piwin/artifact';
import {
  resetArtifactInitQueueForTests,
  resetArtifactLiveHostRegistryForTests,
} from '@piwin/artifact';
import { Button, PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ArtifactFrame } from './ArtifactFrame.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeRenderDecision(): Extract<ArtifactPreviewDecision, { kind: 'render' }> {
  return {
    kind: 'render',
    mode: 'interactive',
    descriptor: {
      id: 'artifact-test-1',
      type: 'html',
      title: 'piwin architecture (simplified)',
      rawLanguage: 'artifact-html',
      alias: 'artifact-html',
      surface: 'inline',
      source: '<div class="diagram">wide content</div>',
    },
    security: {
      canRender: true,
      blockReason: null,
      byteSize: 42,
      externalResources: [],
    },
    srcdoc: '<!DOCTYPE html><html><body><div class="diagram">wide content</div></body></html>',
    renderSource: '<div class="diagram">wide content</div>',
    csp: "default-src 'none'",
    themeRepairs: [],
    layoutRepairs: [],
  };
}

function makeStreamDecision(
  source: string,
  srcdoc: string,
): Extract<ArtifactPreviewDecision, { kind: 'render' }> {
  const decision = makeRenderDecision();
  return {
    ...decision,
    mode: 'stream-preview',
    descriptor: {
      ...decision.descriptor,
      source,
    },
    srcdoc,
    streamSource: source,
    renderSource: source,
  };
}

function makePreparingDecision(): Extract<ArtifactPreviewDecision, { kind: 'preparing' }> {
  return {
    kind: 'preparing',
    descriptor: {
      id: 'artifact-preparing-svg',
      type: 'svg',
      title: 'Slow SVG',
      rawLanguage: 'svg',
      alias: 'svg',
      surface: 'inline',
      source: '<svg',
    },
    message: 'Generating SVG…',
  };
}

type FrameDecision = Exclude<ArtifactPreviewDecision, { kind: 'code' }>;

function renderFrame(
  decision: FrameDecision = makeRenderDecision(),
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
            decision={decision}
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
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('shows localized Artifact sheen before the first safe preview snapshot', () => {
    const instance = renderFrame(makePreparingDecision(), 'inline', undefined, 'zh-CN');
    instances.push(instance);
    const frame = instance.container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');

    expect(frame?.classList.contains('preparing')).toBe(true);
    expect(frame?.getAttribute('data-activity-animation')).toBe('artifact-sheen');
    expect(frame?.textContent).toContain('正在生成 SVG');
    expect(frame?.textContent).toContain('首个可安全渲染的内容准备好后会自动显示');
    expect(frame?.querySelector('.artifact-preparing-sheen')).not.toBeNull();
    expect(frame?.querySelector('iframe')).toBeNull();
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
    expect(frame?.classList.contains('is-expanded')).toBe(false);
    expect(frame?.hasAttribute('data-expanded')).toBe(false);
    // Source lives behind Show code from MarkdownView; no expand height toggle.
    expect(container.querySelector('[data-testid="artifact-expand-toggle"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  it('removes the permanent title bar and keeps only a floating action layer', async () => {
    const { container, root } = renderFrame(
      makeRenderDecision(),
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
    const decision = makeRenderDecision();
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
            type: 'piwin-artifact:resize',
            channelId: decision.descriptor.id,
            height: 1_480,
            mode: 'normal',
          },
        }),
      );
    });

    // Non-ready resizes are rAF + 120ms coalesced (owi bridge throttle).
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 140));
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

  it('applies height bridge messages when event.source is not contentWindow (Tauri package)', async () => {
    // Packaged Tauri custom-protocol sandboxed srcdoc often fails
    // event.source === iframe.contentWindow. Height must still apply via channelId.
    const decision = makeRenderDecision();
    const { container, root } = renderFrame(decision);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          // Deliberately wrong / foreign source — mimics WindowProxy mismatch.
          source: window,
          data: {
            type: 'piwin-artifact:resize',
            channelId: decision.descriptor.id,
            height: 920,
            mode: 'normal',
          },
        }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 140));
    });

    const stage = container.querySelector('.artifact-iframe-stage') as HTMLElement | null;
    expect(stage?.style.height).toBe('920px');
  });

  it('seeds SVG stage height from viewBox so the first paint is not an 80px strip', async () => {
    const base = makeRenderDecision();
    const decision: Extract<ArtifactPreviewDecision, { kind: 'render' }> = {
      ...base,
      descriptor: {
        ...base.descriptor,
        id: 'svg-seed-1',
        type: 'svg',
        rawLanguage: 'svg',
        alias: 'svg',
        source: '<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="400"/></svg>',
      },
      renderSource:
        '<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="400"/></svg>',
      srcdoc: '<!DOCTYPE html><html><body><svg viewBox="0 0 800 400"></svg></body></html>',
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

  it('reuses one stream iframe and posts body snapshots instead of replacing srcdoc', async () => {
    const initial = makeStreamDecision('<div><p>Hel</p></div>', '<html>initial stream</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const contentWindow = iframe?.contentWindow;
    expect(contentWindow).not.toBeNull();
    const postMessage = vi.spyOn(contentWindow as Window, 'postMessage');
    const next = makeStreamDecision(
      '<div><p>Hello</p><section>Next</section></div>',
      '<html>replacement must not mount</html>',
    );

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame decision={next} />
        </PiwinUiProvider>,
      );
    });

    // First stream snapshot is immediate; subsequent ones throttle at 300ms.
    // A near-immediate follow-up still posts once the throttle window opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    const updatedIframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(updatedIframe).toBe(iframe);
    expect(updatedIframe?.getAttribute('srcdoc')).toBe('<html>initial stream</html>');
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'piwin-artifact:stream-update',
        channelId: 'artifact-test-1',
        source: next.streamSource,
      },
      '*',
    );
  });

  it('commits the final source inside the existing stream iframe without replacing srcdoc', async () => {
    const initial = makeStreamDecision('<div><p>Hel</p></div>', '<html>stable stream shell</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const finalSource =
      '<div><p>Hello</p><button>Done</button></div><script>window.done=true</script>';
    const finalDecision: Extract<ArtifactPreviewDecision, { kind: 'render' }> = {
      ...makeRenderDecision(),
      descriptor: {
        ...makeRenderDecision().descriptor,
        source: finalSource,
      },
      srcdoc: '<html>replacement final document must not mount</html>',
      renderSource: finalSource,
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame decision={finalDecision} />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const completedIframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(completedIframe).toBe(iframe);
    expect(completedIframe?.getAttribute('srcdoc')).toBe('<html>stable stream shell</html>');
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'piwin-artifact:stream-update',
        channelId: 'artifact-test-1',
        source: finalSource,
        final: true,
      },
      '*',
    );
  });

  it('keeps stream-preview height grow-only after the first ready (no final-trim shrink)', async () => {
    const decision = makeStreamDecision('<svg viewBox="0 0 10 10"></svg>', '<html>stream</html>');
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
            type: 'piwin-artifact:ready',
            channelId: 'artifact-test-1',
            height: 240,
          },
        }),
      );
    });
    const stage = container.querySelector('.artifact-iframe-stage') as HTMLElement | null;
    expect(stage?.style.height).toBe('240px');

    // A later smaller measure must not shrink the stream frame (would flicker).
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: {
            type: 'piwin-artifact:resize',
            channelId: 'artifact-test-1',
            height: 120,
            mode: 'normal',
          },
        }),
      );
    });
    expect(stage?.style.height).toBe('240px');
  });

  it('applies the canvas presentation class without expand chrome', async () => {
    const { container, root } = renderFrame(makeRenderDecision(), 'canvas');
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
    const decision = makeRenderDecision();
    const { container, root } = renderFrame(decision, 'inline');
    instances.push({ container, root });
    // Override with the proposal handler via a second render.
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame
              decision={decision}
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
    const decision = makeRenderDecision();
    const { container, root } = renderFrame(decision, 'canvas');
    instances.push({ container, root });
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame
              decision={decision}
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

  it('shows a loading shell instead of a blank frame while the iframe paints', async () => {
    const { container, root } = renderFrame();
    instances.push({ container, root });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const host = container
      .querySelector('[data-testid="artifact-frame"]')
      ?.getAttribute('data-artifact-host');
    // Before ready/onLoad paint, loading shell is required (never pure blank).
    if (host === 'loading' || container.querySelector('iframe.is-pending-paint')) {
      expect(container.querySelector('[data-testid="artifact-iframe-loading"]')).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="artifact-frame"]')).not.toBeNull();
  });

  it('offers Load preview when the live budget rejects the frame', async () => {
    const { MAX_LIVE_ARTIFACT_IFRAMES, claimArtifactLiveHost, releaseArtifactLiveHost } =
      await import('@piwin/artifact');
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
    releaseArtifactLiveHost('force-fill-0');
    const loadBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-load-preview"]',
    );
    await act(async () => {
      loadBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    // After admit, either iframe or loading shell (still painting).
    expect(
      container.querySelector('iframe.artifact-iframe') !== null ||
        container.querySelector('[data-testid="artifact-iframe-loading"]') !== null ||
        container
          .querySelector('[data-testid="artifact-frame"]')
          ?.getAttribute('data-artifact-host') === 'live' ||
        container
          .querySelector('[data-testid="artifact-frame"]')
          ?.getAttribute('data-artifact-host') === 'loading',
    ).toBe(true);
  });
});
