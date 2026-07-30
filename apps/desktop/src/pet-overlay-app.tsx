/**
 * Minimal app for the pet overlay window: renders only the PetSprite,
 * subscribes to pet/state pushes from the host, and supports dragging.
 * No theme provider, no router, no sidebar — just the sprite on transparent bg.
 */
import { useEffect, useState } from 'react';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import { PetSprite } from './components/PetSprite';

export function PetOverlayApp() {
  const [pet, setPet] = useState<PetRuntimeSnapshot | null>(null);

  useEffect(() => {
    // Fetch initial pet state from host.
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // The overlay window shares the same host process as the main window;
        // we can call host_request to get the current pet state.
        const response = (await invoke('host_request', {
          command: { type: 'pet/get-active' },
          timeoutMs: 5000,
        })) as { success: boolean; data?: { pet: PetRuntimeSnapshot } };
        if (response.success && response.data?.pet) {
          setPet(response.data.pet);
        }
      } catch {
        // host not ready yet — will pick up state from push
      }
    })();

    // Listen for pet/state pushes from the host.
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ pet: PetRuntimeSnapshot }>('pet-state-push', (event) => {
          if (event.payload?.pet) {
            setPet(event.payload.pet);
          }
        });
      } catch {
        // Tauri event API not available in mock mode
      }
    })();

    return () => {
      void unlisten?.();
    };
  }, []);

  // Enable dragging the overlay window by clicking anywhere on the sprite.
  useEffect(() => {
    const handler = async (e: MouseEvent) => {
      if (e.button !== 0) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch {
        // not in Tauri
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
