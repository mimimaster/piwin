// @vitest-environment happy-dom
import { act, useLayoutEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { TranscriptViewport } from './transcript-viewport';
import { clearTranscriptScrollPositionsForTests } from './transcript-scroll-memory';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TranscriptGeometry(props: { scrollHeight: number }): ReactElement {
  const markerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const scrollElement = markerRef.current?.closest('.chat-stream');
    if (!(scrollElement instanceof HTMLDivElement)) {
      throw new Error('Expected the transcript scroll element');
    }
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: props.scrollHeight },
    });
  }, [props.scrollHeight]);
  return <div ref={markerRef}>Transcript content</div>;
}

describe('TranscriptViewport session scroll recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    clearTranscriptScrollPositionsForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderSession(
    sessionId: string,
    options: {
      activitySignal?: string;
      scrollHeight?: number;
      canLoadOlder?: boolean;
      onLoadOlder?: () => Promise<void>;
    } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TranscriptViewport
            key={sessionId}
            sessionId={sessionId}
            messageCount={1}
            activitySignal={options.activitySignal ?? 'idle'}
            messages={[]}
            canLoadOlder={options.canLoadOlder === true}
            {...(options.onLoadOlder ? { onLoadOlder: options.onLoadOlder } : {})}
          >
            <TranscriptGeometry scrollHeight={options.scrollHeight ?? 1_000} />
          </TranscriptViewport>
        </PiwinUiProvider>,
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
  }

  it('restores a scrolled-away offset after switching sessions', async () => {
    await renderSession('session-a');
    const firstSessionElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!firstSessionElement) {
      throw new Error('Expected the first transcript scroll element');
    }
    act(() => {
      firstSessionElement.scrollTop = 240;
      firstSessionElement.dispatchEvent(new Event('scroll'));
    });

    await renderSession('session-b');
    await renderSession('session-a');

    const restoredElement = container.querySelector<HTMLDivElement>('.chat-stream');
    expect(restoredElement?.scrollTop).toBe(240);
  });

  it('follows a growing tail but stays stable through 100 updates after scroll-away', async () => {
    await renderSession('live-session', { activitySignal: 'delta-0', scrollHeight: 1_000 });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    if (!scrollElement) {
      throw new Error('Expected the live transcript scroll element');
    }

    await renderSession('live-session', { activitySignal: 'delta-1', scrollHeight: 1_100 });
    expect(scrollElement.scrollTop).toBe(1_100);

    act(() => {
      scrollElement.scrollTop = 240;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    for (let deltaIndex = 2; deltaIndex <= 101; deltaIndex += 1) {
      await renderSession('live-session', {
        activitySignal: `delta-${deltaIndex}`,
        scrollHeight: 1_100 + deltaIndex * 10,
      });
    }

    expect(scrollElement.scrollTop).toBe(240);
    expect(container.querySelector('[data-testid="jump-to-latest-btn"]')).not.toBeNull();
  });

  it('loads an older page and preserves the visible scroll anchor', async () => {
    const onLoadOlder = vi.fn(async () => {
      const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
      if (!scrollElement) throw new Error('Expected transcript scroll element');
      Object.defineProperty(scrollElement, 'scrollHeight', {
        configurable: true,
        value: 1_400,
      });
    });
    await renderSession('history-session', {
      scrollHeight: 1_000,
      canLoadOlder: true,
      onLoadOlder,
    });
    const scrollElement = container.querySelector<HTMLDivElement>('.chat-stream');
    const loadButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="transcript-load-older"]',
    );
    if (!scrollElement || !loadButton) throw new Error('Expected history controls');
    scrollElement.scrollTop = 120;

    await act(async () => {
      loadButton.click();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(scrollElement.scrollTop).toBe(520);
  });
});
