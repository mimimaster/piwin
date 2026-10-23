/**
 * Native folder picker for opening a workspace.
 * Tauri uses the OS dialog; browser/mock returns null so the UI can fall back.
 */

export function isDesktopShellRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type PickProjectDirectoryOptions = {
  /** Preselect this folder when the OS dialog supports it. */
  defaultPath?: string;
  title?: string;
};

/**
 * Opens the system "choose folder" dialog when running inside Tauri.
 * Returns an absolute directory path, or null when cancelled / unavailable.
 */
export async function pickProjectDirectory(
  options: PickProjectDirectoryOptions = {},
): Promise<string | null> {
  if (!isDesktopShellRuntime()) {
    return null;
  }

  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (typeof dialog.open !== 'function') {
      return null;
    }

    const openOptions: {
      directory: true;
      multiple: false;
      title: string;
      defaultPath?: string;
    } = {
      directory: true,
      multiple: false,
      title: options.title ?? 'Open workspace',
    };
    if (options.defaultPath && options.defaultPath.trim()) {
      openOptions.defaultPath = options.defaultPath.trim();
    }

    const selected = await dialog.open(openOptions);
    if (typeof selected === 'string' && selected.trim()) {
      return selected.trim();
    }
    // Some platforms may still return a one-item array when multiple:false.
    if (Array.isArray(selected) && typeof selected[0] === 'string' && selected[0].trim()) {
      return selected[0].trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Native file picker for a Host-local executable/script.
 * Returns null when cancelled, not running in Tauri, or the dialog is unavailable.
 */
export async function pickLocalFile(options: PickProjectDirectoryOptions = {}): Promise<string | null> {
  if (!isDesktopShellRuntime()) {
    return null;
  }
  try {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (typeof dialog.open !== 'function') {
      return null;
    }
    const selected = await dialog.open({
      directory: false,
      multiple: false,
      title: options.title ?? 'Choose script',
      ...(options.defaultPath?.trim() ? { defaultPath: options.defaultPath.trim() } : {}),
    });
    if (typeof selected === 'string' && selected.trim()) {
      return selected.trim();
    }
    if (Array.isArray(selected) && typeof selected[0] === 'string' && selected[0].trim()) {
      return selected[0].trim();
    }
    return null;
  } catch {
    return null;
  }
}
