/**
 * Rendered-document selection → Markdown source.
 *
 * Copying out of the rendered Markdown view has to paste as Markdown (backticks,
 * fences, list markers), not as the flattened visible text, and the view's own
 * chrome (comment buttons, code-block headers, line numbers) must never reach the
 * clipboard. Pure DOM in, string out: no React, no Host, no layout reads, so it is
 * unit-testable and stays portable.
 *
 * Producers mark what the DOM cannot say by itself:
 * - `data-md-source` — literal Markdown for an element that renders lossy (mermaid);
 * - `data-md-language` — the fence info string of a rendered code block.
 */
import {
  CHROME_SELECTOR,
  cloneSelectionContents,
  elementOf,
  isMeaningful,
  tagOf,
} from './selection-dom.js';

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIGURE',
  'FIGCAPTION',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'UL',
]);

const MATH_BLOCK_CLASSES = ['katex-display', 'enhanced-math-display'];

type BlockKind = 'text' | 'list' | 'code';
type Block = { kind: BlockKind; markdown: string };
type Context = {
  /** A fragment can start mid-list; its orphan `<li>` cannot tell which list it left. */
  orphanListOrdered: boolean;
};

/** KaTeX ships MathML next to its HTML; the TeX annotation inside it is read first. */
const SKIPPED_SELECTOR = `${CHROME_SELECTOR}, .katex-mathml`;

function isChrome(node: Node): boolean {
  return node instanceof Element && node.matches(SKIPPED_SELECTOR);
}

function hasMathBlockClass(element: Element): boolean {
  return MATH_BLOCK_CLASSES.some((name) => element.classList.contains(name));
}

function isBlockElement(element: Element): boolean {
  return BLOCK_TAGS.has(tagOf(element)) || hasMathBlockClass(element);
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const value of text) {
    current = value === char ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

function fenceCode(code: string, info: string): string {
  const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1));
  return `${fence}${info}\n${code}\n${fence}`;
}

function inlineCode(content: string): string {
  const fence = '`'.repeat(longestRun(content, '`') + 1);
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${content}${pad}${fence}`;
}

function texOf(element: Element): string | null {
  const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
  const tex = annotation?.textContent?.trim();
  return tex ? tex : null;
}

/** Keep flanking whitespace outside the markers: `** a **` is not emphasis. */
function wrapInline(inner: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match || !match[2]) return inner;
  return `${match[1] ?? ''}${marker}${match[2]}${marker}${match[3] ?? ''}`;
}

function isPathLike(text: string): boolean {
  return /[\\/]/.test(text) || /\.[A-Za-z0-9]{1,8}$/.test(text);
}

function anchorMarkdown(element: Element): string {
  const text = childrenInline(element);
  if (element.classList.contains('pc')) {
    // PathChip: a code-span path that renders as a chip, or a titled link to one.
    const label = (element.querySelector('.chip-text')?.textContent ?? text).trim();
    const fullPath = element.getAttribute('data-full-path') ?? '';
    if (isPathLike(label) || !fullPath) return inlineCode(label);
    return `[${label}](${fullPath})`;
  }
  const href = element.getAttribute('href') ?? '';
  if (!href || href === '#' || /^javascript:/i.test(href)) return text;
  return `[${text}](${href})`;
}

function inlineElementMarkdown(element: Element): string {
  const literal = element.getAttribute('data-md-source');
  if (literal !== null) return literal;
  const tex = texOf(element);
  if (tex && (element.classList.contains('katex') || hasMathBlockClass(element))) {
    return hasMathBlockClass(element) ? `$$${tex}$$` : `$${tex}$`;
  }
  switch (tagOf(element)) {
    case 'BR':
      return '\n';
    case 'CODE':
      return inlineCode(element.textContent ?? '');
    case 'STRONG':
    case 'B':
      return wrapInline(childrenInline(element), '**');
    case 'EM':
    case 'I':
      return wrapInline(childrenInline(element), '*');
    case 'DEL':
    case 'S':
      return wrapInline(childrenInline(element), '~~');
    case 'A':
      return anchorMarkdown(element);
    case 'IMG':
      return `![${element.getAttribute('alt') ?? ''}](${element.getAttribute('src') ?? ''})`;
    case 'INPUT':
      return element.getAttribute('type') === 'checkbox'
        ? `${(element as HTMLInputElement).checked ? '[x]' : '[ ]'} `
        : '';
    default:
      return childrenInline(element);
  }
}

function inlineNodeMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (!(node instanceof Element) || isChrome(node)) return '';
  return inlineElementMarkdown(node);
}

function childrenInline(parent: Node): string {
  return Array.from(parent.childNodes).map(inlineNodeMarkdown).join('');
}

function tidyInline(raw: string): string {
  return (
    raw
      .replace(/ *\n */g, '\n')
      // A task checkbox emits its own trailing space; the text after it brings another.
      .replace(/(\[[ x]\]) {2,}/g, '$1 ')
      .trim()
  );
}

function inlineRunMarkdown(nodes: readonly Node[]): string {
  return tidyInline(nodes.map(inlineNodeMarkdown).join(''));
}

function codeTextOf(root: Element | DocumentFragment): string {
  const lines = root.querySelectorAll('.code-line-text');
  if (lines.length > 0) {
    return Array.from(lines)
      .map((line) => line.textContent ?? '')
      .join('\n');
  }
  return (root.textContent ?? '').replace(/\n$/, '');
}

function languageOf(pre: Element, hint: string | null): string {
  if (hint !== null) return hint;
  const code = pre.querySelector('code');
  const declared = code?.getAttribute('data-language');
  if (declared) return declared;
  const fromClass = /(?:^|\s)language-(\S+)/.exec(code?.getAttribute('class') ?? '');
  return fromClass?.[1] ?? '';
}

function tableMarkdown(table: Element): Block[] {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.children).filter((cell) => ['TH', 'TD'].includes(tagOf(cell))),
  );
  const [header, ...body] = rows;
  if (!header || header.length === 0) return [];
  const cellText = (cell: Element | undefined): string =>
    tidyInline(cell ? childrenInline(cell) : '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  const alignment = header.map((cell) => {
    const align = (cell as HTMLElement).style?.textAlign || cell.getAttribute('align') || '';
    if (align === 'center') return ':---:';
    if (align === 'right') return '---:';
    return align === 'left' ? ':---' : '---';
  });
  const toLine = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const lines = [
    toLine(header.map((cell) => cellText(cell))),
    toLine(alignment),
    ...body.map((row) => toLine(header.map((_, index) => cellText(row[index])))),
  ];
  return [{ kind: 'text', markdown: lines.join('\n') }];
}

function joinItemBlocks(blocks: readonly Block[]): string {
  return blocks.reduce(
    (text, block, index) =>
      index === 0
        ? block.markdown
        : `${text}${block.kind === 'list' ? '\n' : '\n\n'}${block.markdown}`,
    '',
  );
}

function listMarkdown(
  items: readonly Element[],
  ordered: boolean,
  start: number,
  context: Context,
): Block {
  const lines = items.map((item, index) => {
    const marker = ordered ? `${start + index}. ` : '- ';
    const indent = ' '.repeat(marker.length);
    const body = joinItemBlocks(blocksOf(item, context));
    if (!body) return marker.trimEnd();
    return (
      marker +
      body
        .split('\n')
        .map((line, lineIndex) => (lineIndex === 0 || !line ? line : `${indent}${line}`))
        .join('\n')
    );
  });
  return { kind: 'list', markdown: lines.join('\n') };
}

function listElementMarkdown(list: Element, context: Context): Block[] {
  const items = Array.from(list.children).filter((child) => tagOf(child) === 'LI');
  if (items.length === 0) return [];
  const ordered = tagOf(list) === 'OL';
  const declaredStart = Number.parseInt(list.getAttribute('start') ?? '', 10);
  return [
    listMarkdown(items, ordered, Number.isFinite(declaredStart) ? declaredStart : 1, context),
  ];
}

function blockquoteMarkdown(element: Element, context: Context): Block[] {
  const inner = blocksOf(element, context)
    .map((block) => block.markdown)
    .join('\n\n');
  if (!inner) return [];
  const quoted = inner
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return [{ kind: 'text', markdown: quoted }];
}

function blockElementBlocks(element: Element, context: Context): Block[] {
  const literal = element.getAttribute('data-md-source');
  if (literal !== null) return [{ kind: 'code', markdown: literal }];
  const tex = texOf(element);
  if (tex && hasMathBlockClass(element)) {
    return [{ kind: 'code', markdown: `$$\n${tex}\n$$` }];
  }
  const fenceHint = element.getAttribute('data-md-language');
  if (fenceHint !== null) {
    const pre = element.querySelector('pre') ?? element;
    return [{ kind: 'code', markdown: fenceCode(codeTextOf(pre), fenceHint) }];
  }
  const tag = tagOf(element);
  const heading = /^H([1-6])$/.exec(tag);
  if (heading) {
    const text = tidyInline(childrenInline(element));
    return text ? [{ kind: 'text', markdown: `${'#'.repeat(Number(heading[1]))} ${text}` }] : [];
  }
  switch (tag) {
    case 'P':
    case 'SUMMARY': {
      const text = tidyInline(childrenInline(element));
      return text ? [{ kind: 'text', markdown: text }] : [];
    }
    case 'HR':
      return [{ kind: 'text', markdown: '---' }];
    case 'BLOCKQUOTE':
      return blockquoteMarkdown(element, context);
    case 'UL':
    case 'OL':
      return listElementMarkdown(element, context);
    case 'PRE':
      return [
        { kind: 'code', markdown: fenceCode(codeTextOf(element), languageOf(element, null)) },
      ];
    case 'TABLE':
      return tableMarkdown(element);
    default:
      return blocksOf(element, context);
  }
}

function blocksOf(parent: Node, context: Context): Block[] {
  const blocks: Block[] = [];
  let run: Node[] = [];
  const flushRun = (): void => {
    const text = inlineRunMarkdown(run);
    run = [];
    if (text) blocks.push({ kind: 'text', markdown: text });
  };
  const children = Array.from(parent.childNodes);
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!node || isChrome(node)) continue;
    if (node instanceof Element && tagOf(node) === 'LI') {
      flushRun();
      const items: Element[] = [];
      while (index < children.length) {
        const sibling = children[index];
        if (sibling && sibling instanceof Element && tagOf(sibling) === 'LI') items.push(sibling);
        else if (sibling && isMeaningful(sibling) && !isChrome(sibling)) break;
        index += 1;
      }
      index -= 1;
      blocks.push(listMarkdown(items, context.orphanListOrdered, 1, context));
      continue;
    }
    if (node instanceof Element && isBlockElement(node)) {
      flushRun();
      blocks.push(...blockElementBlocks(node, context));
      continue;
    }
    run.push(node);
  }
  flushRun();
  return blocks;
}

function finalize(blocks: readonly Block[]): string {
  return blocks
    .map((block) => block.markdown)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Markdown for what the range covers. A selection that stays inside one text
 * node, or inside a code block, is returned as the plain text the user picked:
 * they chose those characters, not a block, so no wrapper is invented around them.
 */
export function selectionRangeToMarkdown(range: Range): string {
  const host = elementOf(range.commonAncestorContainer);
  if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
    return range.toString();
  }
  if (host?.closest('pre')) {
    return codeTextOf(cloneSelectionContents(range));
  }
  const context: Context = { orphanListOrdered: Boolean(host?.closest('ol')) };
  return finalize(blocksOf(cloneSelectionContents(range), context));
}

/** Markdown for one rendered block, for per-block copy affordances. */
export function elementToMarkdown(element: Element): string {
  const context: Context = { orphanListOrdered: Boolean(element.closest('ol')) };
  return finalize(blockElementBlocks(element, context));
}
