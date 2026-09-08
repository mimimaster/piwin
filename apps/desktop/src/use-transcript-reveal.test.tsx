// @vitest-environment happy-dom
import { act, createRef, type ReactElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptReveal } from './use-transcript-reveal';

type RevealGeometry = {
  height: number;
  viewport: number;
  top: number;
};

type RevealOptions = {
  sessionId?: string;
  messageCount: number;
  awaitingTranscript: boolean;
  historyViewActive: boolean;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  jumpToLatest: () => void;
};

type RevealHarnessProps = RevealOptions & {
  geometry: RevealGeometry;
};

const resizeCallbacks = new Set<ResizeObserverCallback>();
const mutationCallbacks = new Set<MutationCallback>();

class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallbacks.add(callback);
  }

  public disconnect(): void {
    resizeCallbacks.delete(this.callback);
  }

  public observe(): void {}

  public unobserve(): void {}
}

class TestMutationObserver implements MutationObserver {
  private readonly callback: MutationCallback;

  public constructor(callback: MutationCallback) {
    this.callback = callback;
    mutationCallbacks.add(callback);
  }

  public disconnect(): void {
    mutationCallbacks.delete(this.callback);
  }

  public observe(): void {}

  public takeRecords(): MutationRecord[] {
    return [];
  }
}

function notifyGeometry(): void {
  for (const callback of resizeCallbacks) {
    callback([], {} as ResizeObserver);
  }
  for (const callback of mutationCallbacks) {
    callback([], {} as MutationObserver);
  }
  window.dispatchEvent(new Event('resize'));
}

function attachGeometry(
  element: HTMLDivElement,
  geometry: RevealGeometry,
  scrollElementRef: RefObject<HTMLDivElement | null>,
): void {
  Object.defineProperties(element, {
    clientHeight: {
      configurable: true,
      get: () => geometry.viewport,
    },
    scrollHeight: {
      configurable: true,
      get: () => geometry.height,
    },
    scrollTop: {
      configurable: true,
      get: () => geometry.top,
      set: (value: number) => {
        // happy-dom does not clamp scrollTop to the scrollable range.
        geometry.top = value;
      },
    },
  });
  (scrollElementRef as { current: HTMLDivElement | null }).current = element;
}

function RevealHarness(props: RevealHarnessProps): ReactElement {
  const revealing = useTranscriptReveal({
    sessionId: props.sessionId,
    messageCount: props.messageCount,
    awaitingTranscript: props.awaitingTranscript,
    historyViewActive: props.historyViewActive,
    scrollElementRef: props.scrollElementRef,
    jumpToLatest: props.jumpToLatest,
  });
  return (
    <div
      ref={(element) => {
        if (element) {
          attachGeometry(element, props.geometry, props.scrollElementRef);
        }
      }}
      data-testid="transcript-shell"
      data-revealing={String(revealing)}
    >
      <div
        data-testid="transcript-layout"
        style={{ visibility: revealing ? 'hidden' : 'visible' }}
      >
        Mounted transcript content
      </div>
    </div>
  );
}

function createScenario(
  overrides: Partial<Omit<RevealOptions, 'scrollElementRef' | 'jumpToLatest'>> = {},
): RevealHarnessProps & { jumpToLatest: ReturnType<typeof vi.fn> } {
  const scrollElementRef = createRef<HTMLDivElement>();
  const geometry: RevealGeometry = { height: 2_400, viewport: 600, top: 0 };
  const jumpToLatest = vi.fn(() => {
    geometry.top = Math.max(0, geometry.height - geometry.viewport);
  });
  return {
    sessionId: 'session-reveal',
    messageCount: 12,
    awaitingTranscript: false,
    historyViewActive: false,
    scrollElementRef,
    jumpToLatest,
    geometry,
    ...overrides,
  };
}

describe('useTranscriptReveal', () => {
  let root: Root;
  let container: HTMLDivElement;
  let originalResizeObserver: typeof ResizeObserver;
  let originalMutationObserver: typeof MutationObserver;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    resizeCallbacks.clear();
    mutationCallbacks.clear();
    originalResizeObserver = globalThis.ResizeObserver;
    originalMutationObserver = globalThis.MutationObserver;
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    globalThis.ResizeObserver = TestResizeObserver;
    globalThis.MutationObserver = TestMutationObserver;
    window.ResizeObserver = TestResizeObserver;
    window.MutationObserver = TestMutationObserver;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resizeCallbacks.clear();
    mutationCallbacks.clear();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.MutationObserver = originalMutationObserver;
    window.ResizeObserver = originalResizeObserver;
    window.MutationObserver = originalMutationObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
  });

  function renderScenario(scenario: RevealHarnessProps): void {
    act(() => {
      root.render(<RevealHarness {...scenario} />);
    });
  }

  function advance(milliseconds: number): void {
    act(() => {
      vi.advanceTimersByTime(milliseconds);
    });
  }

  function isRevealing(): boolean {
    return container.querySelector('[data-testid="transcript-shell"]')?.getAttribute(
      'data-revealing',
    ) === 'true';
  }

  it('keeps an existing transcript mounted but hidden until the minimum and stable windows pass', () => {
    const scenario = createScenario();
    renderScenario(scenario);

    expect(isRevealing()).toBe(true);
    expect(container.querySelector('[data-testid="transcript-layout"]')).not.toBeNull();

    advance(300);
    notifyGeometry();
    expect(isRevealing()).toBe(true);
    advance(179);
    expect(isRevealing()).toBe(true);
    advance(1);

    expect(isRevealing()).toBe(false);
    expect(scenario.jumpToLatest).toHaveBeenCalled();
    expect(scenario.geometry.top).toBe(scenario.geometry.height - scenario.geometry.viewport);
  });

  it('resets the stable window for a DOM mutation even when geometry is unchanged', () => {
    const scenario = createScenario();
    renderScenario(scenario);

    advance(300);
    notifyGeometry();
    advance(100);

    const shell = scenario.scrollElementRef.current;
    shell?.appendChild(document.createElement('span'));
    notifyGeometry();
    advance(170);
    expect(isRevealing()).toBe(true);
    advance(30);

    expect(isRevealing()).toBe(false);
  });

  it('waits for awaiting transcript data before starting the reveal clock', () => {
    const scenario = createScenario({ messageCount: 0, awaitingTranscript: true });
    renderScenario(scenario);

    advance(2_000);
    expect(isRevealing()).toBe(true);
    expect(scenario.jumpToLatest).not.toHaveBeenCalled();

    renderScenario({ ...scenario, messageCount: 12, awaitingTranscript: false });
    notifyGeometry();
    advance(299);
    expect(isRevealing()).toBe(true);
    advance(81);
    expect(isRevealing()).toBe(false);
  });

  it('resets stability when geometry keeps growing, then reveals at the hard deadline', () => {
    const scenario = createScenario();
    renderScenario(scenario);

    for (let index = 0; index < 15; index += 1) {
      advance(100);
      scenario.geometry.height += 40;
      notifyGeometry();
      expect(isRevealing()).toBe(true);
    }

    advance(100);

    expect(isRevealing()).toBe(false);
    expect(scenario.jumpToLatest).toHaveBeenCalled();
  });

  it('does not reveal while an image or artifact preview is pending', () => {
    const scenario = createScenario();
    renderScenario(scenario);
    const shell = scenario.scrollElementRef.current;
    expect(shell).not.toBeNull();
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    const preview = document.createElement('div');
    preview.dataset.artifactHeightStatus = 'pending';
    const media = document.createElement('span');
    media.dataset.mediaPreviewLoading = 'true';
    shell?.append(image, preview, media);
    notifyGeometry();

    advance(600);
    expect(isRevealing()).toBe(true);

    Object.defineProperty(image, 'complete', { configurable: true, value: true });
    preview.dataset.artifactHeightStatus = 'ready';
    media.remove();
    notifyGeometry();
    advance(220);
    expect(isRevealing()).toBe(false);
  });

  it('uses the hard deadline when requestAnimationFrame makes no progress', () => {
    window.requestAnimationFrame = vi.fn(() => 0);
    window.cancelAnimationFrame = vi.fn();
    const scenario = createScenario();
    renderScenario(scenario);

    advance(1_599);
    expect(isRevealing()).toBe(true);
    advance(1);

    expect(isRevealing()).toBe(false);
    expect(scenario.jumpToLatest).toHaveBeenCalledTimes(1);
  });

  it('does not block an empty new session or a history view', () => {
    const empty = createScenario({ messageCount: 0 });
    renderScenario(empty);
    expect(isRevealing()).toBe(false);
    advance(2_000);
    expect(empty.jumpToLatest).not.toHaveBeenCalled();

    const history = createScenario({ historyViewActive: true, awaitingTranscript: true });
    renderScenario(history);
    expect(isRevealing()).toBe(false);
    advance(2_000);
    expect(history.jumpToLatest).not.toHaveBeenCalled();
  });

  it('starts a fresh reveal for a new session and ignores the old deadline', () => {
    const first = createScenario({ sessionId: 'session-first' });
    renderScenario(first);
    advance(1_500);
    const firstJumpCount = first.jumpToLatest.mock.calls.length;

    const second = createScenario({ sessionId: 'session-second' });
    renderScenario(second);
    advance(100);

    expect(isRevealing()).toBe(true);
    expect(first.jumpToLatest).toHaveBeenCalledTimes(firstJumpCount);
  });

  it('cancels pending timers and observers on unmount', () => {
    const scenario = createScenario();
    renderScenario(scenario);
    act(() => root.unmount());
    advance(2_000);
    notifyGeometry();

    expect(scenario.jumpToLatest).not.toHaveBeenCalled();
  });

  it('does not hide or force the tail for ordinary updates after reveal', () => {
    const scenario = createScenario();
    renderScenario(scenario);
    advance(480);
    expect(isRevealing()).toBe(false);
    const jumpCount = scenario.jumpToLatest.mock.calls.length;

    scenario.geometry.height += 300;
    renderScenario({ ...scenario, messageCount: 13 });
    notifyGeometry();
    advance(1_000);

    expect(isRevealing()).toBe(false);
    expect(scenario.jumpToLatest).toHaveBeenCalledTimes(jumpCount);
  });
});
