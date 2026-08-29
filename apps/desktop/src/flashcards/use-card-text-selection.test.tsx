// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useCardTextSelection } from './use-card-text-selection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { snapshot } = useCardTextSelection({ containerRef: ref });
  return (
    <div>
      <div ref={ref} data-testid="face">
        什么是光合作用？
      </div>
      <span data-testid="has-snap">{snapshot ? 'yes' : 'no'}</span>
    </div>
  );
}

function firstText(el: Element): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text)) throw new Error('expected text');
  return node;
}

describe('useCardTextSelection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.getSelection()?.removeAllRanges();
  });

  it('dismisses the snapshot when the live selection is lost', () => {
    act(() => {
      root.render(<Harness />);
    });
    const face = container.querySelector('[data-testid="face"]');
    expect(face).not.toBeNull();
    act(() => {
      const range = document.createRange();
      const text = firstText(face!);
      range.setStart(text, 0);
      range.setEnd(text, 3);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(container.querySelector('[data-testid="has-snap"]')?.textContent).toBe('yes');

    act(() => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(container.querySelector('[data-testid="has-snap"]')?.textContent).toBe('no');
  });

  it('keeps the snapshot when selection collapses onto popover chrome', () => {
    act(() => {
      root.render(<Harness />);
    });
    const face = container.querySelector('[data-testid="face"]');
    act(() => {
      const range = document.createRange();
      const text = firstText(face!);
      range.setStart(text, 0);
      range.setEnd(text, 3);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(container.querySelector('[data-testid="has-snap"]')?.textContent).toBe('yes');

    const chrome = document.createElement('div');
    chrome.setAttribute('data-testid', 'card-selection-popover');
    const button = document.createElement('button');
    chrome.appendChild(button);
    document.body.appendChild(chrome);
    act(() => {
      button.focus();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(container.querySelector('[data-testid="has-snap"]')?.textContent).toBe('yes');
    chrome.remove();
  });
});
