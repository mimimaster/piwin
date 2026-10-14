/**
 * In-iframe Canvas text-selection reporter.
 *
 * The Canvas document lives in an opaque-origin sandbox, so the host cannot
 * read `getSelection()` itself. The frame reports the selected text and the
 * box of its first line; the host anchors a "Comment" button there and only
 * a click in trusted chrome quotes the text into the Composer.
 *
 * Reports only in `canvas` frame mode — inline transcript frames stay quiet.
 * Embedded in the bridge bootstrap; relies on its `post`, `channelId` and
 * `currentFrameMode`.
 */
import {
  ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE,
  ARTIFACT_BRIDGE_SELECTION_TYPE,
  ARTIFACT_SELECTION_MAX_CHARS,
} from './constants.js';

/** Lets a click that collapses the selection settle before it is read. */
export const SELECTION_REPORT_DELAY_MS = 16;

export function buildSelectionRuntime(): string {
  return `
  var selectionType = ${JSON.stringify(ARTIFACT_BRIDGE_SELECTION_TYPE)};
  var selectionClearType = ${JSON.stringify(ARTIFACT_BRIDGE_SELECTION_CLEAR_TYPE)};
  var selectionReported = false;
  var selectionTimer = null;
  var clearSelectionReport = function () {
    if (!selectionReported) return;
    selectionReported = false;
    post(selectionType, { text: '', rect: null });
  };
  var reportSelection = function () {
    selectionTimer = null;
    if (currentFrameMode !== 'canvas') return;
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      clearSelectionReport();
      return;
    }
    var text = String(selection.toString() || '');
    if (!text.trim()) {
      clearSelectionReport();
      return;
    }
    var range = selection.getRangeAt(0);
    var bounds = range.getBoundingClientRect();
    var rects = range.getClientRects();
    var first = rects && rects.length > 0 ? rects[0] : bounds;
    // A selection scrolled out of the document viewport has nothing to anchor to.
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (bounds.bottom < 0 || (viewportHeight > 0 && bounds.top > viewportHeight)) {
      clearSelectionReport();
      return;
    }
    selectionReported = true;
    post(selectionType, {
      text: text.length > ${ARTIFACT_SELECTION_MAX_CHARS} ? text.slice(0, ${ARTIFACT_SELECTION_MAX_CHARS}) : text,
      rect: {
        left: first.left,
        top: first.top,
        width: Math.max(1, first.width),
        height: Math.max(1, first.height),
      },
    });
  };
  var scheduleSelectionReport = function () {
    if (selectionTimer !== null) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(reportSelection, ${SELECTION_REPORT_DELAY_MS});
  };
  document.addEventListener('mouseup', scheduleSelectionReport, true);
  document.addEventListener('keyup', function (event) {
    if (event.key === 'Shift' || String(event.key).indexOf('Arrow') === 0) {
      scheduleSelectionReport();
    } else if (event.key === 'Escape') {
      clearSelectionReport();
    }
  }, true);
  // Collapses that happen without a mouseup (re-render, script, select-all
  // undo) still have to take the host's button away.
  document.addEventListener('selectionchange', function () {
    if (!selectionReported) return;
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed) scheduleSelectionReport();
  });
  // The box moves with the content; re-anchor rather than leave the button behind.
  document.addEventListener('scroll', function () {
    if (selectionReported) scheduleSelectionReport();
  }, true);
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.channelId !== channelId || data.type !== selectionClearType) return;
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection && selection.removeAllRanges) selection.removeAllRanges();
    selectionReported = false;
  });
`;
}
