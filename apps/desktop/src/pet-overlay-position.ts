/** Desktop-only last position for the cosmetic pet overlay. */

export const PET_OVERLAY_POSITION_STORAGE_KEY = 'piwin.desktop.petOverlayPosition';

export type PetOverlayPosition = {
  x: number;
  y: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function loadPetOverlayPosition(): PetOverlayPosition | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(PET_OVERLAY_POSITION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as { x?: unknown; y?: unknown };
    if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y)) {
      return null;
    }
    return { x: record.x, y: record.y };
  } catch {
    return null;
  }
}

export function savePetOverlayPosition(position: PetOverlayPosition): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(PET_OVERLAY_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Persistence is best-effort; show still works at the default origin.
  }
}

export async function persistPetOverlayWindowPosition(window: {
  outerPosition: () => Promise<{ x: number; y: number }>;
  scaleFactor: () => Promise<number>;
}): Promise<void> {
  const pos = await window.outerPosition();
  const factor = await window.scaleFactor();
  if (!Number.isFinite(factor) || factor <= 0) {
    return;
  }
  savePetOverlayPosition({ x: pos.x / factor, y: pos.y / factor });
}
