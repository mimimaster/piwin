import { useEffect } from 'react';

/** Marks the element whose text the streaming caret trails. */
export const STREAM_CARET_ANCHOR_ATTRIBUTE = 'data-stream-caret';

/** Blocks that hold other blocks: the caret belongs further inside. */
const CONTAINER_TAGS = new Set([
  'DIV',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'BLOCKQUOTE',
  'PRE',
  'SECTION',
  'DETAILS',
]);

/** Blocks that hold a run of text: the caret sits at the end of that run. */
const TEXT_BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'SUMMARY']);

/**
 * Rendered widgets with their own activity state. A caret inside one would
 * land in its chrome, so the reply falls back to a caret below the block.
 */
const OPAQUE_BLOCK_SELECTOR =
  '.artifact-frame, .artifact-with-source, .md-mermaid, .md-mermaid-source, .md-mermaid-loading, .md-math-display, .artifact-canvas-launcher';

const MAX_ANCHOR_DEPTH = 16;

function lastBlockChild(element: Element): Element | null {
  for (let index = element.children.length - 1; index >= 0; index -= 1) {
    const child = element.children[index];
    if (!child || child.hasAttribute('hidden') || child.getAttribute('aria-hidden') === 'true') {
      continue;
    }
    if (CONTAINER_TAGS.has(child.tagName) || TEXT_BLOCK_TAGS.has(child.tagName)) {
      return child;
    }
  }
  return null;
}

/**
 * Finds where the last streamed text ends inside a rendered reply.
 *
 * A caret appended to the reply's last top-level block only trails the text
 * when that block is a paragraph. After a list, a table or a code block it
 * drops onto a line of its own: the reply is one line taller for as long as
 * that block is the tail, and loses the line again when the next block starts
 * or the reply completes. Anchoring the caret in the last table cell, list
 * item or code line keeps the reply's height that of its content.
 */
export function resolveStreamCaretAnchor(root: Element): Element | null {
  let node: Element = root;
  for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth += 1) {
    const next = lastBlockChild(node);
    if (!next) {
      break;
    }
    if (next.matches(OPAQUE_BLOCK_SELECTOR)) {
      return null;
    }
    node = next;
    if (TEXT_BLOCK_TAGS.has(next.tagName)) {
      break;
    }
  }
  if (node === root) {
    return null;
  }
  // A code line is a flex row of gutter and text; the caret trails the text.
  if (node.classList.contains('md-code-line')) {
    return node.querySelector(':scope > .md-code-line-text') ?? node;
  }
  return node;
}

/**
 * Keeps `data-stream-caret` on the anchor of the reply rendered under
 * `rootClassName` while `active`. Streamdown commits its blocks on its own
 * schedule, so the anchor follows the DOM rather than this component's render.
 */
export function useStreamCaretAnchor(rootClassName: string, active: boolean): void {
  useEffect(() => {
    if (!active || typeof MutationObserver === 'undefined') {
      return;
    }
    const root = document.getElementsByClassName(rootClassName)[0];
    if (!root) {
      return;
    }
    let anchored: Element | null = null;
    const place = (): void => {
      const next = resolveStreamCaretAnchor(root);
      if (next === anchored) {
        return;
      }
      anchored?.removeAttribute(STREAM_CARET_ANCHOR_ATTRIBUTE);
      next?.setAttribute(STREAM_CARET_ANCHOR_ATTRIBUTE, '');
      anchored = next;
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      anchored?.removeAttribute(STREAM_CARET_ANCHOR_ATTRIBUTE);
    };
  }, [active, rootClassName]);
}
