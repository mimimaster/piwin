// @vitest-environment happy-dom
/**
 * ArtifactCanvasPanel — right-side Canvas shell rendering + empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import {
  analyzeArtifactFence,
  createArtifactFenceRecord,
  COMPOSER_PROPOSE_TEXT_ACTION,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  type ArtifactRenderIntent,
} from '@piwin/artifact';
import { ArtifactCanvasPanel } from './artifact-canvas-panel';
import { ArtifactFrame } from './ArtifactFrame';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeIntent(source = '<div class="config">stack</div>'): ArtifactRenderIntent {
  const analysis = analyzeArtifactFence(
    createArtifactFenceRecord({
      info: 'artifact-html title="Deployment configurator" surface="canvas"',
      source,
    }),
    { id: 'artifact-s1-m1-0', htmlUiModeEnabled: true },
  );
  if (analysis.kind !== 'intent') {
    throw new Error(`expected canvas intent, got ${analysis.kind}`);
  }
  return analysis.intent;
}

function makeTarget(overrides: Partial<ArtifactCanvasTarget> = {}): ArtifactCanvasTarget {
  const source = overrides.source ?? '<div class="config">stack</div>';
  const intent = overrides.intent ?? makeIntent(source);
  return {
    id: 'canvas:s1:m1:0',
    sessionId: 's1',
    messageId: 'm1',
    fenceIndex: 0,
    channelId: 'artifact-s1-m1-0',
    surface: 'canvas',
    title: 'Deployment configurator',
    type: 'html',
    declaration: 'explicit',
    documentKind: 'fragment',
    rawLanguage: 'artifact-html',
    source,
    intent,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ArtifactCanvasPanel>[0]> = {}): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactCanvasPanel activeTarget={null} {...props} />
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

describe('ArtifactCanvasPanel', () => {
  let previousActEnvironment: boolean | undefined;
  let instances: { container: HTMLDivElement; root: Root }[] = [];

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

  it('shows an empty state when no target is active (no stale source)', () => {
    const { container, root } = renderPanel();
    instances.push({ container, root });
    expect(container.querySelector('[data-testid="artifact-canvas-empty"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders the active target through ArtifactFrame in canvas presentation', async () => {
    const { container, root } = renderPanel({ activeTarget: makeTarget() });
    instances.push({ container, root });
    // Init queue is async; wait for grant + iframe.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const frame = container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.classList.contains('presentation-canvas')).toBe(true);
    // Render frames no longer ship Expand/Collapse or raw-source disclosure.
    expect(container.querySelector('[data-testid="artifact-expand-toggle"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  it('does not mount an inline-style iframe (canvas fills the panel body)', async () => {
    const { container, root } = renderPanel({ activeTarget: makeTarget() });
    instances.push({ container, root });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.style.height).toBe('100%');
    expect(iframe?.style.width).toBe('100%');
  });

  it('renders a blocked analysis without mounting an iframe', () => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({
        info: 'artifact-html title="Remote" surface="canvas"',
        source: '<iframe src="https://evil.example.com/"></iframe>',
      }),
      { id: 'artifact-s1-m1-0' },
    );
    expect(analysis.kind).toBe('blocked');
    if (analysis.kind !== 'blocked') return;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    instances.push({ container, root });
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={analysis} presentation="canvas" />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    expect(container.querySelector('.artifact-frame.blocked')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('blocked');
  });

  it('shows a Composer proposal review card when the iframe posts composer/propose-text', async () => {
    const target = makeTarget();
    const { container, root } = renderPanel({ activeTarget: target });
    instances.push({ container, root });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const proposal = {
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId: 'artifact-s1-m1-0',
      action: COMPOSER_PROPOSE_TEXT_ACTION,
      payload: { text: 'Use React + pnpm.', label: 'Use stack' },
    };
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe?.contentWindow ?? null,
          data: proposal,
        }),
      );
    });
    expect(container.querySelector('[data-testid="artifact-canvas-proposal"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-canvas-proposal-text"]')?.textContent,
    ).toContain('Use React + pnpm.');
  });

  it('Insert into Composer invokes onInsertProposal exactly once and clears the card', async () => {
    const onInsertProposal = vi.fn();
    const target = makeTarget();
    const { container, root } = renderPanel({ activeTarget: target, onInsertProposal });
    instances.push({ container, root });
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
            type: ARTIFACT_BRIDGE_ACTION_TYPE,
            channelId: 'artifact-s1-m1-0',
            action: COMPOSER_PROPOSE_TEXT_ACTION,
            payload: { text: 'Use React.' },
          },
        }),
      );
    });
    const insertBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-canvas-proposal-insert"]',
    );
    expect(insertBtn).not.toBeNull();
    act(() => {
      insertBtn?.click();
    });
    expect(onInsertProposal).toHaveBeenCalledTimes(1);
    expect(onInsertProposal).toHaveBeenCalledWith({ text: 'Use React.' });
    // Card cleared after insertion.
    expect(container.querySelector('[data-testid="artifact-canvas-proposal"]')).toBeNull();
  });

  it('Dismiss clears the proposal without invoking onInsertProposal', async () => {
    const onInsertProposal = vi.fn();
    const target = makeTarget();
    const { container, root } = renderPanel({ activeTarget: target, onInsertProposal });
    instances.push({ container, root });
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
            type: ARTIFACT_BRIDGE_ACTION_TYPE,
            channelId: 'artifact-s1-m1-0',
            action: COMPOSER_PROPOSE_TEXT_ACTION,
            payload: { text: 'Use React.' },
          },
        }),
      );
    });
    const dismissBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="artifact-canvas-proposal-dismiss"]',
    );
    act(() => {
      dismissBtn?.click();
    });
    expect(onInsertProposal).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="artifact-canvas-proposal"]')).toBeNull();
  });

  it('ignores composer/propose-text from a mismatched channelId', async () => {
    const target = makeTarget();
    const { container, root } = renderPanel({ activeTarget: target });
    instances.push({ container, root });
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
            type: ARTIFACT_BRIDGE_ACTION_TYPE,
            channelId: 'fence-99',
            action: COMPOSER_PROPOSE_TEXT_ACTION,
            payload: { text: 'Use React.' },
          },
        }),
      );
    });
    expect(container.querySelector('[data-testid="artifact-canvas-proposal"]')).toBeNull();
  });
});
