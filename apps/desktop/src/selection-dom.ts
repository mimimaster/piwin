/**
 * DOM primitives shared by the rendered-document clipboard serializers
 * (`selection-markdown.ts`, `selection-html.ts`).
 */

/** The view's own chrome: never document content, never on the clipboard. */
export const CHROME_SELECTOR = [
  'button',
  'script',
  'style',
  'template',
  'svg',
  'textarea',
  '.line-comment-btn',
  '.line-copy-btn',
  '.line-comment-popover-anchor',
  '.code-line-num',
  '.enhanced-code-header',
].join(',');

export function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

export function tagOf(element: Element): string {
  return element.tagName.toUpperCase();
}

export function isMeaningful(node: Node): boolean {
  return !(node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '');
}

const CONTENT_LEAF_SELECTOR = 'img, hr, br, input, [data-md-source], .katex';
/**
 * Only block containers can be empty shells. Inline elements (a code token that is
 * a single space) and table cells (dropping one shifts its row) carry meaning even
 * with no visible text.
 */
const SHELL_TAGS = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'UL',
]);

function hasContent(element: Element): boolean {
  return (
    (element.textContent ?? '').trim() !== '' ||
    element.matches(CONTENT_LEAF_SELECTOR) ||
    element.querySelector(CONTENT_LEAF_SELECTOR) !== null
  );
}

/**
 * A drag or triple-click usually ends at offset 0 of the next block, and
 * `cloneContents` then returns that block's ancestors as empty shells (an empty
 * `<ul><li>` would serialize as a stray "-"). Drop every block container that
 * carries no text and no leaf content. Code lines are left alone: a blank line
 * inside a `<pre>` is content.
 */
function pruneEmptyShells(root: ParentNode): void {
  root.querySelectorAll('*').forEach((element) => {
    if (!SHELL_TAGS.has(tagOf(element)) || hasContent(element)) return;
    if (element.parentElement?.closest('pre')) return;
    element.remove();
  });
}

/** What the range covers, minus the view's chrome and the empty shells at its edges. */
export function cloneSelectionContents(range: Range): DocumentFragment {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(CHROME_SELECTOR).forEach((chrome) => chrome.remove());
  // A range inside a code block has no `<pre>` in its fragment to shield the lines.
  if (!elementOf(range.commonAncestorContainer)?.closest('pre')) pruneEmptyShells(fragment);
  return fragment;
}
