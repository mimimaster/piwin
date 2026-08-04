/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactPreviewDecision } from '@piwin/artifact';
import { PiwinUiProvider } from '@piwin/ui-kit';
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

function renderFrame(
  decision: ArtifactPreviewDecision = makeRenderDecision(),
  presentation: 'inline' | 'canvas' = 'inline',
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
          />
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

describe('ArtifactFrame expand', () => {
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

  it('toggles full-bleed expanded class for chat-stage width expand', async () => {
    const { container, root } = renderFrame();
    instances.push({ container, root });

    // Init queue is async; wait for grant + frame.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const frame = container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-expand-toggle"]',
    );
    expect(frame).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(frame?.classList.contains('is-expanded')).toBe(false);
    expect(frame?.getAttribute('data-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      toggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(frame?.classList.contains('is-expanded')).toBe(true);
    expect(frame?.getAttribute('data-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(toggle?.textContent).toContain('Collapse');

    await act(async () => {
      toggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(frame?.classList.contains('is-expanded')).toBe(false);
    expect(frame?.getAttribute('data-expanded')).toBe('false');
    expect(toggle?.textContent).toContain('Expand');
  });

  it('hides inline chrome and applies the canvas presentation class', async () => {
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
    // No Inline chrome: no Expand/Collapse toggle, no raw-source disclosure.
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
