/**
 * `copy` inside the static Artifact preview puts the selected text on the
 * clipboard as plain text only. The browser's own copy adds a `text/html`
 * twin carrying the model's markup and inline styles, which a paste into an
 * editor or chat box turns back into tags and formatting.
 */
import { readSelectionBoundaries } from '@piwin/ui-kit';
import { visibleTextFromSelection } from '../conversation/transcript-selection-target.js';

export type ArtifactCopyEvent = {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
};

/**
 * Returns true when it took over the copy. A selection that leaves this
 * Artifact (or spans several ranges) stays with the browser's native copy.
 */
export function copyArtifactSelectionText(
  event: ArtifactCopyEvent,
  shadowRoot: ShadowRoot,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): boolean {
  const clipboard = event.clipboardData;
  if (!selection || !clipboard) {
    return false;
  }
  const boundaries = readSelectionBoundaries(selection, [shadowRoot]);
  const [boundary] = boundaries;
  if (
    boundaries.length !== 1 ||
    !boundary ||
    boundary.startContainer.getRootNode() !== shadowRoot ||
    boundary.endContainer.getRootNode() !== shadowRoot
  ) {
    return false;
  }
  // Selection#toString follows layout (block breaks, hidden <style>); the
  // tree walk is the fallback for engines that re-scope it to the host.
  const laidOut = selection.toString();
  const text = laidOut.trim() ? laidOut : visibleTextFromSelection(selection, [shadowRoot]);
  if (!text.trim()) {
    return false;
  }
  clipboard.setData('text/plain', text);
  event.preventDefault();
  return true;
}
