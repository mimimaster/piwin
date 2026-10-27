/**
 * In-iframe plain-text copy.
 *
 * The browser's own copy of a selection in the Artifact document adds a
 * `text/html` twin carrying the page's markup and inline styles; a paste into
 * an editor or chat box turns that back into tags and formatting. The reader
 * asked for the words they selected, so the clipboard gets `text/plain` only.
 *
 * Runs in every frame mode. A copy the Artifact handles itself (it called
 * `preventDefault`) and copies out of form fields stay untouched.
 * Embedded in the bridge bootstrap.
 */
export function buildPlainTextCopyRuntime(): string {
  return `
  document.addEventListener('copy', function (event) {
    if (event.defaultPrevented || !event.clipboardData) return;
    var target = event.target;
    var element = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (element && element.closest && element.closest('input, textarea, [contenteditable]')) return;
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed) return;
    var text = String(selection.toString() || '');
    if (!text.trim()) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  });
`;
}
