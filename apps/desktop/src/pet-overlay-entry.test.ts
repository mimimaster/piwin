import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('pet overlay entry boundary', () => {
  it('uses a dedicated HTML and React entry instead of the Desktop composition root', () => {
    const html = readSource('../pet-overlay.html');
    const entry = readSource('./pet-overlay-main.tsx');

    expect(html).toContain('/src/pet-overlay-main.tsx');
    expect(html).not.toContain('/src/main.tsx');
    expect(entry).toContain("import { PetOverlayApp } from './pet-overlay-app'");
    expect(entry).toContain('installDevelopmentPerformanceTimelineGuard');
    expect(entry).not.toContain('DesktopThemeRoot');
    expect(entry).not.toContain("'./styles.css'");
  });

  it('points the native overlay window at the dedicated page', () => {
    const nativeSource = readSource('../src-tauri/src/pet_overlay.rs');
    const nativeRoot = readSource('../src-tauri/src/lib.rs');
    expect(nativeSource).toContain('WebviewUrl::App("pet-overlay.html".into())');
    expect(nativeSource).not.toContain('WebviewUrl::App("index.html".into())');
    expect(nativeSource).toContain('window.destroy()');
    expect(nativeSource).not.toContain('window.hide()');
    expect(nativeSource).not.toContain('window.close()');
    expect(nativeSource).not.toContain('pub fn create_pet_overlay_window');
    expect(nativeRoot).not.toContain('create_pet_overlay_window');
  });

  it('restores a visible overlay from the main window only', () => {
    const main = readSource('./main.tsx');
    const overlayEntry = readSource('./pet-overlay-main.tsx');
    expect(main).toContain('installPetOverlayRestore()');
    expect(overlayEntry).not.toContain('installPetOverlayRestore');
    expect(overlayEntry).not.toContain('StrictMode');
  });
});
