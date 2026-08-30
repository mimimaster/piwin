// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  CARD_SELECTION_MAX_CHARS,
  clipSelectionText,
  snapshotCardTextSelection,
} from './card-text-selection';

function textNode(element: Element): Text {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text) || node.textContent.trim().length === 0) {
    throw new Error('expected a non-empty text node');
  }
  return node;
}

function selectIn(element: Element, start: number, end: number): Selection {
  const text = textNode(element);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, Math.min(end, text.data.length));
  const selection = window.getSelection();
  if (!selection) throw new Error('expected window.getSelection');
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('snapshotCardTextSelection', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('accepts a range fully inside the same container', () => {
    const face = document.createElement('div');
    face.textContent = '什么是光合作用？';
    document.body.appendChild(face);
    selectIn(face, 0, 4);
    const snap = snapshotCardTextSelection(face);
    expect(snap?.selectedText).toBe('什么是光');
    expect(snap?.range).toBeInstanceOf(Range);
  });

  it('rejects a range that crosses out of the container', () => {
    const face = document.createElement('div');
    face.textContent = '卡片正面';
    const other = document.createElement('div');
    other.textContent = '卡片外面';
    document.body.append(face, other);
    const range = document.createRange();
    range.setStart(textNode(face), 0);
    range.setEnd(textNode(other), 2);
    const selection = window.getSelection();
    if (!selection) throw new Error('expected window.getSelection');
    selection.removeAllRanges();
    selection.addRange(range);
    expect(snapshotCardTextSelection(face)).toBeNull();
  });

  it('rejects whitespace-only selections', () => {
    const face = document.createElement('div');
    const text = document.createTextNode('   \n\t  ');
    face.appendChild(text);
    document.body.appendChild(face);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.data.length);
    const selection = window.getSelection();
    if (!selection) throw new Error('expected window.getSelection');
    selection.removeAllRanges();
    selection.addRange(range);
    expect(snapshotCardTextSelection(face)).toBeNull();
  });

  it('rejects overlong selections', () => {
    const face = document.createElement('div');
    face.textContent = '字'.repeat(CARD_SELECTION_MAX_CHARS + 1);
    document.body.appendChild(face);
    const selection = selectIn(face, 0, CARD_SELECTION_MAX_CHARS + 1);
    expect(selection.toString().length).toBe(CARD_SELECTION_MAX_CHARS + 1);
    expect(snapshotCardTextSelection(face)).toBeNull();
  });

  it('rejects a detached Range', () => {
    const face = document.createElement('div');
    face.textContent = '可分离选区';
    document.body.appendChild(face);
    selectIn(face, 0, 3);
    const before = snapshotCardTextSelection(face);
    expect(before).not.toBeNull();
    face.remove();
    expect(snapshotCardTextSelection(face)).toBeNull();
  });

  it('clips whole-face fallback text to the tutor max', () => {
    const clipped = clipSelectionText(`  ${'长'.repeat(CARD_SELECTION_MAX_CHARS + 8)}  `);
    expect(Array.from(clipped)).toHaveLength(CARD_SELECTION_MAX_CHARS);
  });
});
