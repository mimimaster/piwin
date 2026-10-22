import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './desktop-theme-root';
import { applyAppearanceToDocument, loadAndRegisterAllCustomFonts } from './appearance-tokens';
import { resolveStartupAppearance } from './theme-startup';
import { loadDesktopPreferences } from './ui-preferences';
import { applyNativeWindowMaterialToDocument, applyWindowChromeToDocument } from './window-chrome';
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
import { isDesktopTauriRuntime, isMobileTauriRuntime } from './shell-runtime';
import { getAppUpdateStore } from './app-update-store';
import { configureArtifactKitDelivery } from '@piwin/artifact';
import { resolveArtifactSchemeOrigin } from './artifact-frame-stream';
import { applyWindowMaterialToDocument } from './window-material-preferences';
import './styles.css';

// Pre-paint: use last known built-in theme (or Appearance prefs) so the first
// frame is not always Noir. Host may still refine custom themes after connect.
// Once mounted, DesktopThemeRoot is authoritative.
applyWindowChromeToDocument(document.documentElement);
// macOS marks synchronously so the startup paint already uses the material;
// Windows resolves after an OS probe and the mounted theme root re-applies.
const nativeWindowMaterialReady = applyNativeWindowMaterialToDocument(document.documentElement);
const startupPreferences = loadDesktopPreferences();
applyAppearanceToDocument(resolveStartupAppearance(), startupPreferences.customFonts);
applyWindowMaterialToDocument(document.documentElement, startupPreferences.windowMaterial);
// Registers the shipped faces, then re-applies so their sanitized families
// replace the Inter / JetBrains / Noto stacks unless a custom role is set.
void loadAndRegisterAllCustomFonts(startupPreferences.customFonts);

// Wire native memory samples into the Memory Governor before first render so
// a bloated relaunch degrades immediately instead of after hydration.
installMemoryPressureBridge();
installMemoryParking();
installArtifactMemoryBridge();
// Packaged shells load artifact documents from the artifact scheme, which
// also serves the chart/icon kit; browser builds keep inlining it.
const artifactSchemeOrigin = resolveArtifactSchemeOrigin();
if (artifactSchemeOrigin) {
  configureArtifactKitDelivery({ kind: 'scheme', origin: artifactSchemeOrigin });
}
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

// ADR 0097: Rust checks in the background; the store keeps what it reports
// and the sidebar notice area shows it. Process-lifetime listener, like the
// bridges above.
if (isDesktopTauriRuntime()) {
  getAppUpdateStore().watch().catch((error: unknown) => {
    console.warn('[app-update] event watch failed', error);
  });
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
  void nativeWindowMaterialReady.finally(() => {
    root.render(<DesktopThemeRoot />);
  });
}
