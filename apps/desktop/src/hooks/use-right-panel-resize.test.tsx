// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRightPanelResize, type UseRightPanelResizeResult } from './use-right-panel-resize';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ResizeHarness = {
  root: Root;
  container: HTMLDivElement;
  shell: HTMLDivElement;
  handle: HTMLDivElement;
  latest: () => UseRightPanelResizeResult;
};

function createPointerEvent(type: string, pointerId: number, clientX: number): PointerEvent {
  return new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    clientX,
  });
}

function createPointerDownEvent(
  handle: HTMLDivElement,
  pointerId: number,
  clientX: number,
): ReactPointerEvent<HTMLElement> {
  return {
    button: 0,
    currentTarget: handle,
    pointerId,
    clientX,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function renderHarness(options?: {
  onCollapseRequest?: () => void;
  onExpandRequest?: () => void;
  canEnterFullWidth?: boolean;
}): ResizeHarness {
  const container = document.createElement('div');
  const shell = document.createElement('div');
  const handle = document.createElement('div');
  shell.className = 'app-shell';
  shell.append(handle);
  document.body.append(shell, container);

  const root = createRoot(container);
  let latest: UseRightPanelResizeResult | undefined;

  function HarnessComponent(): null {
    latest = useRightPanelResize({
      layoutMode: 'desktop',
      navDrawerOpen: false,
      ...(options?.onCollapseRequest ? { onCollapseRequest: options.onCollapseRequest } : {}),
      ...(options?.onExpandRequest ? { onExpandRequest: options.onExpandRequest } : {}),
      ...(options?.canEnterFullWidth === undefined
        ? {}
        : { canEnterFullWidth: options.canEnterFullWidth }),
    });
    return null;
  }

  Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    root,
    container,
    shell,
    handle,
    latest: () => {
      if (latest === undefined) {
        throw new Error('resize result was not captured');
      }
      return latest;
    },
  };
}

function disposeHarness(harness: ResizeHarness): void {
  act(() => {
    harness.root.unmount();
  });
  harness.container.remove();
  harness.shell.remove();
}

describe('useRightPanelResize drag scheduling', () => {
  let frameCallbacks: Array<FrameRequestCallback | undefined>;
  let nextFrameId: number;

  beforeEach(() => {
    frameCallbacks = [];
    nextFrameId = 0;
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      const frameId = ++nextFrameId;
      frameCallbacks[frameId] = callback;
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
      frameCallbacks[frameId] = undefined;
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('writes at most once per animation frame and keeps the newest width', () => {
    const harness = renderHarness();
    const shell = harness.shell;
    const setProperty = vi.spyOn(shell.style, 'setProperty');
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 7, 500));
    });
    expect(harness.latest().isResizing).toBe(true);
    setProperty.mockClear();

    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    if (typeof pointerMoveListener !== 'function') {
      throw new Error('expected a pointermove listener');
    }
    act(() => {
      pointerMoveListener(createPointerEvent('pointermove', 7, 470));
      pointerMoveListener(createPointerEvent('pointermove', 7, 450));
    });

    expect(nextFrameId).toBe(1);
    expect(setProperty).not.toHaveBeenCalled();

    const callback = frameCallbacks[1];
    if (callback === undefined) {
      throw new Error('expected a scheduled resize frame');
    }
    callback(16);
    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(shell.style.getPropertyValue('--right-panel-width')).toBe('330px');

    const pointerUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointerup',
    )?.[1];
    if (typeof pointerUpListener !== 'function') {
      throw new Error('expected a pointerup listener');
    }
    act(() => {
      pointerUpListener(createPointerEvent('pointerup', 7, 450));
      vi.runOnlyPendingTimers();
    });
    disposeHarness(harness);
  });

  it('flushes the latest pending width on pointer-up', () => {
    const harness = renderHarness();
    const shell = harness.shell;
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 8, 500));
    });
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    const pointerUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointerup',
    )?.[1];
    if (typeof pointerMoveListener !== 'function' || typeof pointerUpListener !== 'function') {
      throw new Error('expected drag listeners');
    }

    act(() => {
      pointerMoveListener(createPointerEvent('pointermove', 8, 460));
      pointerUpListener(createPointerEvent('pointerup', 8, 460));
      vi.runOnlyPendingTimers();
    });

    expect(shell.style.getPropertyValue('--right-panel-width')).toBe('320px');
    expect(localStorage.getItem('piwin.desktop.rightPanelWidth')).toBe('320');
    disposeHarness(harness);
  });

  it('collapses when dragged past min width', () => {
    const onCollapseRequest = vi.fn();
    const harness = renderHarness({ onCollapseRequest });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 9, 500));
    });
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    const pointerUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointerup',
    )?.[1];
    if (typeof pointerMoveListener !== 'function' || typeof pointerUpListener !== 'function') {
      throw new Error('expected drag listeners');
    }

    act(() => {
      // default width 280; clientX 620 → candidate 160, past min 200 by >24px
      pointerMoveListener(createPointerEvent('pointermove', 9, 620));
      pointerUpListener(createPointerEvent('pointerup', 9, 620));
      vi.runOnlyPendingTimers();
    });

    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('piwin.desktop.rightPanelWidth')).toBe('280');
    disposeHarness(harness);
  });

  it('does not let a stored width steal the stage on open', () => {
    localStorage.setItem('piwin.desktop.rightPanelWidth', '1600');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const harness = renderHarness();
    // nav closed: max panel = 1280 - 420 = 860
    expect(harness.latest().widthPx).toBe(860);
    expect(harness.latest().isFullWidth).toBe(false);
    disposeHarness(harness);
  });

  it('does not cover the conversation when the inspector has no tool tabs', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const harness = renderHarness({ canEnterFullWidth: false });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 10, 500));
    });
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    const pointerUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointerup',
    )?.[1];
    if (typeof pointerMoveListener !== 'function' || typeof pointerUpListener !== 'function') {
      throw new Error('expected drag listeners');
    }

    act(() => {
      pointerMoveListener(createPointerEvent('pointermove', 10, -100));
      pointerUpListener(createPointerEvent('pointerup', 10, -100));
      vi.runOnlyPendingTimers();
    });

    expect(harness.latest().isFullWidth).toBe(false);
    expect(harness.latest().widthPx).toBe(860);
    disposeHarness(harness);
  });

  it('expands when reverse-dragged past min width without pointer-up', () => {
    const onCollapseRequest = vi.fn();
    const onExpandRequest = vi.fn();
    const harness = renderHarness({ onCollapseRequest, onExpandRequest });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 11, 500));
    });
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    if (typeof pointerMoveListener !== 'function') {
      throw new Error('expected a pointermove listener');
    }

    act(() => {
      // default width 280; clientX 620 → candidate 160, collapse
      pointerMoveListener(createPointerEvent('pointermove', 11, 620));
    });
    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    expect(onExpandRequest).not.toHaveBeenCalled();

    act(() => {
      // candidate 185: still in the 176–199 dead zone
      pointerMoveListener(createPointerEvent('pointermove', 11, 595));
    });
    expect(onExpandRequest).not.toHaveBeenCalled();

    act(() => {
      // candidate 220: back past min width → expand, still holding
      pointerMoveListener(createPointerEvent('pointermove', 11, 560));
    });
    expect(onExpandRequest).toHaveBeenCalledTimes(1);
    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    disposeHarness(harness);
  });
});
