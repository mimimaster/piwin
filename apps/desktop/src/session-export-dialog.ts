/**
 * Shared save-path chooser for session exports.
 *
 * Tauri owns the native picker. The browser fallback keeps the mock shell
 * usable in development and tests; returning undefined means the Host should
 * use its session-local default path.
 */

export type SessionExportDialogFormat = 'md' | 'html';

export type SessionExportPathOptions = {
  defaultName: string;
  title: string;
  format: SessionExportDialogFormat;
};

/**
 * @returns selected path, `null` when the user cancels, or `undefined` when
 * no picker is available and the Host default path should be used.
 */
export async function chooseSessionExportPath(
  options: SessionExportPathOptions,
): Promise<string | null | undefined> {
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (typeof dialog.save === 'function') {
      const selected = await dialog.save({
        title: options.title,
        defaultPath: options.defaultName,
        filters:
          options.format === 'html'
            ? [{ name: 'HTML', extensions: ['html'] }]
            : [{ name: 'Markdown', extensions: ['md'] }],
      });
      return selected;
    }
  } catch {
    // Fall through to the browser prompt when Tauri is unavailable.
  }

  if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
    const fallback = window.prompt(
      'Export path (leave empty for the session default)',
      options.defaultName,
    );
    if (fallback === null) {
      return null;
    }
    return fallback.trim() || undefined;
  }

  return undefined;
}
