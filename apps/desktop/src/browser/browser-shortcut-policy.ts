/**
 * App-reserved shortcuts that the browser workbench must not forward to the
 * page (spec §4.4). Page-owned editing chords (A/Z) are listed separately in
 * the IME mapper and are forwarded while the frame is focused.
 */
export type BrowserReservedShortcut = {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  reason: string;
};

export const BROWSER_APP_RESERVED_SHORTCUTS: readonly BrowserReservedShortcut[] = [
  { key: 'k', meta: true, reason: 'command-palette' },
  { key: 'k', ctrl: true, reason: 'command-palette' },
  { key: ',', meta: true, reason: 'settings' },
  { key: ',', ctrl: true, reason: 'settings' },
  { key: 'l', meta: true, reason: 'address-bar' },
  { key: 'l', ctrl: true, reason: 'address-bar' },
  { key: 's', meta: true, shift: true, reason: 'pick-element' },
  { key: 's', ctrl: true, shift: true, reason: 'pick-element' },
];

export function isBrowserAppReservedShortcut(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  return BROWSER_APP_RESERVED_SHORTCUTS.some(
    (shortcut) =>
      shortcut.key === key &&
      Boolean(shortcut.meta) === input.metaKey &&
      Boolean(shortcut.ctrl) === input.ctrlKey &&
      Boolean(shortcut.shift) === input.shiftKey &&
      Boolean(shortcut.alt) === input.altKey,
  );
}
