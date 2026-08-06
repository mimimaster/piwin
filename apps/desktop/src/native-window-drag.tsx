/**
 * Shared native window drag helpers for macOS Overlay titlebar chrome.
 *
 * Two complementary mechanisms:
 * 1. `data-tauri-drag-region` + CSS `-webkit-app-region: drag` (native WebView)
 * 2. Synchronous `getCurrentWindow().startDragging()` on mousedown (Tauri IPC)
 *
 * `startDragging()` must run in the same turn as mousedown — never behind
 * `import().then(...)`.
 */
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Begin an OS-level window move via Tauri (no-op outside the desktop shell). */
export function startNativeWindowDrag(): void {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    void getCurrentWindow()
      .startDragging()
      .catch((error: unknown) => {
        console.warn('[piwin] native window drag failed', error);
      });
  } catch (error: unknown) {
    console.warn('[piwin] native window drag unavailable', error);
  }
}

/**
 * Only real interactive controls should block window drag.
 * Empty titleband padding, titles, and flex drag strips must still drag.
 */
export function isWindowDragBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target.closest(
      [
        'button',
        'a[href]',
        'input',
        'textarea',
        'select',
        'label',
        'option',
        'summary',
        '[role="button"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]',
        '[role="switch"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="option"]',
        '[role="slider"]',
        '[role="link"]',
        '[contenteditable="true"]',
        '[data-no-window-drag]',
        '.piwin-icon-button',
        '.right-panel-tab-main',
        '.right-panel-tab-close',
        '.context-bar-mode-badge',
        '.context-bar-origin-badge',
      ].join(', '),
    ) != null
  );
}

/** Primary-button mousedown on non-interactive chrome → window drag. */
export function handleNativeWindowDragMouseDown(
  event: ReactMouseEvent<HTMLElement>,
): void {
  if (event.button !== 0) {
    return;
  }
  if (event.defaultPrevented) {
    return;
  }
  if (isWindowDragBlockedTarget(event.target)) {
    return;
  }
  // Do not preventDefault — that can cancel the native move gesture on macOS.
  startNativeWindowDrag();
}

export type WindowDragRegionProps = {
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
};

/** Flexible empty strip used as an extra window drag handle. */
export function WindowDragRegion(props: WindowDragRegionProps): ReactElement {
  return (
    <div
      className={props.className}
      data-tauri-drag-region
      data-testid={props['data-testid']}
      aria-label={props['aria-label']}
      onMouseDown={handleNativeWindowDragMouseDown}
    />
  );
}
