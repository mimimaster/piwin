// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { transcriptVisibleTop } from './transcript-visible-top.js';

function scrollport(top: number, scrollPaddingTop?: string): HTMLElement {
  const element = document.createElement('div');
  if (scrollPaddingTop !== undefined) element.style.scrollPaddingTop = scrollPaddingTop;
  element.getBoundingClientRect = () => new DOMRect(0, top, 375, 600);
  document.body.append(element);
  return element;
}

describe('transcriptVisibleTop', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is the box top when nothing is reserved', () => {
    expect(transcriptVisibleTop(scrollport(44))).toBe(44);
  });

  it('starts below the strip a phone titleband covers', () => {
    expect(transcriptVisibleTop(scrollport(0, '44px'))).toBe(44);
  });

  it('ignores a non-length scroll padding', () => {
    expect(transcriptVisibleTop(scrollport(10, 'auto'))).toBe(10);
  });
});
