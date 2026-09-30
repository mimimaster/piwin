/**
 * Rich-paste twin of the Markdown selection copy: the selected DOM, minus the
 * view's chrome and view-only attributes, with broken list structure repaired.
 */
import { cloneSelectionContents, elementOf, isMeaningful, tagOf } from './selection-dom.js';

/** View-only hooks that mean nothing to the app a rich paste lands in. */
function stripViewAttributes(root: Element): void {
  root.querySelectorAll('*').forEach((element) => {
    for (const name of element.getAttributeNames()) {
      if (name === 'class' || name.startsWith('data-') || name.startsWith('aria-')) {
        element.removeAttribute(name);
      }
    }
  });
}

/** A fragment that starts mid-list holds bare `<li>`s; give them their list back. */
function wrapOrphanListItems(holder: Element, ordered: boolean): void {
  let list: Element | null = null;
  for (const child of Array.from(holder.childNodes)) {
    if (child instanceof Element && tagOf(child) === 'LI') {
      if (!list) {
        list = document.createElement(ordered ? 'ol' : 'ul');
        holder.insertBefore(list, child);
      }
      list.appendChild(child);
    } else if (isMeaningful(child)) {
      list = null;
    }
  }
}

/** Rich-paste companion of `selectionRangeToMarkdown`, without the view's chrome. */
export function selectionRangeToHtml(range: Range): string {
  const fragment = cloneSelectionContents(range);
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  wrapOrphanListItems(holder, Boolean(elementOf(range.commonAncestorContainer)?.closest('ol')));
  stripViewAttributes(holder);
  return holder.innerHTML;
}
