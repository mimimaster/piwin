/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArtifactFrameMode } from '@piwin/artifact';
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
});
