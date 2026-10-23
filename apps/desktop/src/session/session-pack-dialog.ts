/**
 * Native pickers for Host-absolute cold-storage paths.
 * packOutputDir and pack files live on the Host filesystem.
 */

export async function chooseHostDirectory(title: string): Promise<string | null | undefined> {
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (typeof dialog.open === 'function') {
      const selected = await dialog.open({
        title,
        directory: true,
        multiple: false,
      });
      return typeof selected === 'string' ? selected : null;
    }
  } catch {
    // Fall through when Tauri is unavailable.
  }
  if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
    const fallback = window.prompt(title, '');
    if (fallback === null) return null;
    return fallback.trim() || undefined;
  }
  return undefined;
}

export async function chooseSessionPackPath(title: string): Promise<string | null | undefined> {
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (typeof dialog.open === 'function') {
      const selected = await dialog.open({
        title,
        multiple: false,
        filters: [{ name: 'Piwin pack', extensions: ['piwin-pack'] }],
      });
      return typeof selected === 'string' ? selected : null;
    }
  } catch {
    // Fall through when Tauri is unavailable.
  }
  if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
    const fallback = window.prompt(title, '');
    if (fallback === null) return null;
    return fallback.trim() || undefined;
  }
  return undefined;
}
