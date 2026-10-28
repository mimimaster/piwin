// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SwipeRow, SwipeRowGroup, type SwipeAction } from './swipe-row.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function pointer(target: Element, type: string, clientX: number, clientY = 0, timeStamp = 0): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'touch',
  });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** Slow drag (no flick) far enough left to settle open. */
function swipeOpen(content: Element): void {
  pointer(content, 'pointerdown', 300, 10, 0);
  pointer(content, 'pointermove', 280, 10, 100);
  pointer(content, 'pointermove', 160, 10, 1000);
  pointer(content, 'pointerup', 160, 10, 2000);
}

function actions(onArchive = vi.fn()): SwipeAction[] {
  return [
    { key: 'pin', label: 'Pin', tone: 'accent', onPress: vi.fn() },
    { key: 'archive', label: 'Archive', tone: 'danger', onPress: onArchive },
  ];
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[data-testid="swipe-row"]')];
}

function content(row: Element): Element {
  const node = row.querySelector('.ui-swipe-content');
  if (node === null) throw new Error('missing swipe content');
  return node;
}

describe('SwipeRow', () => {
  it('opens one row at a time inside a group', () => {
    act(() =>
      root.render(
        <SwipeRowGroup>
          <SwipeRow rowId="a" actions={actions()}>
            <button type="button">A</button>
          </SwipeRow>
          <SwipeRow rowId="b" actions={actions()}>
            <button type="button">B</button>
          </SwipeRow>
        </SwipeRowGroup>,
      ),
    );
    const [first, second] = rows();
    if (first === undefined || second === undefined) throw new Error('rows missing');
    swipeOpen(content(first));
    expect(first.dataset.open).toBe('true');
    swipeOpen(content(second));
    expect(first.dataset.open).toBe('false');
    expect(second.dataset.open).toBe('true');
  });

  it('swallows the click that ends a drag, and a tap on an open row closes it', () => {
    const onRowClick = vi.fn();
    act(() =>
      root.render(
        <SwipeRow actions={actions()}>
          <button type="button" onClick={onRowClick}>
            Row
          </button>
        </SwipeRow>,
      ),
    );
    const [row] = rows();
    if (row === undefined) throw new Error('row missing');
    swipeOpen(content(row));
    const button = row.querySelector('.ui-swipe-content button');
    act(() => (button as HTMLButtonElement).click());
    expect(onRowClick).not.toHaveBeenCalled();
    expect(row.dataset.open).toBe('true');
    act(() => (button as HTMLButtonElement).click());
    expect(onRowClick).not.toHaveBeenCalled();
    expect(row.dataset.open).toBe('false');
    act(() => (button as HTMLButtonElement).click());
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('runs an action and closes the row', () => {
    const onArchive = vi.fn();
    act(() =>
      root.render(
        <SwipeRow actions={actions(onArchive)}>
          <span>Row</span>
        </SwipeRow>,
      ),
    );
    const [row] = rows();
    if (row === undefined) throw new Error('row missing');
    swipeOpen(content(row));
    act(() =>
      row.querySelector<HTMLButtonElement>('[data-testid="swipe-action-archive"]')?.click(),
    );
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(row.dataset.open).toBe('false');
  });

  it('leaves vertical pans to the page', () => {
    act(() =>
      root.render(
        <SwipeRow actions={actions()}>
          <span>Row</span>
        </SwipeRow>,
      ),
    );
    const [row] = rows();
    if (row === undefined) throw new Error('row missing');
    const node = content(row);
    pointer(node, 'pointerdown', 300, 10, 0);
    pointer(node, 'pointermove', 296, 80, 100);
    pointer(node, 'pointermove', 200, 90, 200);
    pointer(node, 'pointerup', 200, 90, 300);
    expect(row.dataset.open).toBe('false');
  });

  it('renders children bare when there is nothing to reveal', () => {
    act(() =>
      root.render(
        <SwipeRow actions={[]}>
          <span data-testid="bare">Row</span>
        </SwipeRow>,
      ),
    );
    expect(rows()).toHaveLength(0);
    expect(host.querySelector('[data-testid="bare"]')).not.toBeNull();
  });
});
