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

  it('writes at most once per animation frame and keeps the newest width', () => {
    const harness = renderHarness();
    const shell = harness.shell;
    const setProperty = vi.spyOn(shell.style, 'setProperty');
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 7, 240));
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
      pointerMoveListener(createPointerEvent('pointermove', 7, 270));
      pointerMoveListener(createPointerEvent('pointermove', 7, 290));
    });

    expect(nextFrameId).toBe(1);
    expect(setProperty).not.toHaveBeenCalled();

    const callback = frameCallbacks[1];
    if (callback === undefined) {
      throw new Error('expected a scheduled resize frame');
    }
    callback(16);
    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('290px');

    const pointerUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointerup',
    )?.[1];
    if (typeof pointerUpListener !== 'function') {
      throw new Error('expected a pointerup listener');
    }
    act(() => {
      pointerUpListener(createPointerEvent('pointerup', 7, 290));
      vi.runOnlyPendingTimers();
    });
    disposeHarness(harness);
  });

  it('flushes the latest pending width on pointer-up', () => {
    const harness = renderHarness();
    const shell = harness.shell;
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 8, 240));
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
      pointerMoveListener(createPointerEvent('pointermove', 8, 280));
      pointerUpListener(createPointerEvent('pointerup', 8, 280));
      vi.runOnlyPendingTimers();
    });

    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('280px');
    expect(localStorage.getItem('piwin.desktop.sidebarWidth')).toBe('280');
    disposeHarness(harness);
  });

  it('collapses when dragged past min width', () => {
    const onCollapseRequest = vi.fn();
    const harness = renderHarness({ onCollapseRequest });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 9, 240));
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
      // default width 240; clientX 160 → candidate 160, past min 200 by >24px
      pointerMoveListener(createPointerEvent('pointermove', 9, 160));
      pointerUpListener(createPointerEvent('pointerup', 9, 160));
      vi.runOnlyPendingTimers();
    });

    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('piwin.desktop.sidebarWidth')).toBe('240');
    disposeHarness(harness);
  });

  it('expands when reverse-dragged past min width without pointer-up', () => {
    const onCollapseRequest = vi.fn();
    const onExpandRequest = vi.fn();
    const harness = renderHarness({ onCollapseRequest, onExpandRequest });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    act(() => {
      harness.latest().onResizePointerDown(createPointerDownEvent(harness.handle, 11, 240));
    });
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'pointermove',
    )?.[1];
    if (typeof pointerMoveListener !== 'function') {
      throw new Error('expected a pointermove listener');
    }

    act(() => {
      // candidate 160: past min 200 by >24px → collapse
      pointerMoveListener(createPointerEvent('pointermove', 11, 160));
    });
    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    expect(onExpandRequest).not.toHaveBeenCalled();

    act(() => {
      // candidate 185: still in the 176–199 dead zone
      pointerMoveListener(createPointerEvent('pointermove', 11, 185));
    });
    expect(onExpandRequest).not.toHaveBeenCalled();

    act(() => {
      // candidate 210: back to min width → expand, still holding
      pointerMoveListener(createPointerEvent('pointermove', 11, 210));
    });
    expect(onExpandRequest).toHaveBeenCalledTimes(1);
    expect(onCollapseRequest).toHaveBeenCalledTimes(1);
    disposeHarness(harness);
  });
});
