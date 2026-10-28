// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { AnnotationExportError } from './annotation-export';
import type { ImageRect } from './annotation-model';
import { ScreenshotEditor } from './ScreenshotEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ScreenshotEditor', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onDone = vi.fn();
  const onExportFailed = vi.fn();

  function mount(initialSelection: ImageRect | null): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ScreenshotEditor
            imageUrl="data:,"
            image={{ width: 1000, height: 600 }}
            initialSelection={initialSelection}
            locale="en"
            doneLabel="Done"
            onCancel={onCancel}
            onDone={onDone}
            onExportFailed={onExportFailed}
          />
        </PiwinUiProvider>,
      );
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function stage(): HTMLElement {
    const element = document.querySelector<HTMLElement>('.screen-capture-stage');
    if (!element) throw new Error('stage not rendered');
    return element;
  }

  function pointer(type: string, x: number, y: number): void {
    act(() => {
      stage().dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
      );
    });
  }

  function dragOnStage(from: [number, number], to: [number, number]): void {
    pointer('pointerdown', from[0], from[1]);
    pointer('pointermove', to[0], to[1]);
    pointer('pointerup', to[0], to[1]);
  }

  function key(init: KeyboardEventInit, target: EventTarget = window): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    });
  }

  function drawnBoxes(): Element[] {
    return [...document.querySelectorAll('.screen-capture-overlay g[stroke="#E5322D"] > rect')];
  }

  it('starts at step 1 and shows the toolbar after a region is dragged', () => {
    mount(null);
    expect(stage().dataset['step']).toBe('select');
    expect(document.querySelector('.screen-capture-toolbar')).toBeNull();
    dragOnStage([100, 100], [400, 300]);
    expect(stage().dataset['step']).toBe('edit');
    expect(document.querySelector('.screen-capture-toolbar')).not.toBeNull();
    expect(document.querySelector('.screen-capture-size')?.textContent).toBe('300 × 200');
  });

  it('draws a box inside the region and undoes it with ⌘Z', () => {
    mount(null);
    dragOnStage([100, 100], [400, 300]);
    key({ key: 'r' });
    dragOnStage([120, 120], [200, 200]);
    expect(drawnBoxes()).toHaveLength(1);
    key({ key: 'z', metaKey: true });
    expect(drawnBoxes()).toHaveLength(0);
    key({ key: 'z', metaKey: true, shiftKey: true });
    expect(drawnBoxes()).toHaveLength(1);
  });

  it('toggles a tool off when it is picked again', () => {
    mount(null);
    dragOnStage([100, 100], [400, 300]);
    const pressed = (): string | null | undefined =>
      document.querySelector('[data-tool][aria-pressed="true"]')?.getAttribute('data-tool');
    const mosaic = document.querySelector<HTMLButtonElement>('[data-tool="mosaic"]');
    if (!mosaic) throw new Error('mosaic tool not rendered');
    expect(mosaic.getAttribute('aria-label')).toContain('Mosaic');
    act(() => mosaic.click());
    expect(pressed()).toBe('mosaic');
    key({ key: 'm' });
    expect(pressed()).toBeUndefined();
  });

  it('places text with the T tool and commits it on Enter', () => {
    mount(null);
    dragOnStage([10, 10], [500, 400]);
    key({ key: 't' });
    pointer('pointerdown', 50, 60);
    const input = document.querySelector<HTMLInputElement>('.screen-capture-text-input');
    if (!input) throw new Error('text field not shown');
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, 'login button');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key({ key: 'Enter' }, input);
    expect(document.querySelector('.screen-capture-text-input')).toBeNull();
    expect(document.querySelector('.screen-capture-overlay text')?.textContent).toBe(
      'login button',
    );
  });

  it('goes back to step 1 on right-click, and leaves on a second one', () => {
    mount(null);
    dragOnStage([100, 100], [400, 300]);
    act(() => {
      stage().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(stage().dataset['step']).toBe('select');
    expect(onCancel).not.toHaveBeenCalled();
    act(() => {
      stage().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape', () => {
    mount(null);
    key({ key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('starts at step 2 with a given region and reports an export failure on Enter', async () => {
    mount({ x: 0, y: 0, width: 1000, height: 600 });
    expect(document.querySelector('.screen-capture-toolbar')).not.toBeNull();
    // happy-dom has no canvas 2D context, which exercises the failure path.
    key({ key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(onExportFailed).toHaveBeenCalledWith(expect.any(AnnotationExportError));
  });
});
