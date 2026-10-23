// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { lineIdForSelectionRange, selectionQuoteForComment } from './doc-line-anchor';

describe('lineIdForSelectionRange', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function build(): HTMLElement {
    const host = document.createElement('article');
    host.innerHTML =
      '<div data-line-id="quote-1-a"><div data-line-id="paragraph-2-b"><p>inner words</p></div></div>' +
      '<div data-line-id="paragraph-9-c"><p>other</p></div>';
    document.body.appendChild(host);
    return host;
  }

  it('anchors to the deepest block that contains the selection start', () => {
    const host = build();
    const text = host.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 5);
    expect(lineIdForSelectionRange(range)).toBe('paragraph-2-b');
  });

  it('resolves a start that lands between blocks to the block at that offset', () => {
    const host = build();
    const range = document.createRange();
    range.setStart(host, 1);
    range.setEnd(host, 2);
    expect(lineIdForSelectionRange(range)).toBe('paragraph-9-c');
  });

  it('returns null when the selection is not inside a commentable block', () => {
    const host = document.createElement('p');
    host.textContent = 'loose';
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    expect(lineIdForSelectionRange(range)).toBeNull();
  });
});

describe('selectionQuoteForComment', () => {
  it('collapses a multi-line selection into the single-line quote the prompt expects', () => {
    expect(selectionQuoteForComment('- one\n- two\n\n  three')).toBe('- one - two three');
  });
});
