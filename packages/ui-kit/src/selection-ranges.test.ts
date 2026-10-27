// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  readSelectionBoundaries,
  restoreSelectionRanges,
  snapshotSelectionRanges,
  type SelectionBoundary,
} from './selection-ranges.js';

type FakeSelectionLog = { removeAllRanges: number; setBaseAndExtent: unknown[][] };

/** A selection whose live state is `current`; records every write. */
function fakeSelection(
  current: { boundaries: SelectionBoundary[] },
  options: { composed?: 'options' | 'variadic' } = {},
): { selection: Selection; log: FakeSelectionLog } {
  const log: FakeSelectionLog = { removeAllRanges: 0, setBaseAndExtent: [] };
  const fake: Record<string, unknown> = {
    get rangeCount() {
      return current.boundaries.length;
    },
    getRangeAt: (index: number) => {
      const boundary = current.boundaries[index];
      if (!boundary) throw new Error('no range');
      const range = document.createRange();
      range.setStart(boundary.startContainer, boundary.startOffset);
      range.setEnd(boundary.endContainer, boundary.endOffset);
      return range;
    },
    removeAllRanges: () => {
      log.removeAllRanges += 1;
      current.boundaries = [];
    },
    addRange: () => undefined,
    setBaseAndExtent: (...args: unknown[]) => {
      log.setBaseAndExtent.push(args);
    },
  };
  if (options.composed === 'options') {
    fake['getComposedRanges'] = (bag: { shadowRoots: ShadowRoot[] }) => {
      if (!Array.isArray(bag.shadowRoots)) throw new TypeError('bad');
      return current.boundaries;
    };
  } else if (options.composed === 'variadic') {
    fake['getComposedRanges'] = (...roots: unknown[]) => {
      if (!roots.every((root) => root instanceof ShadowRoot)) throw new TypeError('not a root');
      return current.boundaries;
    };
  }
  return { selection: fake as unknown as Selection, log };
}

function shadowText(content: string): { shadow: ShadowRoot; text: Text } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const text = document.createTextNode(content);
  shadow.appendChild(text);
  return { shadow, text };
}

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

  it('leaves an intact selection alone instead of re-adding the snapshot', () => {
    const { shadow, text } = shadowText('inside the artifact');
    const boundary = { startContainer: text, startOffset: 0, endContainer: text, endOffset: 6 };
    const current = { boundaries: [boundary] };
    const { selection, log } = fakeSelection(current, { composed: 'options' });

    const saved = snapshotSelectionRanges(selection, [shadow]);
    expect(restoreSelectionRanges(saved, selection, [shadow])).toBe(true);
    expect(log.removeAllRanges).toBe(0);
    expect(log.setBaseAndExtent).toEqual([]);
  });

  it('restores a cleared shadow-tree selection with setBaseAndExtent', () => {
    const { shadow, text } = shadowText('inside the artifact');
    const current = {
      boundaries: [{ startContainer: text, startOffset: 7, endContainer: text, endOffset: 10 }],
    };
    const { selection, log } = fakeSelection(current, { composed: 'options' });

    const saved = snapshotSelectionRanges(selection, [shadow]);
    current.boundaries = [];
    expect(restoreSelectionRanges(saved, selection, [shadow])).toBe(true);
    expect(log.setBaseAndExtent).toEqual([[text, 7, text, 10]]);
  });

  it('falls back to the variadic getComposedRanges signature', () => {
    const { shadow, text } = shadowText('inside');
    const boundary = { startContainer: text, startOffset: 1, endContainer: text, endOffset: 3 };
    const { selection } = fakeSelection({ boundaries: [boundary] }, { composed: 'variadic' });
    expect(readSelectionBoundaries(selection, [shadow])).toEqual([boundary]);
  });
});
