/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactPreviewDecision } from '@piwin/artifact';
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
  };
}

function renderFrame(
  decision: ArtifactPreviewDecision = makeRenderDecision(),
  presentation: 'inline' | 'canvas' = 'inline',
  extraHeaderAction?: ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame
            decision={decision as Extract<ArtifactPreviewDecision, { kind: 'render' }>}
            presentation={presentation}
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
  });

  afterEach(() => {
    for (const { container, root } of instances) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
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

    expect(iframe?.style.height).toBe('1480px');
    expect(iframe?.style.maxHeight).toBe('16384px');
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.hasAttribute(
        'data-content-overflowing',
      ),
    ).toBe(false);
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

    const updatedIframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(updatedIframe).toBe(iframe);
    expect(updatedIframe?.getAttribute('srcdoc')).toBe('<html>initial stream</html>');
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'piwin-artifact:stream-update',
        channelId: 'artifact-test-1-stream',
        source: next.streamSource,
      },
      '*',
    );
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
          source: (iframe?.contentWindow ?? null),
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
          source: (iframe?.contentWindow ?? null),
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
});
