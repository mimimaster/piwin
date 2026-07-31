/**
 * Minimal app for the pet overlay window: renders only the PetSprite,
 * subscribes to pet/state pushes from the host, and supports dragging.
 * No theme provider, no router, no sidebar — just the sprite on transparent bg.
 */
import { useEffect, useRef, useState } from 'react';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { PetSprite } from './components/PetSprite';

export function PetOverlayApp() {
  const [pet, setPet] = useState<PetRuntimeSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;
    let receivedPush = false;
    let retryTimer: number | undefined;
    let unlisten: (() => void) | undefined;

    async function fetchInitialPet(): Promise<boolean> {
      // Fetch initial pet state from host.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // The overlay window shares the same host process as the main window;
        // we can call host_request to get the current pet state.
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

  // Enable dragging the overlay window by clicking anywhere on the sprite.
  const tauriWindow = useRef<TauriWindow | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (!mounted) return;
        tauriWindow.current = getCurrentWindow();
      } catch {
        // not in Tauri
      }
    })();

    const handler = (e: MouseEvent) => {
      if (e.button !== 0 || dragging.current || !tauriWindow.current) return;
      dragging.current = true;
      tauriWindow.current
        .startDragging()
        .catch(() => {})
        .finally(() => {
          dragging.current = false;
        });
    };
    document.addEventListener('mousedown', handler);
    return () => {
      mounted = false;
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  return (
    <div
      style={{
        background: 'transparent',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
      }}
    >
      {pet ? <PetSprite pet={pet} overlay /> : null}
    </div>
  );
}
