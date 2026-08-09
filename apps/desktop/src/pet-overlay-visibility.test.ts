// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPetOverlayVisibility,
  loadPetOverlayVisibility,
  PET_OVERLAY_VISIBILITY_STORAGE_KEY,
  savePetOverlayVisibility,
  subscribePetOverlayVisibility,
  updatePetOverlayVisibility,
} from './pet-overlay-visibility.js';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('pet overlay visibility preference', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    localStorage.clear();
  });

  function enableTauriRuntime(): void {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  }

  it('defaults to visible and only treats the exact false value as hidden', () => {
    expect(loadPetOverlayVisibility()).toBe(true);

    localStorage.setItem(PET_OVERLAY_VISIBILITY_STORAGE_KEY, 'false');
    expect(loadPetOverlayVisibility()).toBe(false);

    localStorage.setItem(PET_OVERLAY_VISIBILITY_STORAGE_KEY, 'invalid');
    expect(loadPetOverlayVisibility()).toBe(true);
  });

  it('notifies same-window subscribers when the preference changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePetOverlayVisibility(listener);

    savePetOverlayVisibility(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(localStorage.getItem(PET_OVERLAY_VISIBILITY_STORAGE_KEY)).toBe('false');

    unsubscribe();
    savePetOverlayVisibility(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('maps visibility to the existing native show and hide commands', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue(undefined);

    await applyPetOverlayVisibility(true);
    await applyPetOverlayVisibility(false);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pet_overlay_show');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pet_overlay_hide');
  });

  it('restores the previous preference when the native command fails', async () => {
    enableTauriRuntime();
    savePetOverlayVisibility(true);
    invokeMock.mockRejectedValue(new Error('native failure'));

    await expect(updatePetOverlayVisibility(false)).rejects.toThrow('Failed to hide');
    expect(loadPetOverlayVisibility()).toBe(true);
  });
});
