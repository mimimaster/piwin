// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyMarkdownSelection, type MarkdownCopyEvent } from './markdown-selection-copy';

function buildHost(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function selectAll(node: Node): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error('expected window.getSelection');
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function copyEvent(target: EventTarget | null = null) {
  const setData = vi.fn();
  const preventDefault = vi.fn();
  const event: MarkdownCopyEvent = {
    clipboardData: { setData } as unknown as DataTransfer,
    target,
    preventDefault,
  };
  return { event, setData, preventDefault };
}

describe('copyMarkdownSelection', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('writes Markdown as text/plain and chrome-free HTML as text/html', () => {
    const host = buildHost('<p>Use <code>a.ts</code></p><button class="line-comment-btn">c</button>');
    const selection = selectAll(host);
    const { event, setData, preventDefault } = copyEvent(host);

    expect(copyMarkdownSelection(event, host, selection)).toBe(true);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Use `a.ts`');
    expect(setData).toHaveBeenCalledWith('text/html', '<p>Use <code>a.ts</code></p>');
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('leaves a collapsed selection to the browser', () => {
    const host = buildHost('<p>text</p>');
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const { event, preventDefault } = copyEvent(host);

    expect(copyMarkdownSelection(event, host, selection)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('leaves selections outside the container to the browser', () => {
    const host = buildHost('<p>inside</p>');
    const outside = buildHost('<p>outside</p>');
    const selection = selectAll(outside);
    const { event, preventDefault } = copyEvent(outside);

    expect(copyMarkdownSelection(event, host, selection)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('never intercepts a copy that starts in a form field', () => {
    const host = buildHost('<p>text</p><textarea>draft</textarea>');
    const selection = selectAll(host);
    const { event, preventDefault } = copyEvent(host.querySelector('textarea'));

    expect(copyMarkdownSelection(event, host, selection)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('falls back to the native copy when nothing serializable is selected', () => {
    const host = buildHost('<button class="line-comment-btn">c</button>');
    const selection = selectAll(host);
    const { event, preventDefault } = copyEvent(host);

    expect(copyMarkdownSelection(event, host, selection)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
