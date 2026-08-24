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
import { resetArtifactLiveHostRegistryForTests } from './artifact-live-host-registry.js';

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

function makePlan(id: string): Extract<ArtifactRenderPlan, { kind: 'render' }> {
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
    mode: 'interactive',
    renderSource: source,
    document: {
      kind: 'sandbox',
      srcdoc: `<!DOCTYPE html><html><body>${source}</body></html>`,
      csp: "default-src 'none'",
    },
  };
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
});
