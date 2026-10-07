import { isMobileTauriRuntime } from './shell-runtime.js';
import { isTauriRuntime } from './tauri-pty.js';

/**
 * The mobile shell's own command (apps/mobile external_open.rs). The shell
 * plugin's JS `open` cannot launch anything on iOS, and the shell checks the
 * target itself.
 */
export async function openWithMobileShell(url: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('mobile_open_external', { url });
}

/** Open http(s) in the system browser. Tauri webview `window.open` does nothing. */
export async function openExternalUrl(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    if (isMobileTauriRuntime()) {
      await openWithMobileShell(trimmed);
      return true;
    }
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
