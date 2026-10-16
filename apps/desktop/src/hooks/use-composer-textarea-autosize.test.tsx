// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  COMPOSER_RESIZE_SKIP_MIN_CHARS,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  useComposerTextareaAutosize,
  type ComposerTextareaResize,
} from './use-composer-textarea-autosize';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let frames: FrameRequestCallback[] = [];
let resize: ComposerTextareaResize = () => undefined;

function Harness({ value, layoutKey }: { value: string; layoutKey: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  resize = useComposerTextareaAutosize(ref, value, layoutKey);
  return <textarea ref={ref} value={value} readOnly />;
}

function flushFrames(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(0);
}

describe('useComposerTextareaAutosize', () => {
  let container: HTMLDivElement;
  let root: Root;
  let heightWrites: string[];

  beforeEach(() => {
    frames = [];
    heightWrites = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.splice(id - 1, 1, () => undefined);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(value: string, layoutKey = 'docked'): HTMLTextAreaElement {
    act(() => root.render(<Harness value={value} layoutKey={layoutKey} />));
    const element = container.querySelector('textarea');
    if (!element) throw new Error('textarea missing');
    Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => 900 });
    const style = element.style;
    const setHeight = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'height');
    Object.defineProperty(style, 'height', {
      configurable: true,
      get: () => setHeight?.get?.call(style) as string,
      set: (next: string) => {
        heightWrites.push(next);
        setHeight?.set?.call(style, next);
      },
    });
    return element;
  }

  it('caps the height and skips re-measuring a long draft already at the cap', () => {
    const long = 'x'.repeat(COMPOSER_RESIZE_SKIP_MIN_CHARS);
    const element = render(long);
    resize({ force: true });
    flushFrames();
    expect(element.style.height).toBe(`${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`);

    heightWrites = [];
    render(`${long}y`);
    flushFrames();
    expect(heightWrites).toEqual([]);
  });

  it('keeps a forced request when a plain request lands in the same frame', () => {
    const long = 'x'.repeat(COMPOSER_RESIZE_SKIP_MIN_CHARS);
    render(long);
    resize({ force: true });
    flushFrames();

    heightWrites = [];
    resize({ force: true });
    resize();
    flushFrames();
    expect(heightWrites).toEqual(['auto', `${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`]);
  });

  it('re-measures short drafts on every change', () => {
    const element = render('hello');
    flushFrames();
    heightWrites = [];
    render('hello!');
    flushFrames();
    expect(heightWrites).toEqual(['auto', `${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`]);
    expect(element.style.height).toBe(`${COMPOSER_TEXTAREA_MAX_HEIGHT_PX}px`);
  });
});
