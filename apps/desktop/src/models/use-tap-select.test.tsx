// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTapSelect, PRESS_DELAY_MS } from './use-tap-select.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function List({ onSelect }: { onSelect: (key: string) => void }) {
  const tap = useTapSelect(onSelect);
  return (
    <div data-testid="list" onScroll={tap.cancel}>
      {['a', 'b'].map((key) => (
        <button key={key} type="button" data-testid={key} data-pressed={String(tap.pressedKey === key)} {...tap.rowProps(key)}>
          {key}
        </button>
      ))}
    </div>
  );
}

let root: Root;
let host: HTMLDivElement;
const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const fire = (target: Element, type: string, init: PointerEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init }));
  });

function mount(onSelect: (key: string) => void) {
  act(() => root.render(<List onSelect={onSelect} />));
}

describe('useTapSelect', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('selects on a still pointer-up, not on pointer-down', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    fire(el('a'), 'pointerdown', { clientX: 10, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();
    fire(el('a'), 'pointerup', { clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('cancels when the pointer moves more than 8px', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    fire(el('a'), 'pointerdown', { clientX: 10, clientY: 10 });
    fire(el('a'), 'pointermove', { clientX: 10, clientY: 19 });
    fire(el('a'), 'pointerup', { clientX: 10, clientY: 19 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('tolerates jitter within 8px', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    fire(el('a'), 'pointerdown', { clientX: 10, clientY: 10 });
    fire(el('a'), 'pointermove', { clientX: 14, clientY: 15 });
    fire(el('a'), 'pointerup', { clientX: 14, clientY: 15 });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('cancels on list scroll and on pointercancel', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    fire(el('a'), 'pointerdown');
    act(() => {
      el('list').dispatchEvent(new window.Event('scroll'));
    });
    fire(el('a'), 'pointerup');
    fire(el('a'), 'pointerdown');
    fire(el('a'), 'pointercancel');
    fire(el('a'), 'pointerup');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('delays the pressed state by 120ms', () => {
    mount(vi.fn());
    fire(el('a'), 'pointerdown');
    act(() => vi.advanceTimersByTime(PRESS_DELAY_MS - 20));
    expect(el('a').dataset.pressed).toBe('false');
    act(() => vi.advanceTimersByTime(40));
    expect(el('a').dataset.pressed).toBe('true');
  });

  it('does not select when released over another row', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    fire(el('a'), 'pointerdown');
    fire(el('b'), 'pointerup');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keyboard click (detail 0) selects', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    act(() => {
      el('b').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
