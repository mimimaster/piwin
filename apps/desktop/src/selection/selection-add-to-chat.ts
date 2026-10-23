/**
 * One path from "selected text" to the Composer, shared by the transcript /
 * document selection toolbar and the Canvas selection button: the same
 * selection chip, the same length cap, then focus the draft. Never sends.
 */
import {
  dispatchContextMenuAction,
  type ContextMenuTarget,
  type DesktopContextMenuValue,
} from '../context-menu/index.js';
import {
  formatTranscriptSelectionLabel,
  TRANSCRIPT_SELECTION_MAX_CHARS,
} from '../conversation/transcript-selection-target.js';

/** Context-menu target for a text selection, capped like every selection chip. */
export function selectionContextTarget(
  text: string,
  projectPath?: string | null,
): ContextMenuTarget | null {
  const selectedText = text.slice(0, TRANSCRIPT_SELECTION_MAX_CHARS);
  if (!selectedText.trim()) return null;
  return {
    surface: 'selection',
    selectedText,
    label: formatTranscriptSelectionLabel(selectedText),
    ...(projectPath ? { projectPath } : {}),
  };
}

/** Quote the text into the Composer as a selection chip and focus the draft. */
export function addSelectionToChat(
  contextMenu: DesktopContextMenuValue,
  text: string,
  projectPath?: string | null,
): boolean {
  const target = selectionContextTarget(text, projectPath);
  if (!target) return false;
  dispatchContextMenuAction('add-to-chat', target, contextMenu.dispatchers);
  contextMenu.dispatchers.focusComposer();
  return true;
}
