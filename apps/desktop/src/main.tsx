import { createRoot } from 'react-dom/client';
import { DesktopThemeRoot } from './platform/desktop-theme-root';
import { applyAppearanceToDocument, loadAndRegisterAllCustomFonts } from './theme/appearance-tokens';
import { resolveStartupAppearance } from './theme/theme-startup';
import { loadDesktopPreferences } from './platform/ui-preferences';
import { applyNativeWindowMaterialToDocument, applyWindowChromeToDocument } from './platform/window-chrome';
import { installDevelopmentPerformanceTimelineGuard } from './platform/development-performance-timeline';
import { installArtifactMemoryBridge } from './artifact/artifact-memory-bridge';
import { installMemoryParking } from './notes/memory-parking';
import { installMemoryPressureBridge } from './notes/memory-pressure';
import { installPetOverlayStateRelay } from './pet/pet-overlay-state-bridge';
import { installPetOverlayRestore } from './pet/pet-overlay-visibility';
import { installExternalLinkGuard } from './platform/external-link-guard';
import { isTauriRuntime } from './host/tauri-pty';
import { primeDeviceCredential } from './devices/device-admission';
import { loadDesktopRemoteHostTarget } from './host/remote-host-session';
import { primeChannelHost } from './host/channel-host-book';
import { startLegacyChannelMigration } from './host/channel-legacy-migration';
import { isDesktopTauriRuntime, isMobileTauriRuntime } from './tool-cards/shell-runtime';
import { getAppUpdateStore } from './platform/app-update-store';
import { configureArtifactKitDelivery } from '@piwin/artifact';
import { resolveArtifactSchemeOrigin } from './artifact/artifact-frame-stream';
import { applyWindowMaterialToDocument } from './platform/window-material-preferences';
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
// The workbench builds its Host client synchronously, so a saved remote Host's
// secrets (host book entry + channel key, or a legacy device credential) must
// be in memory before that first hello.
const saved = loadDesktopRemoteHostTarget();
const savedHostReady =
  saved === undefined
    ? Promise.resolve()
    : saved.hostId !== undefined
      ? primeChannelHost(saved.hostId).then(() => undefined)
      : primeDeviceCredential(saved.endpoint);
// The phone shell has no native window material to wait for.
const firstPaintReady = isMobileTauriRuntime()
  ? savedHostReady
  : Promise.allSettled([nativeWindowMaterialReady, savedHostReady]);
void firstPaintReady.finally(() => {
  root.render(<DesktopThemeRoot />);
  // ADR 0101 §10: a legacy attach moves onto the channel in the background.
  startLegacyChannelMigration();
});
