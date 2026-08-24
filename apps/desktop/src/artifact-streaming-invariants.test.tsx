// @vitest-environment happy-dom
/**
 * Phase 0 lock: record iframe identity, renderer, layout, stage height, and
 * last-item reachability across streaming deltas. Does not change product code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetArtifactInitQueueForTests } from './artifact-init-queue.js';
import { resetArtifactLiveHostRegistryForTests } from './artifact-live-host-registry.js';
import { STREAMING_DELTA_STEPS } from '@piwin/artifact/fixtures';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { MarkdownView } from './MarkdownView';

vi.mock('./artifact-native-bridge.js', () => ({
  subscribeNativeArtifactBridge: vi.fn(async () => () => undefined),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type StreamRecord = {
  iframe: HTMLIFrameElement | null;
  liveHost: HTMLElement | null;
  channelId: string | null;
  renderer: string | null;
  layout: string | null;
  stageHeight: string | null;
  flashingSource: boolean;
  endReachable: boolean;
};

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderView(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  const render = { container, root };
  mounted.push(render);
  return render;
}

function snapshot(container: HTMLElement): StreamRecord {
  const liveHost = container.querySelector<HTMLElement>('[data-testid="artifact-stream-live"]');
  const frame = container.querySelector<HTMLElement>('[data-testid="artifact-frame"]');
  const iframe = container.querySelector<HTMLIFrameElement>('iframe.artifact-iframe');
  const stage = container.querySelector<HTMLElement>('.artifact-iframe-stage');
  const endInHost = Boolean(container.querySelector('[data-artifact-end]'));
  const endInFrame = Boolean(iframe?.contentDocument?.querySelector('[data-artifact-end]'));
  return {
    iframe,
    liveHost,
    channelId: liveHost?.getAttribute('data-artifact-id') ?? frame?.getAttribute('data-artifact-id') ?? null,
    renderer: frame?.getAttribute('data-artifact-renderer') ?? null,
    layout: frame?.getAttribute('data-artifact-layout') ?? null,
    stageHeight: stage?.style.height || null,
    flashingSource: container.querySelector('[data-testid="code-fence-streaming"]') !== null,
    endReachable: endInHost || endInFrame,
  };
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function playDeltas(
  container: HTMLElement,
  root: Root,
): Promise<StreamRecord[]> {
  const records: StreamRecord[] = [snapshot(container)];
  for (const step of STREAMING_DELTA_STEPS.slice(1)) {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView
            text={step.text}
            renderingPhase={step.phase}
            artifactOrigin={{ sessionId: 's-stream', messageId: 'm-stream-record' }}
          />
        </PiwinUiProvider>,
      );
    });
    await flushFrame();
    records.push(snapshot(container));
  }
  return records;
}

describe('Artifact streaming delta records', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
  });

  afterEach(() => {
    while (mounted.length > 0) {
      const render = mounted.pop();
      if (!render) continue;
      act(() => {
        render.root.unmount();
      });
      render.container.remove();
    }
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('records sandbox renderer, inline layout, channel id, and iframe identity while tokens stream', async () => {
    const first = STREAMING_DELTA_STEPS[0];
    if (!first) throw new Error('missing streaming fixture');
    const { container, root } = renderView(
      <MarkdownView
        text={first.text}
        renderingPhase={first.phase}
        artifactOrigin={{ sessionId: 's-stream', messageId: 'm-stream-record' }}
      />,
    );
    await flushFrame();
    const firstSnap = snapshot(container);
    const mid = STREAMING_DELTA_STEPS[1];
    if (!mid) throw new Error('missing streaming mid delta');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView
            text={mid.text}
            renderingPhase={mid.phase}
            artifactOrigin={{ sessionId: 's-stream', messageId: 'm-stream-record' }}
          />
        </PiwinUiProvider>,
      );
    });
    await flushFrame();
    const midSnap = snapshot(container);

    expect(firstSnap.iframe).not.toBeNull();
    expect(firstSnap.liveHost).not.toBeNull();
    expect(firstSnap.channelId).toBe('m-stream-record-artifact-0');
    expect(firstSnap.renderer).toBe('sandbox');
    expect(firstSnap.layout).toBe('inline');
    expect(firstSnap.stageHeight).toBeTruthy();
    expect(firstSnap.flashingSource).toBe(false);
    expect(midSnap.iframe).toBe(firstSnap.iframe);
    expect(midSnap.liveHost).toBe(firstSnap.liveHost);
    expect(midSnap.channelId).toBe(firstSnap.channelId);
    expect(midSnap.renderer).toBe('sandbox');
    expect(midSnap.layout).toBe('inline');
    expect(midSnap.flashingSource).toBe(false);
  });

  it('keeps a live stream-preview iframe when later tokens flip layout to viewport', async () => {
    const origin = { sessionId: 's-stream', messageId: 'm-stream-viewport' };
    const start = ['```artifact-html', '<section><p>Hello</p></section>'].join('\n');
    const upgraded = [
      '```artifact-html',
      '<section style="height:100vh"><p>Hello</p></section>',
    ].join('\n');
    const { container, root } = renderView(
      <MarkdownView text={start} renderingPhase="streaming" artifactOrigin={origin} />,
    );
    await flushFrame();
    const iframe = container.querySelector('iframe.artifact-iframe');
    expect(iframe).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-frame-mode'),
    ).toBe('inline-flow');

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarkdownView text={upgraded} renderingPhase="streaming" artifactOrigin={origin} />
        </PiwinUiProvider>,
      );
    });
    await flushFrame();
    expect(container.querySelector('iframe.artifact-iframe')).toBe(iframe);
    expect(
      container.querySelector('[data-testid="artifact-frame"]')?.getAttribute('data-frame-mode'),
    ).toBe('inline-viewport');
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
  });

  it.fails('keeps the same iframe node after the completed script fence', async () => {
    const first = STREAMING_DELTA_STEPS[0];
    if (!first) throw new Error('missing streaming fixture');
    const { container, root } = renderView(
      <MarkdownView
        text={first.text}
        renderingPhase={first.phase}
        artifactOrigin={{ sessionId: 's-stream', messageId: 'm-stream-record' }}
      />,
    );
    await flushFrame();
    const firstIframe = container.querySelector('iframe.artifact-iframe');
    const records = await playDeltas(container, root);
    const completed = records[records.length - 1];
    expect(completed?.iframe === firstIframe).toBe(true);
    expect(completed?.liveHost).not.toBeNull();
    expect(completed?.renderer).toBe('sandbox');
    expect(completed?.endReachable).toBe(true);
  });
});
