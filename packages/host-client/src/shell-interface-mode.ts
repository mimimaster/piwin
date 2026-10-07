/**
 * Which interface the mobile shell renders.
 *
 * The shell ships two front ends in one bundle: `web` — the responsive
 * workbench shared with Desktop and the browser, the default — and `classic`,
 * the original phone-only interface, kept as a fallback. They are separate
 * pages on one origin, so the choice is a device-local preference read before
 * either page boots; switching is a navigation, never a live swap.
 */

export const SHELL_INTERFACE_MODES = ['web', 'classic'] as const;

export type ShellInterfaceMode = (typeof SHELL_INTERFACE_MODES)[number];

export const DEFAULT_SHELL_INTERFACE_MODE: ShellInterfaceMode = 'web';

export const SHELL_INTERFACE_MODE_STORAGE_KEY = 'piwin.mobile.interface-mode';

const SHELL_INTERFACE_ENTRY_PATHS: Record<ShellInterfaceMode, string> = {
  web: '/index.html',
  classic: '/classic/index.html',
};

// Structural, not DOM types: this package is also compiled for Node hosts.
type ModeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type ModeLocation = { replace(url: string): void };

export function parseShellInterfaceMode(raw: unknown): ShellInterfaceMode {
  return raw === 'classic' ? 'classic' : DEFAULT_SHELL_INTERFACE_MODE;
}

export function shellInterfaceEntryPath(mode: ShellInterfaceMode): string {
  return SHELL_INTERFACE_ENTRY_PATHS[mode];
}

export function readShellInterfaceMode(storage: ModeStorage | undefined): ShellInterfaceMode {
  if (storage === undefined) {
    return DEFAULT_SHELL_INTERFACE_MODE;
  }
  try {
    return parseShellInterfaceMode(storage.getItem(SHELL_INTERFACE_MODE_STORAGE_KEY));
  } catch {
    // Storage can throw in a locked-down webview; the default still boots.
    return DEFAULT_SHELL_INTERFACE_MODE;
  }
}

export function writeShellInterfaceMode(
  storage: ModeStorage,
  mode: ShellInterfaceMode,
): void {
  storage.setItem(SHELL_INTERFACE_MODE_STORAGE_KEY, mode);
}

/** Persist the choice and navigate to that interface's entry page. */
export function switchShellInterface(
  mode: ShellInterfaceMode,
  view: { localStorage: ModeStorage; location: ModeLocation },
): void {
  writeShellInterfaceMode(view.localStorage, mode);
  view.location.replace(shellInterfaceEntryPath(mode));
}

/**
 * Inline script for the `web` entry page. It must run before the workbench
 * bundle is requested, so a device set to `classic` never pays for loading it.
 * Kept free of syntax newer than the shell's oldest supported webview.
 */
export function shellInterfaceBootScript(): string {
  const key = JSON.stringify(SHELL_INTERFACE_MODE_STORAGE_KEY);
  const classicEntry = JSON.stringify(shellInterfaceEntryPath('classic'));
  return [
    '(function(){',
    'try{',
    `if(window.localStorage.getItem(${key})==="classic"){`,
    `window.location.replace(${classicEntry});`,
    '}',
    '}catch(e){}',
    '})();',
  ].join('');
}

/** Insert the boot script as the first thing the `web` entry page executes. */
export function injectShellInterfaceBoot(html: string): string {
  const headOpen = /<head[^>]*>/i.exec(html);
  if (headOpen === null) {
    throw new Error('shell entry page has no <head> to carry the interface boot script');
  }
  const insertAt = headOpen.index + headOpen[0].length;
  const tag = `<script>${shellInterfaceBootScript()}</script>`;
  return `${html.slice(0, insertAt)}${tag}${html.slice(insertAt)}`;
}
