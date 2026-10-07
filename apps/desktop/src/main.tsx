import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './desktop-theme-root';
import { applyAppearanceToDocument, loadAndRegisterAllCustomFonts } from './appearance-tokens';
import { resolveStartupAppearance } from './theme-startup';
import { loadDesktopPreferences } from './ui-preferences';
import { applyWindowChromeToDocument } from './window-chrome';
import { installDevelopmentPerformanceTimelineGuard } from './development-performance-timeline';
import { installArtifactMemoryBridge } from './artifact-memory-bridge';
import { installMemoryParking } from './memory-parking';
import { installMemoryPressureBridge } from './memory-pressure';
import { installPetOverlayStateRelay } from './pet-overlay-state-bridge';
import { installPetOverlayRestore } from './pet-overlay-visibility';
import { installExternalLinkGuard } from './external-link-guard';
import { isTauriRuntime } from './tauri-pty';
import { primeDeviceCredential } from './device-admission';
import { loadDesktopRemoteHostTarget } from './remote-host-session';
import { isMobileTauriRuntime } from './shell-runtime';
import './styles.css';

// Pre-paint: use last known built-in theme (or Appearance prefs) so the first
// frame is not always Noir. Host may still refine custom themes after connect.
// Once mounted, DesktopThemeRoot is authoritative.
applyWindowChromeToDocument(document.documentElement);
const startupPreferences = loadDesktopPreferences();
applyAppearanceToDocument(resolveStartupAppearance(), startupPreferences.customFonts);
// Registers the shipped faces, then re-applies so their sanitized families
// replace the Inter / JetBrains / Noto stacks unless a custom role is set.
void loadAndRegisterAllCustomFonts(startupPreferences.customFonts);

// Wire native memory samples into the Memory Governor before first render so
// a bloated relaunch degrades immediately instead of after hydration.
installMemoryPressureBridge();
installMemoryParking();
installArtifactMemoryBridge();
void installPetOverlayStateRelay();
installPetOverlayRestore();
// Before first render: an external link click must never navigate the Tauri
// webview itself (blank window, app state lost).
if (isTauriRuntime() || isMobileTauriRuntime()) {
  installExternalLinkGuard(document);
}

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

// No StrictMode: it remounts the workbench and dispose() kills the Host socket
// mid-hello (`Host transport closed`). Sidecar / remote Host are process-owned.
const root = createRoot(rootElement);
if (isMobileTauriRuntime()) {
  // The workbench builds its Host client synchronously; a paired phone needs
  // its Keychain credential in memory before that first hello.
  const savedEndpoint = loadDesktopRemoteHostTarget()?.endpoint;
  void (savedEndpoint === undefined ? Promise.resolve() : primeDeviceCredential(savedEndpoint)).finally(
    () => {
      root.render(<DesktopThemeRoot />);
    },
  );
} else {
  root.render(<DesktopThemeRoot />);
}
