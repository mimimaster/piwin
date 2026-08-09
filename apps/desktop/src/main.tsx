import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './desktop-theme-root';
import { applyAppearanceToDocument, PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { installDevelopmentPerformanceTimelineGuard } from './development-performance-timeline';
import 'katex/dist/katex.min.css';
import './styles.css';

// Pre-paint fallback only: paint shell tokens before React mounts to avoid an
// unthemed first frame. Once mounted, DesktopThemeRoot is authoritative.
applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);

// Install before createRoot/render. React development instrumentation can
// produce more entries within one task than an interval-based cleanup can
// bound, especially when WebKit's main thread is busy hydrating the shell.
const disposePerformanceTimelineGuard = import.meta.env.DEV
  ? installDevelopmentPerformanceTimelineGuard()
  : undefined;
if (disposePerformanceTimelineGuard !== undefined && import.meta.hot !== undefined) {
  import.meta.hot.dispose(disposePerformanceTimelineGuard);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('root element missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <DesktopThemeRoot />
  </StrictMode>,
);
