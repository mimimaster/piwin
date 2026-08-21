// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { restoreSelectionRanges, snapshotSelectionRanges } from './selection-ranges.js';

describe('selection ranges', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('restores a range after the live selection is cleared', () => {
    const host = document.createElement('p');
    host.textContent = 'keep this highlight';
    document.body.appendChild(host);
    const text = host.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 9);
    const selection = window.getSelection();
    if (!selection) {
      throw new Error('expected window.getSelection');
    }
    selection.removeAllRanges();
    selection.addRange(range);

    const saved = snapshotSelectionRanges(selection);
    selection.removeAllRanges();
    expect(selection.toString()).toBe('');

    expect(restoreSelectionRanges(saved, selection)).toBe(true);
    expect(selection.toString()).toBe('this');
  });
});
