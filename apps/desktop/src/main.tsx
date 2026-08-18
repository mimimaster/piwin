import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './desktop-theme-root';
import { applyAppearanceToDocument } from './appearance-tokens';
import { resolveStartupAppearance } from './theme-startup';
import { installDevelopmentPerformanceTimelineGuard } from './development-performance-timeline';
import { installArtifactMemoryBridge } from './artifact-memory-bridge';
import { installMemoryParking } from './memory-parking';
import { installMemoryPressureBridge } from './memory-pressure';
import { installPetOverlayRestore } from './pet-overlay-visibility';
import 'katex/dist/katex.min.css';
import './styles.css';

// Pre-paint: use last known built-in theme (or Appearance prefs) so the first
// frame is not always Noir. Host may still refine custom themes after connect.
// Once mounted, DesktopThemeRoot is authoritative.
applyAppearanceToDocument(resolveStartupAppearance());

// Wire native memory samples into the Memory Governor before first render so
// a bloated relaunch degrades immediately instead of after hydration.
installMemoryPressureBridge();
installMemoryParking();
installArtifactMemoryBridge();
installPetOverlayRestore();

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
