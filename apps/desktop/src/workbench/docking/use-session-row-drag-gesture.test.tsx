// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionDragProvider,
  useSessionDrag,
  type SessionDragRequest,
} from './docking-session-drag.js';
import { useSessionRowDragGesture } from './use-session-row-drag-gesture.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const TOUCH_WAIT_MS = 320;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function renderGesture(starter: (request: SessionDragRequest) => void, onClick = vi.fn()) {
  function Registrar() {
    const bridge = useSessionDrag();
    useEffect(() => {
      bridge?.registerStarter(starter);
      return () => bridge?.registerStarter(null);
    }, [bridge]);
    return null;
  }
  function Row() {
    const gesture = useSessionRowDragGesture({ enabled: true, sessionId: 's1', label: 'Session' });
    return (
      <button type="button" data-testid="row" onClickCapture={gesture.onClickCapture} onClick={onClick}>
        <span data-testid="handle" {...gesture.handleProps}>Session</span>
      </button>
    );
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <SessionDragProvider>
        <Registrar />
        <Row />
      </SessionDragProvider>,
    ),
  );
  const handle = container.querySelector<HTMLElement>('[data-testid="handle"]');
  const row = container.querySelector<HTMLButtonElement>('[data-testid="row"]');
  if (!handle || !row) throw new Error('missing gesture elements');
  return { handle, row, onClick };
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, ...init });
}

describe('useSessionRowDragGesture', () => {
  it('keeps a short mouse press as a normal click', () => {
    const starter = vi.fn();
    const rendered = renderGesture(starter);
    act(() => rendered.handle.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 })));
    act(() => rendered.handle.dispatchEvent(pointer('pointerup', { pointerType: 'mouse', clientX: 10, clientY: 10 })));
    act(() => rendered.row.click());
    expect(starter).toHaveBeenCalledTimes(1);
    expect(rendered.onClick).toHaveBeenCalledTimes(1);
  });

  it('suppresses the click after mouse travel activates dragging', () => {
    const starter = vi.fn();
    const rendered = renderGesture(starter);
    act(() => rendered.handle.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10 })));
    act(() => rendered.handle.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', clientX: 18, clientY: 10 })));
    act(() => rendered.handle.dispatchEvent(pointer('pointerup', { pointerType: 'mouse', clientX: 18, clientY: 10 })));
    act(() => rendered.row.click());
    expect(rendered.onClick).not.toHaveBeenCalled();
  });

  it('requires a touch long press before starting a drag', () => {
    vi.useFakeTimers();
    const starter = vi.fn();
    const rendered = renderGesture(starter);
    act(() => rendered.handle.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })));
    act(() => vi.advanceTimersByTime(319));
    expect(starter).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(starter).toHaveBeenCalledWith({
      sessionId: 's1',
      label: 'Session',
      origin: { x: 10, y: 10 },
      activateImmediately: true,
    });
  });

  it('does not start a touch drag after blur or hide cancels the pending long press', () => {
    vi.useFakeTimers();
    const starter = vi.fn();
    const rendered = renderGesture(starter);
    const hidden = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      act(() => rendered.handle.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })));
      act(() => window.dispatchEvent(new Event('blur')));
      act(() => vi.advanceTimersByTime(TOUCH_WAIT_MS));
      expect(starter).not.toHaveBeenCalled();

      act(() => rendered.handle.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 12, clientY: 12 })));
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      act(() => vi.advanceTimersByTime(TOUCH_WAIT_MS));
      expect(starter).not.toHaveBeenCalled();
    } finally {
      if (hidden) Object.defineProperty(document, 'visibilityState', hidden);
    }
  });

  it('does not start a touch drag when Escape cancels the pending long press', () => {
    vi.useFakeTimers();
    const starter = vi.fn();
    const rendered = renderGesture(starter);
    act(() => rendered.handle.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    act(() => vi.advanceTimersByTime(TOUCH_WAIT_MS));
    expect(starter).not.toHaveBeenCalled();
  });
});
