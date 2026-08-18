/**
 * Minimal app for the pet overlay window: renders only the PetSprite,
 * subscribes to pet/state pushes from the host, supports dragging, and
 * resizes the OS window tightly around the sprite (+ bubble band when active).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { PetSprite } from './components/PetSprite';
import {
  resolvePetDisplaySize,
  resolvePetOverlayWindowSize,
} from './components/pet-display-size.js';
import { loadDesktopLocale, type DesktopLocale } from './desktop-locale.js';
import { petToActivityInput } from './pet-activity-mapper.js';
import { persistPetOverlayWindowPosition } from './pet-overlay-position.js';
import {
  applyPetOverlayVisibility,
  loadPetOverlayVisibility,
  updatePetOverlayVisibility,
} from './pet-overlay-visibility.js';

export function PetOverlayApp() {
  const [pet, setPet] = useState<PetRuntimeSnapshot | null>(null);
  const [locale, setLocale] = useState<DesktopLocale>(() => loadDesktopLocale());
  const tauriWindow = useRef<TauriWindow | null>(null);

  // Window is created on demand. Re-apply the saved preference after this
  // entry is ready so a stale hidden preference closes the process instead of
  // leaving a second WebContent resident.
  useEffect(() => {
    void applyPetOverlayVisibility(loadPetOverlayVisibility()).catch((error: unknown) => {
      console.error('Failed to restore pet overlay visibility', error);
    });
  }, []);

  const hidePet = useCallback((): void => {
    void (async () => {
      if (tauriWindow.current) {
        try {
          await persistPetOverlayWindowPosition(tauriWindow.current);
        } catch {
          // Position is best-effort; hide must still destroy the window.
        }
      }
      await updatePetOverlayVisibility(false);
    })().catch((error: unknown) => {
      console.error('Failed to hide pet overlay', error);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let receivedPush = false;
    let retryTimer: number | undefined;
    let unlisten: (() => void) | undefined;

    async function fetchInitialPet(): Promise<boolean> {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const response = (await invoke('host_request', {
          command: { type: 'pet/get-active' },
          timeoutMs: 5000,
        })) as { success: boolean; data?: { pet?: PetRuntimeSnapshot } };
        if (response.success && response.data?.pet) {
          if (!disposed && !receivedPush) {
            setPet(response.data.pet);
          }
          return true;
        }
      } catch {
        // host not ready yet — will pick up state from push
      }
      return false;
    }

    async function loadPet(): Promise<void> {
      if (disposed) return;
      const loaded = await fetchInitialPet();
      if (!loaded && !disposed) {
        retryTimer = window.setTimeout(() => void loadPet(), 250);
      }
    }

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const removeListener = await listen<{ pet: PetRuntimeSnapshot }>(
          'pet-state-push',
          (event) => {
            if (disposed || !event.payload?.pet) return;
            receivedPush = true;
            setPet(event.payload.pet);
          },
        );
        if (disposed) {
          removeListener();
        } else {
          unlisten = removeListener;
        }
      } catch {
        // Tauri event API not available in mock mode
      }
      await loadPet();
    })();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      void unlisten?.();
    };
  }, []);

  // Drag vs click on the floating pet:
  // - Immediate startDragging() swallows the click, so the main window never
  //   comes to front. Wait for a small movement threshold before dragging;
  //   a pure click raises the main app window instead.
  const dragSession = useRef<{
    startX: number;
    startY: number;
    dragging: boolean;
    onSprite: boolean;
  } | null>(null);
  const DRAG_THRESHOLD_PX = 4;

  useEffect(() => {
    let mounted = true;
    let unlistenMoved: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (!mounted) return;
        const win = getCurrentWindow();
        tauriWindow.current = win;
        unlistenMoved = await win.onMoved(() => {
          void persistPetOverlayWindowPosition(win);
        });
      } catch {
        // not in Tauri
      }
    })();

    function isOnSprite(target: EventTarget | null): boolean {
      return (target as HTMLElement | null)?.closest?.('.pet-sprite-root') != null;
    }

    function isOverlayControl(target: EventTarget | null): boolean {
      return (target as HTMLElement | null)?.closest?.('[data-pet-overlay-control]') != null;
    }

    async function raiseMainWindow(): Promise<void> {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('show_main_window');
      } catch {
        // not in Tauri / command unavailable
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isOverlayControl(e.target)) {
        dragSession.current = null;
        return;
      }
      if (!isOnSprite(e.target)) {
        dragSession.current = null;
        return;
      }
      // WKWebView otherwise paints its blue selection overlay across the
      // transparent Canvas cell while a desktop-window drag begins.
      e.preventDefault();
      dragSession.current = {
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        onSprite: true,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const session = dragSession.current;
      if (!session || session.dragging || !tauriWindow.current) return;
      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      session.dragging = true;
      tauriWindow.current.startDragging().catch(() => {
        // drag cancelled / permission missing
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      const session = dragSession.current;
      dragSession.current = null;
      if (isOverlayControl(e.target)) return;
      if (!session || session.dragging) return;
      if (!session.onSprite && !isOnSprite(e.target)) return;
      // Pure click (no drag) → bring main window to front.
      void raiseMainWindow();
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      mounted = false;
      unlistenMoved?.();
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Keep bubble locale in sync with the main window preference.
  useEffect(() => {
    setLocale(loadDesktopLocale());
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'piwin.desktop.locale' || e.key === null) {
        setLocale(loadDesktopLocale());
      }
    };
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(() => {
      const next = loadDesktopLocale();
      setLocale((prev) => (prev === next ? prev : next));
    }, 5000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
    };
  }, []);

  // Tight window size: sprite aspect + optional bubble band. Grow/shrink from
  // the bottom so the pet's feet stay put when the bubble appears/disappears.
  const hasBubble = useMemo(() => {
    if (!pet) return false;
    return petToActivityInput(pet, locale) !== null;
  }, [pet, locale]);

  const windowSize = useMemo(() => {
    if (!pet) return null;
    const display = resolvePetDisplaySize(pet.cellWidth, pet.cellHeight);
    return resolvePetOverlayWindowSize(display, hasBubble);
  }, [pet, hasBubble]);

  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!windowSize) return;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWindow, LogicalSize, LogicalPosition } =
          await import('@tauri-apps/api/window');
        if (cancelled) return;
        const win = getCurrentWindow();
        tauriWindow.current = win;

        const prev = lastSizeRef.current;
        const next = windowSize;
        if (prev && prev.width === next.width && prev.height === next.height) {
          return;
        }

        // Anchor bottom edge: when height grows, move window up by the delta.
        let nextX: number | undefined;
        let nextY: number | undefined;
        if (prev && prev.height !== next.height) {
          try {
            const pos = await win.outerPosition();
            const factor = await win.scaleFactor();
            const logicalY = pos.y / factor;
            const logicalX = pos.x / factor;
            nextY = logicalY - (next.height - prev.height);
            nextX = logicalX;
          } catch {
            // position APIs unavailable — still resize
          }
        }

        await win.setSize(new LogicalSize(next.width, next.height));
        if (nextX !== undefined && nextY !== undefined) {
          await win.setPosition(new LogicalPosition(nextX, nextY));
        }
        lastSizeRef.current = next;
      } catch {
        // not in Tauri / missing permission — keep CSS layout only
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [windowSize]);

  return (
    <div
      className="pet-overlay-root"
      style={{
        background: 'transparent',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
        position: 'relative',
      }}
      data-has-bubble={hasBubble ? 'true' : 'false'}
      data-window-w={windowSize?.width}
      data-window-h={windowSize?.height}
    >
      {pet ? <PetSprite pet={pet} overlay locale={locale} onHide={hidePet} /> : null}
    </div>
  );
}
