// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  knowledgeContextRefFromAnchor,
  knowledgeSelectionAnchorFromRange,
  lineNumberFromAnchor,
} from './knowledge-selection-anchor.js';

/** Mirrors the reader: a window that starts at an absolute line, not at 1. */
function buildReader(options: { windowStartLine: number }): {
  body: HTMLElement;
  range: Range;
  anchor: ReturnType<typeof knowledgeSelectionAnchorFromRange>;
} {
  const body = document.createElement('article');
  body.innerHTML = [
    // Ids are window-relative, exactly like the Markdown renderer's output.
    `<p data-line-id="heading-1-h">Aging and memory</p>`,
    `<p data-line-id="paragraph-2-a">Replay during sleep moves the trace.</p>`,
    `<p data-line-id="paragraph-3-b">Spacing reopens the window.</p>`,
  ].join('');
  document.body.append(body);

  const paragraphs = body.querySelectorAll('p');
  const range = document.createRange();
  range.setStart(paragraphs[1]?.firstChild ?? body, 0);
  range.setEnd(paragraphs[2]?.firstChild ?? body, 22);

  return {
    body,
    range,
    anchor: knowledgeSelectionAnchorFromRange(range, {
      baseId: 'base-1',
      relativePath: 'notes/aging.md',
      windowStartLine: options.windowStartLine,
    }),
  };
}

describe('knowledgeSelectionAnchorFromRange', () => {
  it('maps a window-relative block id to an absolute line range', () => {
    const { anchor, body } = buildReader({ windowStartLine: 401 });
    expect(anchor?.lineStart).toBe(402);
    expect(anchor?.lineEnd).toBe(403);
    expect(anchor?.scope).toBe('selection');
    expect(anchor?.label).toBe('notes/aging.md · 402–403');
    expect(anchor?.snapshotText).toContain('Replay during sleep');
    body.remove();
  });

  it('keeps a single-line selection to one line', () => {
    const { body } = buildReader({ windowStartLine: 1 });
    const paragraph = body.querySelectorAll('p')[2];
    if (!paragraph?.firstChild) throw new Error('fixture missing paragraph');
    const single = document.createRange();
    single.setStart(paragraph.firstChild, 0);
    single.setEnd(paragraph.firstChild, 7);

    const anchor = knowledgeSelectionAnchorFromRange(single, {
      baseId: 'base-1',
      relativePath: 'notes/aging.md',
      windowStartLine: 1,
    });
    expect(anchor?.lineStart).toBe(3);
    expect(anchor?.lineEnd).toBe(3);
    expect(anchor?.label).toBe('notes/aging.md · 3');
    body.remove();
  });

  it('returns null for an empty selection instead of guessing a line', () => {
    const { body } = buildReader({ windowStartLine: 1 });
    const collapsed = document.createRange();
    collapsed.setStart(body, 0);
    collapsed.setEnd(body, 0);

    expect(
      knowledgeSelectionAnchorFromRange(collapsed, {
        baseId: 'base-1',
        relativePath: 'notes/aging.md',
        windowStartLine: 1,
      }),
    ).toBeNull();
    body.remove();
  });

  it('reads the line of an unanchored node as null', () => {
    const loose = document.createElement('div');
    expect(lineNumberFromAnchor(loose)).toBeNull();
  });

  it('wraps an anchor as a knowledge-selection context ref', () => {
    const { anchor, body } = buildReader({ windowStartLine: 1 });
    expect(anchor).not.toBeNull();
    if (!anchor) throw new Error('expected an anchor');
    const ref = knowledgeContextRefFromAnchor(anchor);
    expect(ref.kind).toBe('knowledge-selection');
    expect(ref.baseId).toBe('base-1');
    expect(ref.relativePath).toBe('notes/aging.md');
    body.remove();
  });
});
