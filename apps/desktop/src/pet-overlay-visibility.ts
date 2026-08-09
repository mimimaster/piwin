/** Desktop-only visibility preference for the cosmetic pet overlay. */

export const PET_OVERLAY_VISIBILITY_STORAGE_KEY = 'piwin.desktop.petOverlayVisible';

const PET_OVERLAY_VISIBILITY_EVENT = 'piwin:pet-overlay-visibility';

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export function loadPetOverlayVisibility(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(PET_OVERLAY_VISIBILITY_STORAGE_KEY) !== 'false';
  } catch {
    // localStorage can be unavailable in private/embedded contexts. Visible is
    // the backward-compatible default and still leaves the native command usable.
    return true;
  }
}

export function savePetOverlayVisibility(visible: boolean): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PET_OVERLAY_VISIBILITY_STORAGE_KEY, String(visible));
    } catch {
      // Persistence is best-effort; the native command below still applies the
      // requested state for the current process.
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<boolean>(PET_OVERLAY_VISIBILITY_EVENT, { detail: visible }),
    );
  }
}

export function subscribePetOverlayVisibility(listener: (visible: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleLocalChange = (event: Event): void => {
    const visibilityEvent = event as CustomEvent<boolean>;
    listener(visibilityEvent.detail);
  };
  const handleStorageChange = (event: StorageEvent): void => {
    if (event.key === PET_OVERLAY_VISIBILITY_STORAGE_KEY || event.key === null) {
      listener(loadPetOverlayVisibility());
    }
  };

  window.addEventListener(PET_OVERLAY_VISIBILITY_EVENT, handleLocalChange);
  window.addEventListener('storage', handleStorageChange);
  return () => {
    window.removeEventListener(PET_OVERLAY_VISIBILITY_EVENT, handleLocalChange);
    window.removeEventListener('storage', handleStorageChange);
  };
}

/** Apply a visibility state to Tauri without changing the saved preference. */
export async function applyPetOverlayVisibility(visible: boolean): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!(window as TauriRuntimeWindow).__TAURI_INTERNALS__) return;

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(visible ? 'pet_overlay_show' : 'pet_overlay_hide');
}

/** Persist and apply one user-requested visibility change transactionally. */
export async function updatePetOverlayVisibility(visible: boolean): Promise<void> {
  const previousVisibility = loadPetOverlayVisibility();
  savePetOverlayVisibility(visible);
  try {
    await applyPetOverlayVisibility(visible);
  } catch (cause) {
    savePetOverlayVisibility(previousVisibility);
    throw new Error(
      visible ? 'Failed to show the pet overlay' : 'Failed to hide the pet overlay',
      { cause },
    );
  }
}
