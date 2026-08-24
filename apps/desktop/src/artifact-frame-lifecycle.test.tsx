/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactCapabilityReport, ArtifactRenderPlan } from '@piwin/artifact';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ArtifactFrame } from './ArtifactFrame.js';
import { ARTIFACT_INIT_LEASE_TIMEOUT_MS } from './artifact-frame-lifecycle.js';
import {
  getActiveArtifactInitCount,
  resetArtifactInitQueueForTests,
} from './artifact-init-queue.js';
import {
  MAX_LIVE_ARTIFACT_IFRAMES,
  claimArtifactLiveHost,
  resetArtifactLiveHostRegistryForTests,
} from './artifact-live-host-registry.js';

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

function makePlan(
  id: string,
  mode: 'interactive' | 'stream-preview' = 'interactive',
): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const source = `<div>${id}</div><script>window.ready = true</script>`;
  return {
    kind: 'render',
    intent: {
      descriptor: {
        id,
        type: 'html',
        title: id,
        rawLanguage: 'artifact-html',
        alias: 'artifact-html',
        declaration: 'explicit',
        documentKind: 'fragment',
        surface: 'inline',
        source,
      },
      capabilities: EMPTY_CAPABILITIES,
      surface: 'inline',
      layout: 'flow',
      renderer: 'sandbox',
    },
    frameMode: 'inline-flow',
    mode,
    renderSource: source,
    document: {
      kind: 'sandbox',
      srcdoc: `<!DOCTYPE html><html><body>${source}</body></html>`,
      csp: "default-src 'none'",
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('artifact frame init lease timeout', () => {
  let previousActEnvironment: boolean | undefined;
  const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
  });

  afterEach(() => {
    for (const { container, root } of mounted) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    mounted.length = 0;
    vi.useRealTimers();
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('releases a stuck init lease so a second iframe can start', async () => {
    vi.useFakeTimers();
    const firstContainer = document.createElement('div');
    document.body.appendChild(firstContainer);
    const firstRoot = createRoot(firstContainer);
    mounted.push({ container: firstContainer, root: firstRoot });
    act(() => {
      firstRoot.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={makePlan('lease-a')} />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firstContainer.querySelector('iframe.artifact-iframe')).not.toBeNull();
    expect(getActiveArtifactInitCount()).toBe(1);

    const secondContainer = document.createElement('div');
    document.body.appendChild(secondContainer);
    const secondRoot = createRoot(secondContainer);
    mounted.push({ container: secondContainer, root: secondRoot });
    act(() => {
      secondRoot.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={makePlan('lease-b')} />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(secondContainer.querySelector('iframe.artifact-iframe')).toBeNull();
    expect(getActiveArtifactInitCount()).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(ARTIFACT_INIT_LEASE_TIMEOUT_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(secondContainer.querySelector('iframe.artifact-iframe')).not.toBeNull();
  });

  it('keeps the completing sandbox iframe when the live set is full of forceKeep hosts', async () => {
    for (let index = 0; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `force-fill-${index}`,
        forceKeep: true,
        priority: 1_000,
        evict: () => undefined,
      });
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const streaming = makePlan('stream-complete', 'stream-preview');
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={streaming} />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await flush();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-artifact-host'),
    ).toBe('live');

    const completed: Extract<ArtifactRenderPlan, { kind: 'render' }> = {
      ...streaming,
      mode: 'interactive',
    };
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={completed} />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await flush();
    expect(container.querySelector('iframe.artifact-iframe')).toBe(iframe);
    expect(container.querySelector('[data-testid="artifact-iframe-placeholder"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-artifact-host'),
    ).toBe('live');
  });

  it('posts a frameMode snapshot for a never-streamed sandbox', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const interactive = makePlan('never-streamed');
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={interactive} />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await flush();
    const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    const viewport: Extract<ArtifactRenderPlan, { kind: 'render' }> = {
      ...interactive,
      frameMode: 'inline-viewport',
      intent: { ...interactive.intent, layout: 'viewport' },
    };
    act(() => {
      root.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ArtifactFrame plan={viewport} />
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    await flush();
    expect(iframe?.getAttribute('data-frame-mode')).toBe('inline-viewport');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'piwin-artifact:stream-update',
        frameMode: 'inline-viewport',
      }),
      '*',
    );
  });
});
