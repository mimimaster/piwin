import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './desktop-theme-root';
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

createRoot(rootElement).render(
  <StrictMode>
    <DesktopThemeRoot />
  </StrictMode>,
);
