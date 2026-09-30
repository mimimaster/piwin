/**
 * `copy` handler for the rendered Markdown view: puts the selection on the
 * clipboard as Markdown source (text/plain) plus a chrome-free HTML twin, so a
 * paste into the composer or an editor keeps backticks, fences and list markers.
 */
import { selectionRangeToHtml } from './selection-html.js';
import { selectionRangeToMarkdown } from './selection-markdown.js';

export type MarkdownCopyEvent = {
  clipboardData: DataTransfer | null;
  target: EventTarget | null;
  preventDefault: () => void;
};

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';

/**
 * Returns true when it took over the copy. Anything it cannot serialize faithfully
 * (a selection outside `container`, form fields, an empty result) stays with the
 * browser's native copy.
 */
export function copyMarkdownSelection(
  event: MarkdownCopyEvent,
  container: HTMLElement | null,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): boolean {
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  if (event.target instanceof Element && event.target.closest(EDITABLE_SELECTOR)) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return false;
  }
  const clipboard = event.clipboardData;
  if (!clipboard) {
    return false;
  }
  let markdown: string;
  let html: string;
  try {
    markdown = selectionRangeToMarkdown(range);
    html = selectionRangeToHtml(range);
  } catch (error) {
    // A serializer bug must never eat the user's copy: fall back to the native one.
    console.warn('[piwin] markdown selection copy failed; using native copy', error);
    return false;
  }
  if (!markdown.trim()) {
    return false;
  }
  clipboard.setData('text/plain', markdown);
  if (html) {
    clipboard.setData('text/html', html);
  }
  event.preventDefault();
  return true;
}
