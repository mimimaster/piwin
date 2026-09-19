// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSidebarResize, type UseSidebarResizeResult } from './use-sidebar-resize';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ResizeHarness = {
  root: Root;
  container: HTMLDivElement;
  shell: HTMLDivElement;
  handle: HTMLDivElement;
  rerender: () => void;
  latest: () => UseSidebarResizeResult;
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
}): ResizeHarness {
  const container = document.createElement('div');
  const shell = document.createElement('div');
  const handle = document.createElement('div');
  shell.className = 'app-shell';
  shell.append(handle);
  document.body.append(shell, container);

  const root = createRoot(container);
  let latest: UseSidebarResizeResult | undefined;

  function HarnessComponent(): null {
    latest = useSidebarResize({
      layoutMode: 'desktop',
      rightPanelOpen: false,
      ...(options?.onCollapseRequest ? { onCollapseRequest: options.onCollapseRequest } : {}),
      ...(options?.onExpandRequest ? { onExpandRequest: options.onExpandRequest } : {}),
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
    rerender: () => act(() => root.render(<HarnessComponent />)),
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

describe('useSidebarResize drag scheduling', () => {
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

  it('keeps stream-driven rerenders from bypassing the pending resize frame', () => {
    const harness = renderHarness();
    const setProperty = vi.spyOn(harness.shell.style, 'setProperty');
    const addEventListener = vi.spyOn(window, 'addEventListener');
    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 17, 300));
    });
    const move = addEventListener.mock.calls.find(([type]) => type === 'pointermove')?.[1];
    if (typeof move !== 'function') {
      throw new Error('expected a pointermove listener');
    }
    setProperty.mockClear();
    act(() => move(createPointerEvent('pointermove', 17, 350)));
    harness.rerender();
    harness.rerender();
    expect(setProperty).not.toHaveBeenCalled();
    const frame = frameCallbacks[1];
    if (!frame) throw new Error('expected a resize frame');
    act(() => frame(16));
    expect(setProperty).toHaveBeenCalledTimes(1);
    setProperty.mockClear();
    harness.rerender();
    expect(setProperty).not.toHaveBeenCalled();
    disposeHarness(harness);
  });

  it('writes at most once per animation frame and keeps the newest width', () => {
    const harness = renderHarness();
    const shell = harness.shell;
    const setProperty = vi.spyOn(shell.style, 'setProperty');
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 7, 300));
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
      pointerMoveListener(createPointerEvent('pointermove', 7, 330));
      pointerMoveListener(createPointerEvent('pointermove', 7, 350));
    });

    expect(nextFrameId).toBe(1);
    expect(setProperty).not.toHaveBeenCalled();

    const callback = frameCallbacks[1];
    if (callback === undefined) {
      throw new Error('expected a scheduled resize frame');
    }
    callback(16);
    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('350px');

    const pointerUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointerup',
    )?.[1];
    if (typeof pointerUpListener !== 'function') {
      throw new Error('expected a pointerup listener');
    }
    act(() => {
      pointerUpListener(createPointerEvent('pointerup', 7, 350));
      vi.runOnlyPendingTimers();
    });
    disposeHarness(harness);
  });

  it('flushes the latest pending width on pointer-up', () => {
    const harness = renderHarness();
    const shell = harness.shell;
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 8, 300));
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
      pointerMoveListener(createPointerEvent('pointermove', 8, 340));
      pointerUpListener(createPointerEvent('pointerup', 8, 340));
      vi.runOnlyPendingTimers();
    });

    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('340px');
    expect(localStorage.getItem('piwin.desktop.sidebarWidth')).toBe('340');
    disposeHarness(harness);
  });

  it('collapses when dragged past min width', () => {
    const onCollapseRequest = vi.fn();
    const harness = renderHarness({ onCollapseRequest });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 9, 300));
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
      // default width 300; clientX 200 → candidate 200, past min 300 by >24px
      pointerMoveListener(createPointerEvent('pointermove', 9, 200));
      pointerUpListener(createPointerEvent('pointerup', 9, 200));
      vi.runOnlyPendingTimers();
    });

    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('piwin.desktop.sidebarWidth')).toBe('300');
    disposeHarness(harness);
  });

  it('expands when reverse-dragged past min width without pointer-up', () => {
    const onCollapseRequest = vi.fn();
    const onExpandRequest = vi.fn();
    const harness = renderHarness({ onCollapseRequest, onExpandRequest });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 11, 300));
    });
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    if (typeof pointerMoveListener !== 'function') {
      throw new Error('expected a pointermove listener');
    }

    act(() => {
      // candidate 200: past min 300 by >24px → collapse
      pointerMoveListener(createPointerEvent('pointermove', 11, 200));
    });
    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    expect(onExpandRequest).not.toHaveBeenCalled();

    act(() => {
      // candidate 285: still in the 276–299 dead zone
      pointerMoveListener(createPointerEvent('pointermove', 11, 285));
    });
    expect(onExpandRequest).not.toHaveBeenCalled();

    act(() => {
      // candidate 310: back to min width → expand, still holding
      pointerMoveListener(createPointerEvent('pointermove', 11, 310));
    });
    expect(onExpandRequest).toHaveBeenCalledTimes(1);
    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    disposeHarness(harness);
  });
});
