// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadPetOverlayPosition,
  persistPetOverlayWindowPosition,
  PET_OVERLAY_POSITION_STORAGE_KEY,
  savePetOverlayPosition,
} from './pet-overlay-position';

describe('pet overlay position preference', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is stored or the payload is invalid', () => {
    expect(loadPetOverlayPosition()).toBeNull();
    localStorage.setItem(PET_OVERLAY_POSITION_STORAGE_KEY, 'not-json');
    expect(loadPetOverlayPosition()).toBeNull();
    localStorage.setItem(PET_OVERLAY_POSITION_STORAGE_KEY, '{"x":"a","y":1}');
    expect(loadPetOverlayPosition()).toBeNull();
  });

  it('round-trips a logical origin', () => {
    savePetOverlayPosition({ x: 24.5, y: 80 });
    expect(loadPetOverlayPosition()).toEqual({ x: 24.5, y: 80 });
  });

  it('converts physical window coordinates to logical ones', async () => {
    await persistPetOverlayWindowPosition({
      outerPosition: async () => ({ x: 200, y: 400 }),
      scaleFactor: async () => 2,
    });
    expect(loadPetOverlayPosition()).toEqual({ x: 100, y: 200 });
  });
});
