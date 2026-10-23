/** Write text through the desktop webview's system clipboard bridge. */
export async function writeTextToSystemClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) {
    throw new Error('System clipboard is unavailable');
  }
  await clipboard.writeText(text);
}
