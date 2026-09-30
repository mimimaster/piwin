// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { EnhancedMarkdownView } from './EnhancedMarkdownView';
import { selectionRangeToHtml } from './selection-html';
import { elementToMarkdown, selectionRangeToMarkdown } from './selection-markdown';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function rangeOver(node: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range;
}

function markdownOfHtml(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    return selectionRangeToMarkdown(rangeOver(host));
  } finally {
    host.remove();
  }
}

describe('selectionRangeToMarkdown (plain DOM)', () => {
  it('keeps inline formatting, links and code spans as Markdown', () => {
    expect(
      markdownOfHtml(
        '<p>Use <strong>bold</strong>, <em>italic</em>, <code>a.ts</code> and <a href="https://x.dev">docs</a>.</p>',
      ),
    ).toBe('Use **bold**, *italic*, `a.ts` and [docs](https://x.dev).');
  });

  it('serializes headings, quotes and separators between blocks', () => {
    expect(
      markdownOfHtml('<h2>Title</h2><p>one</p><blockquote><p>quoted</p></blockquote><hr>'),
    ).toBe('## Title\n\none\n\n> quoted\n\n---');
  });

  it('nests lists and renders task checkboxes', () => {
    const html =
      '<ul><li><div>parent</div><ul><li>child</li></ul></li>' +
      '<li><input type="checkbox" disabled> todo</li>' +
      '<li><input type="checkbox" disabled checked> done</li></ul>';
    expect(markdownOfHtml(html)).toBe('- parent\n  - child\n- [ ] todo\n- [x] done');
  });

  it('numbers ordered lists from their start attribute', () => {
    expect(markdownOfHtml('<ol start="3"><li>c</li><li>d</li></ol>')).toBe('3. c\n4. d');
  });

  it('restores orphan list items of a selection that started mid-list', () => {
    const host = document.createElement('div');
    host.innerHTML = '<ol><li>one</li><li>two</li><li>three</li></ol>';
    document.body.appendChild(host);
    const items = host.querySelectorAll('li');
    const range = document.createRange();
    range.setStart(items[0]?.firstChild as Text, 0);
    range.setEnd(items[1]?.firstChild as Text, 3);
    expect(selectionRangeToMarkdown(range)).toBe('1. one\n2. two');
    host.remove();
  });

  it('fences code blocks with their language and never emits line numbers or the header', () => {
    const html =
      '<div class="enhanced-code-block" data-md-language="ts">' +
      '<div class="enhanced-code-header"><span class="code-lang">ts</span><button>Copy</button></div>' +
      '<pre class="enhanced-code"><code>' +
      '<div class="enhanced-line-wrapper diff-line"><div class="line-main-content">' +
      '<span class="code-line-num">1</span><span class="code-line-text">const a = 1;</span></div>' +
      '<button class="line-comment-btn"></button></div>' +
      '<div class="enhanced-line-wrapper diff-line"><div class="line-main-content">' +
      '<span class="code-line-num">2</span><span class="code-line-text">const b = 2;</span></div></div>' +
      '</code></pre></div>';
    expect(markdownOfHtml(html)).toBe('```ts\nconst a = 1;\nconst b = 2;\n```');
  });

  it('widens the fence when the code itself contains backticks', () => {
    expect(markdownOfHtml('<pre><code class="language-md">```js\nx\n```</code></pre>')).toBe(
      '````md\n```js\nx\n```\n````',
    );
  });

  it('returns only the picked characters when the selection stays inside a code line', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<pre><code><div class="diff-line"><span class="code-line-num">1</span>' +
      '<span class="code-line-text">const answer = 42;</span></div></code></pre>';
    document.body.appendChild(host);
    const text = host.querySelector('.code-line-text')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 12);
    expect(selectionRangeToMarkdown(range)).toBe('answer');
    host.remove();
  });

  it('drops the line numbers when a selection covers several code lines', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<pre><code>' +
      '<div class="diff-line"><span class="code-line-num">1</span><span class="code-line-text">alpha</span></div>' +
      '<div class="diff-line"><span class="code-line-num">2</span><span class="code-line-text">beta</span></div>' +
      '</code></pre>';
    document.body.appendChild(host);
    const lines = host.querySelectorAll('.code-line-text');
    const range = document.createRange();
    range.setStart(lines[0]?.firstChild as Text, 1);
    range.setEnd(lines[1]?.firstChild as Text, 3);
    expect(selectionRangeToMarkdown(range)).toBe('lpha\nbet');
    host.remove();
  });

  it('renders GFM tables with alignment', () => {
    const html =
      '<table><thead><tr><th style="text-align:left">A</th><th style="text-align:right">B</th></tr></thead>' +
      '<tbody><tr><td>1</td><td>x | y</td></tr></tbody></table>';
    expect(markdownOfHtml(html)).toBe('| A | B |\n| :--- | ---: |\n| 1 | x \\| y |');
  });

  it('reads KaTeX back as TeX', () => {
    const katex = (tex: string): string =>
      `<span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow>` +
      `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` +
      `<span class="katex-html">garbled</span></span>`;
    expect(markdownOfHtml(`<p>Energy ${katex('E=mc^2')} here</p>`)).toBe('Energy $E=mc^2$ here');
    expect(
      markdownOfHtml(
        `<div class="enhanced-math-display"><span class="katex-display">${katex('a+b')}</span></div>`,
      ),
    ).toBe('$$\na+b\n$$');
  });

  it('serializes a path chip as a code-span path', () => {
    const html =
      '<p>see <a class="pc md-doc-chip" data-full-path="/repo/docs/a.md"><svg></svg>' +
      '<span class="chip-text"><span class="chip-dir">docs/</span><span class="chip-file">a.md</span></span></a></p>';
    expect(markdownOfHtml(html)).toBe('see `docs/a.md`');
  });

  it('uses data-md-source literally for lossy renders such as mermaid', () => {
    const html = '<div data-md-source="```mermaid\ngraph TD\n```"><svg><text>A</text></svg></div>';
    expect(markdownOfHtml(html)).toBe('```mermaid\ngraph TD\n```');
  });

  it('never leaks comment chrome into the output', () => {
    expect(
      markdownOfHtml(
        '<div class="enhanced-line-wrapper"><div class="line-main-content"><p>text</p></div>' +
          '<button class="line-comment-btn">c</button><button class="line-copy-btn">x</button>' +
          '<div class="line-comment-popover-anchor"><textarea>draft</textarea></div></div>',
      ),
    ).toBe('text');
  });

  it('ignores the empty shells a triple-click drags in from the next block', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="enhanced-line-wrapper"><div class="line-main-content"><p>first paragraph</p></div></div>' +
      '<ul><li><div class="enhanced-line-wrapper"><div class="item-text">next item</div></div></li></ul>';
    document.body.appendChild(host);
    const range = document.createRange();
    range.setStart(host.querySelector('p')?.firstChild as Text, 0);
    range.setEnd(host.querySelector('.item-text')?.firstChild as Text, 0);
    expect(selectionRangeToMarkdown(range)).toBe('first paragraph');
    expect(selectionRangeToHtml(range)).not.toContain('<li');
    host.remove();
  });

  it('keeps whitespace-only code tokens and blank code lines', () => {
    const line = (num: number, text: string): string =>
      `<div class="diff-line"><span class="code-line-num">${num}</span>` +
      `<span class="code-line-text">${text}</span></div>`;
    const html =
      '<pre><code>' +
      line(1, '<span>pnpm</span><span> </span><span>test</span>') +
      line(2, '') +
      line(3, '<span>done</span>') +
      '</code></pre>';
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('code') as Node);
    expect(selectionRangeToMarkdown(range)).toBe('pnpm test\n\ndone');
    host.remove();
  });

  it('keeps empty table cells so columns stay aligned', () => {
    expect(
      markdownOfHtml('<table><tr><th>A</th><th>B</th></tr><tr><td></td><td>x</td></tr></table>'),
    ).toBe('| A | B |\n| --- | --- |\n|  | x |');
  });

  it('returns plain text for a selection inside one text node', () => {
    const host = document.createElement('p');
    host.innerHTML = 'plain <code>inline</code> text';
    document.body.appendChild(host);
    const text = host.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    expect(selectionRangeToMarkdown(range)).toBe('plain');
    host.remove();
  });
});

describe('selectionRangeToHtml', () => {
  it('strips the view chrome from the rich clipboard twin', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<p>keep</p><button class="line-comment-btn">c</button><span class="code-line-num">9</span>';
    document.body.appendChild(host);
    const html = selectionRangeToHtml(rangeOver(host));
    expect(html).toBe('<p>keep</p>');
    host.remove();
  });
});

describe('selectionRangeToHtml lists and attributes', () => {
  it('restores the list around orphan items and drops view-only attributes', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<ol><li class="enhanced-list-item"><div data-line-id="x" class="enhanced-line-wrapper">one</div></li>' +
      '<li>two</li><li>three</li></ol>';
    document.body.appendChild(host);
    const items = host.querySelectorAll('li');
    const range = document.createRange();
    range.setStart(items[0]?.querySelector('div')?.firstChild as Text, 0);
    range.setEnd(items[1]?.firstChild as Text, 3);
    expect(selectionRangeToHtml(range)).toBe('<ol><li><div>one</div></li><li>two</li></ol>');
    host.remove();
  });
});

describe('rendered EnhancedMarkdownView round trip', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function renderView(text: string, onOpenFile?: (path: string) => void): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <EnhancedMarkdownView text={text} onOpenFile={onOpenFile} />
        </PiwinUiProvider>,
      );
    });
    const article = container.querySelector<HTMLElement>('[data-testid="enhanced-markdown"]');
    if (!article) throw new Error('view did not render');
    return article;
  }

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('opts the article into text selection', () => {
    expect(renderView('hello').hasAttribute('data-selectable')).toBe(true);
  });

  it('reproduces the source of a prompt-style document', () => {
    const source = [
      '# Prompt',
      '',
      'Read `AGENTS.md` first, then **run** the checks.',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '> note',
      '',
      '```bash',
      'pnpm test',
      '```',
    ].join('\n');
    const article = renderView(source);
    expect(selectionRangeToMarkdown(rangeOver(article))).toBe(source);
  });

  it('reproduces tables, task lists, ordered lists and path chips', () => {
    const source = [
      '## Checklist',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] open',
      '- [x] closed',
      '',
      '| Name | Count |',
      '| :--- | ---: |',
      '| a | 1 |',
      '',
      'Read `docs/plans/undo.md` now.',
    ].join('\n');
    const article = renderView(source, () => undefined);
    expect(article.querySelector('.pc')).not.toBeNull();
    expect(selectionRangeToMarkdown(rangeOver(article))).toBe(source);
  });

  it('copies one rendered block as Markdown through elementToMarkdown', () => {
    const article = renderView('Say `hello` to **you**.\n\nsecond');
    const wrapper = article.querySelector('.enhanced-line-wrapper');
    expect(wrapper).not.toBeNull();
    expect(elementToMarkdown(wrapper as Element)).toBe('Say `hello` to **you**.');
  });

  it('stamps each commentable block with its line id', () => {
    const article = renderView('first paragraph');
    const wrapper = article.querySelector('.enhanced-line-wrapper');
    expect(wrapper?.getAttribute('data-line-id')).toMatch(/^paragraph-/);
  });
});
