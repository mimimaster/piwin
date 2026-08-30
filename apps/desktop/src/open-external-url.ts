import { isTauriRuntime } from './tauri-pty.js';

/** Open http(s) in the system browser. Tauri webview `window.open` does nothing. */
export async function openExternalUrl(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    if (isTauriRuntime()) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(trimmed);
      return true;
    }
    const opened = window.open(trimmed, '_blank', 'noopener,noreferrer');
    return opened !== null;
  } catch {
    return false;
  }
}
