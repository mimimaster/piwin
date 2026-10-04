// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDockingDrag, type DockDragController } from './use-docking-drag.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function renderController(args: Parameters<typeof useDockingDrag>[0]): () => DockDragController {
  let controller: DockDragController | null = null;
  function Harness() {
    controller = useDockingDrag(args);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness />));
  return () => {
    if (!controller) throw new Error('missing drag controller');
    return controller;
  };
}

describe('useDockingDrag', () => {
  it('activates mouse drag only after the movement threshold', () => {
    const resolve = vi.fn(() => ({
      preview: { ok: true, label: 'split', message: null, highlight: [] },
      commit: vi.fn(),
    }));
    const getController = renderController({ enabled: true, resolve, onCommit: vi.fn() });
    act(() => getController().startDrag({ x: 10, y: 10 }, { kind: 'unopened-session', sessionId: 's1' }));
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 13, clientY: 12 })));
    expect(getController().drag).toBeNull();
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 16, clientY: 10 })));
    expect(getController().drag?.source).toEqual({ kind: 'unopened-session', sessionId: 's1' });
  });

  it('supports pre-activated touch drags and cancels on window blur', () => {
    const getController = renderController({
      enabled: true,
      resolve: () => ({
        preview: { ok: true, label: 'split', message: null, highlight: [] },
        commit: vi.fn(),
      }),
      onCommit: vi.fn(),
    });
    act(() =>
      getController().startDrag(
        { x: 20, y: 20 },
        { kind: 'unopened-session', sessionId: 's1' },
        { activated: true },
      ),
    );
    expect(getController().drag).not.toBeNull();
    act(() => window.dispatchEvent(new Event('blur')));
    expect(getController().drag).toBeNull();
  });

  it('cancels a pending drag with Escape', () => {
    const resolve = vi.fn(() => null);
    const getController = renderController({ enabled: true, resolve, onCommit: vi.fn() });
    act(() => getController().startDrag({ x: 0, y: 0 }, { kind: 'unopened-session', sessionId: 's1' }));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 0 })));
    expect(resolve).not.toHaveBeenCalled();
  });
});
