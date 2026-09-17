/**
 * Process-wide window presence: document visibility + native focus.
 * Native listeners register once and live for the renderer process.
 */
import { isTauriRuntime } from './tauri-pty.js';

export type WindowPresenceSnapshot = {
  focused: boolean;
  documentVisible: boolean;
};

type PresenceListener = (snapshot: WindowPresenceSnapshot) => void;

const listeners = new Set<PresenceListener>();

let snapshot: WindowPresenceSnapshot = {
  focused: true,
  documentVisible: true,
};
let installed = false;
let domFocusFallback = false;

function cloneSnapshot(): WindowPresenceSnapshot {
  return { focused: snapshot.focused, documentVisible: snapshot.documentVisible };
}

function readHasFocus(): boolean {
  return typeof document !== 'undefined' && document.hasFocus();
}

function readDocumentVisible(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function emitIfChanged(next: WindowPresenceSnapshot): void {
  if (next.focused === snapshot.focused && next.documentVisible === snapshot.documentVisible) {
    return;
  }
  snapshot = next;
  const payload = cloneSnapshot();
  for (const listener of [...listeners]) {
    try {
      listener(payload);
    } catch (error: unknown) {
      console.warn('[window-focus-signal] listener failed:', error);
    }
  }
}

function onVisibilityChange(): void {
  emitIfChanged({
    focused: snapshot.focused,
    documentVisible: readDocumentVisible(),
  });
}

function onWindowFocus(): void {
  emitIfChanged({ focused: true, documentVisible: snapshot.documentVisible });
}

function onWindowBlur(): void {
  emitIfChanged({ focused: false, documentVisible: snapshot.documentVisible });
}

function installDomFocusFallback(): void {
  if (domFocusFallback || typeof window === 'undefined') return;
  domFocusFallback = true;
  emitIfChanged({
    focused: readHasFocus(),
    documentVisible: snapshot.documentVisible,
  });
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('blur', onWindowBlur);
}

function installTauriFocus(): void {
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) =>
      getCurrentWindow().onFocusChanged((event) => {
        emitIfChanged({
          focused: event.payload,
          documentVisible: snapshot.documentVisible,
        });
      }),
    )
    .catch((error: unknown) => {
      console.warn('[window-focus-signal] window focus listener unavailable:', error);
      installDomFocusFallback();
    });
}

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  snapshot = {
    focused: isTauriRuntime() ? true : readHasFocus(),
    documentVisible: readDocumentVisible(),
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (isTauriRuntime()) {
    installTauriFocus();
  } else {
    installDomFocusFallback();
  }
}

export function getWindowPresence(): WindowPresenceSnapshot {
  try {
    if (installed) return cloneSnapshot();
    return {
      focused: isTauriRuntime() ? true : readHasFocus(),
      documentVisible: readDocumentVisible(),
    };
  } catch {
    return cloneSnapshot();
  }
}

export function subscribeWindowPresence(listener: PresenceListener): () => void {
  try {
    ensureInstalled();
    listeners.add(listener);
  } catch (error: unknown) {
    console.warn('[window-focus-signal] subscribe failed:', error);
  }
  return () => {
    listeners.delete(listener);
  };
}
