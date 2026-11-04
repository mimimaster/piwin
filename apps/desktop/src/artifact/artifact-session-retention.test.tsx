// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactRenderPlan } from '@piwin/artifact';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { MediaPreviewReadProvider } from '../media/media-preview-read-context.js';
import {
  sessionRenderResources,
  sessionRenderResourceKey,
} from '../session/session-render-resources.js';
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { ArtifactFrame } from './ArtifactFrame.js';
import {
  installArtifactMemoryBridge,
  uninstallArtifactMemoryBridge,
} from './artifact-memory-bridge.js';
import { resetArtifactInitQueueForTests } from './artifact-init-queue.js';
import { resetArtifactLiveHostRegistryForTests } from './artifact-live-host-registry.js';

vi.mock('./artifact-native-bridge.js', () => ({
  subscribeNativeArtifactBridge: vi.fn(async () => () => undefined),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function plan(id: string): Extract<ArtifactRenderPlan, { kind: 'render' }> {
  const source = `<div>${id}</div><script>window.ready = true</script>`;
  return {
    kind: 'render',
    mode: 'interactive',
    frameMode: 'inline-flow',
    renderSource: source,
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
      capabilities: {
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
        byteSize: source.length,
        externalResources: [],
      },
      surface: 'inline',
      layout: 'flow',
      renderer: 'sandbox',
    },
    document: {
      kind: 'sandbox',
      srcdoc: `<!doctype html><html><body>${source}</body></html>`,
      csp: "default-src 'none'",
    },
  };
}

describe('session-owned Artifact retention', () => {
  let root: Root;
  let container: HTMLDivElement;
  const first = plan('first');
  const second = plan('second');
  beforeEach(() => {
    vi.useFakeTimers();
    sessionRenderResources.reset();
    resetArtifactLiveHostRegistryForTests();
    resetArtifactInitQueueForTests();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    installArtifactMemoryBridge();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    uninstallArtifactMemoryBridge();
    globalMemoryGovernor.reset();
    sessionRenderResources.reset();
    resetArtifactLiveHostRegistryForTests();
    resetArtifactInitQueueForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  async function render(
    selected: string,
    presentation: 'inline' | 'canvas' = 'inline',
  ): Promise<void> {
    await act(async () => {
      sessionRenderResources.setVisible([sessionRenderResourceKey('local', selected)]);
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          {(['first', 'second'] as const).map((id) => (
            <section key={id} data-session={id} hidden={id !== selected}>
              <textarea data-testid={`draft-${id}`} defaultValue={`unsent ${id}`} />
              <MediaPreviewReadProvider sessionId={id} readMedia={null} resourceHostKey="local">
                <ArtifactFrame plan={id === 'first' ? first : second} presentation={presentation} />
              </MediaPreviewReadProvider>
            </section>
          ))}
        </PiwinUiProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  async function idle(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  function iframe(id: string): HTMLIFrameElement {
    const element = container.querySelector<HTMLIFrameElement>(
      `[data-session="${id}"] iframe.artifact-iframe:not(.artifact-iframe--outgoing)`,
    );
    if (!element) throw new Error(`missing ${id} iframe`);
    return element;
  }

  it.each(['inline', 'canvas'] as const)(
    'keeps the current %s iframe unchanged during critical pressure',
    async (presentation) => {
      await render('first', presentation);
      const current = iframe('first');
      current.dataset.readerState = 'keep';
      act(() => globalMemoryGovernor.setLevel('critical'));
      await idle();
      expect(iframe('first')).toBe(current);
      expect(iframe('first').dataset.readerState).toBe('keep');
      expect(container.querySelector('[data-session="second"] iframe')).toBeNull();
      expect(
        container.querySelector<HTMLTextAreaElement>('[data-testid="draft-second"]')?.value,
      ).toBe('unsent second');
    },
  );

  it('releases a session only after leaving it and restores its preview on return', async () => {
    await render('first');
    await idle();
    const previous = iframe('first');
    await render('second');
    await idle();
    expect(container.querySelector('[data-session="first"] iframe')).toBeNull();
    const current = iframe('second');
    act(() => globalMemoryGovernor.setLevel('critical'));
    await idle();
    expect(iframe('second')).toBe(current);
    await render('first');
    await idle();
    expect(iframe('first')).not.toBe(previous);
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="draft-first"]')?.value).toBe(
      'unsent first',
    );
  });

  it('cancels stale cleanup when the reader switches back before idle', async () => {
    await render('first');
    const current = iframe('first');
    await render('second');
    await render('first');
    await idle();
    expect(iframe('first')).toBe(current);
  });
});
