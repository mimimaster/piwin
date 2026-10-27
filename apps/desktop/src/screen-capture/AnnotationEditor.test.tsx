// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { AnnotationEditor } from './AnnotationEditor';
import { AnnotationExportError } from './annotation-export';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AnnotationEditor', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const onExportFailed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <AnnotationEditor
            imageUrl="data:,"
            image={{ width: 1000, height: 600 }}
            initialTool="rect"
            locale="en"
            onCancel={onCancel}
            onConfirm={onConfirm}
            onExportFailed={onExportFailed}
          />
        </PiwinUiProvider>,
      );
    });
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

  function key(init: KeyboardEventInit, target: EventTarget = window): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    });
  }

  function drawnRects(): Element[] {
    return [...document.querySelectorAll('.screen-capture-overlay rect')];
  }

  it('draws a box from a drag and undoes it with ⌘Z', () => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 120, 90);
    pointer('pointerup', 120, 90);
    expect(drawnRects()).toHaveLength(1);
    expect(drawnRects()[0]?.getAttribute('stroke')).toBe('#E5322D');

    key({ key: 'z', metaKey: true });
    expect(drawnRects()).toHaveLength(0);
    key({ key: 'z', metaKey: true, shiftKey: true });
    expect(drawnRects()).toHaveLength(1);
  });

  it('places text with the T tool and commits it on Enter', () => {
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

  it('shows icon-only tools and switches with a click or a key', () => {
    const pressed = (): string | null | undefined =>
      document.querySelector('[data-tool][aria-pressed="true"]')?.getAttribute('data-tool');
    const arrow = document.querySelector<HTMLButtonElement>('[data-tool="arrow"]');
    if (!arrow) throw new Error('arrow tool not rendered');
    expect(arrow.textContent).toBe('');
    expect(arrow.getAttribute('aria-label')).toContain('Arrow');
    expect(pressed()).toBe('rect');
    act(() => arrow.click());
    expect(pressed()).toBe('arrow');
    key({ key: 'c' });
    expect(pressed()).toBe('crop');
  });

  it('cancels on Escape', () => {
    key({ key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('reports an export failure instead of confirming', async () => {
    // happy-dom has no canvas 2D context, which exercises the failure path.
    key({ key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onExportFailed).toHaveBeenCalledWith(expect.any(AnnotationExportError));
  });
});
