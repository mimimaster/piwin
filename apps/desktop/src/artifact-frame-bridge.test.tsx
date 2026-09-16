/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolveArtifactViewportFrameHeight, type ArtifactFrameMode } from '@piwin/artifact';
import { useArtifactFrameBridge } from './artifact-frame-bridge.js';
import type { ArtifactSandboxView } from './artifact-frame-stream.js';
import { subscribeNativeArtifactBridge } from './artifact-native-bridge.js';

vi.mock('./artifact-native-bridge.js', () => ({
  subscribeNativeArtifactBridge: vi.fn(async () => () => undefined),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeDecision(mode: 'interactive' | 'stream-preview'): ArtifactSandboxView {
  const source = '<div>Measured artifact</div>';
  return {
    mode,
    descriptor: {
      id: 'height-bridge-test',
      type: 'html',
      title: 'Measured artifact',
      source,
      rawLanguage: 'artifact-html',
      alias: 'artifact-html',
      declaration: 'explicit',
      documentKind: 'fragment',
      surface: 'inline',
    },
    renderSource: source,
    srcdoc: '<html><body><div>Measured artifact</div></body></html>',
    frameMode: 'inline-flow',
  };
}

function BridgeHarness(props: {
  mode: 'interactive' | 'stream-preview';
  frameMode?: ArtifactFrameMode;
}): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const decision = makeDecision(props.mode);
  const bridge = useArtifactFrameBridge({
    channelId: decision.descriptor.id,
    documentKey: `${props.mode}-document`,
    decision,
    iframeRef,
    enabled: true,
    measureHeight: true,
    bootstrapHeight: 80,
    frameMode: props.frameMode ?? 'inline-flow',
    presentation: 'inline',
  });
  return (
    <div>
      <iframe ref={iframeRef} title="Artifact" onLoad={bridge.onIframeLoad} />
      <output data-testid="bridge-state" data-status={bridge.status} data-height={bridge.height} />
      <button type="button" onClick={bridge.retryMeasurement}>
        Retry
      </button>
    </div>
  );
}

describe('useArtifactFrameBridge recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(subscribeNativeArtifactBridge).mockReset();
    vi.mocked(subscribeNativeArtifactBridge).mockResolvedValue(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  async function renderBridge(mode: 'interactive' | 'stream-preview'): Promise<HTMLIFrameElement> {
    act(() => root.render(<BridgeHarness mode={mode} />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const iframe = container.querySelector('iframe');
    if (!iframe) throw new Error('bridge iframe missing');
    return iframe;
  }

  it('requests recovery mode on timeout and restores a later exact height', async () => {
    const iframe = await renderBridge('interactive');
    const postMessage = vi.spyOn(iframe.contentWindow as Window, 'postMessage');
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(5_000);
    });

    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    expect(state?.dataset['status']).toBe('fallback');
    expect(state?.dataset['height']).toBe('360');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'piwin-artifact:measure-request',
        fallbackViewport: true,
        force: true,
      }),
      '*',
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 436,
            viewportHeight: 360,
            revision: 0,
          },
        }),
      );
    });
    expect(state?.dataset['status']).toBe('ready');
    expect(state?.dataset['height']).toBe('436');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackViewport: false, force: false }),
      '*',
    );
  });

  it('starts the same recovery timeout while the artifact is streaming', async () => {
    const iframe = await renderBridge('stream-preview');
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(5_000);
    });
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    expect(state?.dataset['status']).toBe('fallback');
    expect(state?.dataset['height']).toBe('360');
  });

  it('preserves height during replacement but recovers if the final document never confirms it', async () => {
    const iframe = await renderBridge('stream-preview');
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 436,
            viewportHeight: 360,
            revision: 0,
          },
        }),
      );
    });
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    expect(state?.dataset['height']).toBe('436');

    await renderBridge('interactive');
    expect(state?.dataset['status']).toBe('loading');
    expect(state?.dataset['height']).toBe('436');

    act(() => {
      iframe.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(5_000);
    });
    expect(state?.dataset['status']).toBe('fallback');
    expect(state?.dataset['height']).toBe('360');
  });

  it('accepts a size whose MessageEvent.source is null', async () => {
    const iframe = await renderBridge('interactive');
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      window.dispatchEvent(
        new MessageEvent('message', {
          source: null,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 436,
            viewportHeight: 80,
            revision: 0,
            seq: 0,
          },
        }),
      );
    });
    expect(state?.dataset['status']).toBe('ready');
    expect(state?.dataset['height']).toBe('436');
  });

  it('does not fall back when height arrived before iframe load', async () => {
    const iframe = await renderBridge('interactive');
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 436,
            viewportHeight: 80,
            revision: 0,
            seq: 0,
          },
        }),
      );
      iframe.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(5_000);
    });
    expect(state?.dataset['status']).toBe('ready');
    expect(state?.dataset['height']).toBe('436');
  });

  it('ignores a dual-channel copy with the same seq', async () => {
    const iframe = await renderBridge('interactive');
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 200,
            viewportHeight: 80,
            revision: 0,
            seq: 0,
          },
        }),
      );
    });
    expect(state?.dataset['status']).toBe('ready');
    expect(state?.dataset['height']).toBe('200');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 800,
            viewportHeight: 80,
            revision: 1,
            seq: 0,
          },
        }),
      );
    });
    expect(state?.dataset['height']).toBe('200');
  });

  it('ignores a late native report from the replaced document', async () => {
    let nativeHandler: ((payload: unknown) => void) | null = null;
    vi.mocked(subscribeNativeArtifactBridge).mockImplementation(async (_channelId, handler) => {
      nativeHandler = handler;
      return () => undefined;
    });
    const sendNative = (payload: Record<string, unknown>): void => {
      act(() =>
        nativeHandler?.({
          type: 'piwin-artifact:size',
          channelId: 'height-bridge-test',
          viewportHeight: 80,
          ...payload,
        }),
      );
    };
    const lastMeasureEpoch = (spy: ReturnType<typeof vi.spyOn>): number => {
      const requests = spy.mock.calls
        .map(([message]) => message as { type?: string; epoch?: number })
        .filter((message) => message.type === 'piwin-artifact:measure-request');
      return requests.at(-1)?.epoch ?? -1;
    };

    const iframe = await renderBridge('stream-preview');
    const postMessage = vi.spyOn(iframe.contentWindow as Window, 'postMessage');
    act(() => iframe.dispatchEvent(new Event('load')));
    const streamEpoch = lastMeasureEpoch(postMessage);
    for (let revision = 0; revision < 4; revision += 1) {
      sendNative({ height: 200, revision, seq: revision, epoch: streamEpoch });
    }
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    expect(state?.dataset['height']).toBe('200');

    await renderBridge('interactive');
    act(() => iframe.dispatchEvent(new Event('load')));
    const finalEpoch = lastMeasureEpoch(postMessage);
    expect(finalEpoch).not.toBe(streamEpoch);

    // The stream document's last report arrives after the final document loaded.
    sendNative({ height: 200, revision: 3, seq: 3, epoch: streamEpoch });
    // The final document starts its own seq/revision at zero.
    sendNative({ height: 436, revision: 0, seq: 0, epoch: finalEpoch });
    expect(state?.dataset['status']).toBe('ready');
    expect(state?.dataset['height']).toBe('436');
  });

  it('rejects a size posted by the parent window', async () => {
    const iframe = await renderBridge('interactive');
    const state = container.querySelector<HTMLOutputElement>('[data-testid="bridge-state"]');
    act(() => {
      iframe.dispatchEvent(new Event('load'));
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: 'piwin-artifact:size',
            channelId: 'height-bridge-test',
            height: 999,
            viewportHeight: 80,
            revision: 0,
            seq: 0,
          },
        }),
      );
    });
    expect(state?.dataset['status']).not.toBe('ready');
    expect(state?.dataset['height']).not.toBe('999');
  });

  it('keeps overflow chrome bounded when a later measurement becomes smaller', async () => {
    const iframe = await renderBridge('interactive');
    for (const [revision, height] of [20_000, 8_000].entries()) {
      act(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: iframe.contentWindow,
            data: {
              type: 'piwin-artifact:size',
              channelId: 'height-bridge-test',
              height,
              viewportHeight: 600,
              revision,
            },
          }),
        ),
      );
    }
    expect(container.querySelector('output')?.dataset.height).toBe(
      String(resolveArtifactViewportFrameHeight(window.innerHeight)),
    );
  });

  it('resizes viewport chrome with the window', async () => {
    vi.stubGlobal('innerHeight', 840);
    act(() => root.render(<BridgeHarness mode="interactive" frameMode="inline-viewport" />));
    expect(container.querySelector('output')?.dataset.height).toBe('605');
    vi.stubGlobal('innerHeight', 600);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(container.querySelector('output')?.dataset.height).toBe('432');
    vi.unstubAllGlobals();
  });
});
