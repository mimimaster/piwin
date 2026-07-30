import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './desktop-theme-root';
import { PetOverlayApp } from './pet-overlay-app';
import { applyAppearanceToDocument, PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import 'katex/dist/katex.min.css';
import './styles.css';

// Pre-paint fallback only: paint shell tokens before React mounts to avoid an
// unthemed first frame. Once mounted, DesktopThemeRoot is authoritative.
applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('root element missing');
}

/**
 * Detect if this is the pet overlay window by checking the Tauri window label.
 * The overlay window is created with label "pet-overlay" in pet_overlay.rs.
 * In non-Tauri (mock) mode, no window label is available so we render the main app.
 */
async function isPetOverlayWindow(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const label = getCurrentWindow().label;
    return label === 'pet-overlay';
  } catch {
    return false;
  }
}

isPetOverlayWindow().then((isOverlay) => {
  if (isOverlay) {
    // Overlay window: transparent background, no shell theme tokens.
    document.documentElement.classList.add('pet-overlay-window');
  }
  createRoot(rootElement).render(
    <StrictMode>{isOverlay ? <PetOverlayApp /> : <DesktopThemeRoot />}</StrictMode>,
  );
});
