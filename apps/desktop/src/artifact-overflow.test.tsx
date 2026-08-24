/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  resolveArtifactViewportFrameHeight,
  type ArtifactCapabilityReport,
  type ArtifactRenderPlan,
} from '@piwin/artifact';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ArtifactFrame } from './ArtifactFrame.js';
import { resetArtifactInitQueueForTests } from './artifact-init-queue.js';
import { resetArtifactLiveHostRegistryForTests } from './artifact-live-host-registry.js';
import { subscribeNativeArtifactBridge } from './artifact-native-bridge.js';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';

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

function makeRenderPlan(
  id = 'artifact-overflow-1',
): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const source = '<div class="tall">overflow candidate</div>';
  const descriptor = {
    id,
    type: 'html' as const,
    title: 'Tall artifact',
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
      srcdoc: '<!DOCTYPE html><html><body><div class="tall">overflow candidate</div></body></html>',
      csp: "default-src 'none'",
    },
  };
}

function makeStreamPlan(
  source: string,
  srcdoc = '<html>stream shell</html>',
): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const plan = makeRenderPlan();
  return {
    ...plan,
    mode: 'stream-preview',
    intent: {
      ...plan.intent,
      descriptor: { ...plan.intent.descriptor, source },
      renderer: 'sandbox',
    },
    renderSource: source,
    document: { kind: 'sandbox', srcdoc, csp: "default-src 'none'" },
  };
}

function isSnapshotPost(data: unknown): data is Record<string, unknown> {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const record = data as Record<string, unknown>;
  return record['type'] === 'piwin-artifact:stream-update';
}

function snapshotPosts(postMessage: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return postMessage.mock.calls.map((call) => call[0]).filter(isSnapshotPost);
}

function renderFrame(
  plan: Extract<ArtifactRenderPlan, { kind: 'render' }> = makeRenderPlan(),
  locale: 'zh-CN' | 'en' = 'en',
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      (
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={plan} locale={locale} />
        </PiwinUiProvider>
      ) as ReactElement,
    );
  });
  return { container, root };
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dispatchSize(
  iframe: HTMLIFrameElement | null,
  channelId: string,
  height: number,
  revision: number,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: iframe?.contentWindow ?? null,
      data: {
        type: 'piwin-artifact:size',
        channelId,
        height,
        viewportHeight: 80,
        revision,
      },
    }),
  );
}

describe('artifact overflow reachability', () => {
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
    vi.restoreAllMocks();
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('keeps the 16,384px cap in flow without entering overflow', async () => {
    const plan = makeRenderPlan();
    const { container, root } = renderFrame(plan);
    instances.push({ container, root });
    await flushFrame();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    act(() => {
      dispatchSize(iframe, plan.intent.descriptor.id, MAX_ARTIFACT_INLINE_FLOW_HEIGHT, 0);
    });
    const frame = container.querySelector('[data-testid="artifact-frame"]');
    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-flow');
    expect(frame?.getAttribute('data-content-height')).toBe(String(MAX_ARTIFACT_INLINE_FLOW_HEIGHT));
    expect(stage?.style.height).toBe(`${MAX_ARTIFACT_INLINE_FLOW_HEIGHT}px`);
    expect(container.querySelector('[data-testid="artifact-overflow-hint"]')).toBeNull();
  });

  it('upgrades flow to overflow from raw contentHeight and keeps that raw value', async () => {
    const plan = makeRenderPlan();
    const { container, root } = renderFrame(plan);
    instances.push({ container, root });
    await flushFrame();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    act(() => {
      dispatchSize(iframe, plan.intent.descriptor.id, 20_000, 0);
    });

    const frame = container.querySelector('[data-testid="artifact-frame"]');
    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    const chrome = resolveArtifactViewportFrameHeight(window.innerHeight);
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-overflow');
    expect(iframe?.getAttribute('data-frame-mode')).toBe('inline-overflow');
    expect(frame?.getAttribute('data-content-height')).toBe('20000');
    expect(stage?.style.height).toBe(`${chrome}px`);
    expect(stage?.style.maxHeight).toBe(`${chrome}px`);
    expect(stage?.style.height).not.toBe(`${MAX_ARTIFACT_INLINE_FLOW_HEIGHT}px`);
    const hint = container.querySelector('[data-testid="artifact-overflow-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.getAttribute('tabindex')).toBeNull();
    expect(hint?.getAttribute('aria-modal')).toBeNull();
    expect(hint?.textContent).toBe(artifactOverflowHintCopy('en'));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'piwin-artifact:stream-update',
        frameMode: 'inline-overflow',
      }),
      '*',
    );
  });

  it('posts the overflow snapshot in the same turn as the chrome clamp, not 300ms later', async () => {
    const plan = makeStreamPlan('<div>growing</div>');
    const { container, root } = renderFrame(plan);
    instances.push({ container, root });
    await flushFrame();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    act(() => {
      dispatchSize(iframe, plan.intent.descriptor.id, 8_000, 0);
      dispatchSize(iframe, plan.intent.descriptor.id, 20_000, 1);
    });
    const snapshots = snapshotPosts(postMessage);
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-frame-mode'),
    ).toBe('inline-overflow');
    expect(snapshots.some((snapshot) => snapshot['frameMode'] === 'inline-overflow')).toBe(true);
    expect(postMessage.mock.calls.length).toBeLessThan(4);
  });

  it('soaks coalesced growth through 16,384 without a flow-hidden crop or revision runaway', async () => {
    const initial = makeStreamPlan('<div>delta-0</div>', '<html>stable stream</html>');
    const { container, root } = renderFrame(initial);
    instances.push({ container, root });
    await flushFrame();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const chrome = resolveArtifactViewportFrameHeight(window.innerHeight);

    act(() => {
      dispatchSize(iframe, initial.intent.descriptor.id, 1_200, 0);
      dispatchSize(iframe, initial.intent.descriptor.id, 8_000, 1);
      dispatchSize(iframe, initial.intent.descriptor.id, MAX_ARTIFACT_INLINE_FLOW_HEIGHT, 2);
    });
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-frame-mode'),
    ).toBe('inline-flow');

    act(() => {
      dispatchSize(iframe, initial.intent.descriptor.id, MAX_ARTIFACT_INLINE_FLOW_HEIGHT + 1, 3);
    });
    const frame = container.querySelector('[data-testid="artifact-frame"]');
    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-overflow');
    expect(iframe?.getAttribute('data-frame-mode')).toBe('inline-overflow');
    expect(stage?.style.height).toBe(`${chrome}px`);
    expect(snapshotPosts(postMessage).filter((snapshot) => snapshot['frameMode'] === 'inline-overflow')).toHaveLength(1);

    act(() => {
      dispatchSize(iframe, initial.intent.descriptor.id, 20_000, 4);
      dispatchSize(iframe, initial.intent.descriptor.id, 120, 5);
      dispatchSize(iframe, initial.intent.descriptor.id, 24_000, 6);
    });
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ArtifactFrame plan={makeStreamPlan('<div>delta-1</div>', '<html>stable stream</html>')} />
        </PiwinUiProvider>,
      );
    });

    const snapshots = snapshotPosts(postMessage);
    const overflowIndex = snapshots.findIndex((snapshot) => snapshot['frameMode'] === 'inline-overflow');
    expect(overflowIndex).toBeGreaterThanOrEqual(0);
    expect(
      snapshots.slice(overflowIndex).every((snapshot) => snapshot['frameMode'] === 'inline-overflow'),
    ).toBe(true);
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-overflow');
    expect(stage?.style.height).toBe(`${chrome}px`);
    const revisions = snapshots
      .map((snapshot) => snapshot['revision'])
      .filter((revision): revision is number => typeof revision === 'number');
    expect(Math.max(...revisions) - Math.min(...revisions)).toBeLessThan(8);
    expect(snapshots.length).toBeLessThan(6);
  });

  it('does not oscillate back to flow after a later shorter height', async () => {
    const plan = makeRenderPlan();
    const { container, root } = renderFrame(plan);
    instances.push({ container, root });
    await flushFrame();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    act(() => {
      dispatchSize(iframe, plan.intent.descriptor.id, 20_000, 0);
    });
    await flushFrame();
    act(() => {
      dispatchSize(iframe, plan.intent.descriptor.id, 120, 1);
    });
    await flushFrame();
    const frame = container.querySelector('[data-testid="artifact-frame"]');
    const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
    const chrome = resolveArtifactViewportFrameHeight(window.innerHeight);
    expect(frame?.getAttribute('data-frame-mode')).toBe('inline-overflow');
    expect(frame?.getAttribute('data-content-height')).toBe('20000');
    expect(stage?.style.height).toBe(`${chrome}px`);
  });

  it('does not trap focus in the overflow hint', async () => {
    const plan = makeRenderPlan();
    const { container, root } = renderFrame(plan);
    instances.push({ container, root });
    await flushFrame();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    act(() => {
      dispatchSize(iframe, plan.intent.descriptor.id, 20_000, 0);
    });
    await flushFrame();
    const hint = container.querySelector('[data-testid="artifact-overflow-hint"]');
    expect(hint?.closest('[role="dialog"]')).toBeNull();
    expect(hint?.getAttribute('tabindex')).toBeNull();
    const focusableInHint = hint?.querySelectorAll('a,button,input,select,textarea,[tabindex]');
    expect(focusableInHint?.length ?? 0).toBe(0);
  });
});
