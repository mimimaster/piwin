/**
 * Single React owner of the resolved active ThemeManifest.
 * Document CSS tokens, the Mantine provider, and artifact mapping are all
 * projections of the manifest held here (plan: quiet-workbench P0 convergence).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { ArtifactGallery } from './e2e/artifact-gallery';
import { PrimitiveGallery } from './e2e/primitive-gallery';
import {
  buildAppearanceTheme,
  applyAppearanceToDocument,
  beginThemeSwitch,
  resolveDesktopAppearance,
  resolveSystemThemeMode,
} from './appearance-tokens';
import { isDocumentThemeId, rememberAppliedTheme, resolveStartupAppearance } from './theme-startup';
import { loadDesktopPreferences } from './ui-preferences';

/**
 * Test-harness route, compiled in only when Playwright's Vite server sets
 * VITE_PIWIN_E2E_FIXTURES. Production builds statically resolve the flag to
 * undefined, so the gallery can never render from product navigation.
 */
const E2E_PRIMITIVE_GALLERY_HASH = '#/e2e/primitives';
const E2E_ARTIFACT_GALLERY_HASH = '#/e2e/artifacts';

function isE2eFixtureRoute(prefix: string): boolean {
  if (import.meta.env.VITE_PIWIN_E2E_FIXTURES !== 'true' || typeof window === 'undefined') {
    return false;
  }
  const hash = window.location.hash;
  return hash === prefix || hash.startsWith(`${prefix}?`);
}

function isPrimitiveGalleryRoute(): boolean {
  return isE2eFixtureRoute(E2E_PRIMITIVE_GALLERY_HASH);
}

function isArtifactGalleryRoute(): boolean {
  return isE2eFixtureRoute(E2E_ARTIFACT_GALLERY_HASH);
}

export function DesktopThemeRoot() {
  // Same resolver as main.tsx pre-paint so React's first commit matches the
  // document tokens already on <html> (no Noir → ink-wash jump).
  const [activeTheme, setActiveTheme] = useState<ThemeManifest>(() => resolveStartupAppearance());

  const applyResolvedTheme = useCallback((candidateTheme: ThemeManifest) => {
    const resolvedTheme = resolveDesktopAppearance(candidateTheme);
    // Host bootstrap re-sends the active theme after connect. If we already
    // pre-painted the same id, skip the switch freeze — otherwise the user
    // still sees a one-frame "flash" even when colors match.
    if (isDocumentThemeId(resolvedTheme.id)) {
      rememberAppliedTheme(resolvedTheme);
      setActiveTheme((previous) => (previous.id === resolvedTheme.id ? previous : resolvedTheme));
      return;
    }
    // Apply document tokens before the state update so CSS and Mantine never
    // present mismatched themes within one commit. Freeze transitions so the
    // whole shell does not smear color/geometry for 120–200ms.
    beginThemeSwitch();
    applyAppearanceToDocument(resolvedTheme);
    rememberAppliedTheme(resolvedTheme);
    setActiveTheme(resolvedTheme);
  }, []);

  // Guard: a future caller that sets root state without the callback still
  // gets its manifest projected to document tokens synchronously post-render.
  useLayoutEffect(() => {
    applyAppearanceToDocument(activeTheme);
    rememberAppliedTheme(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    const preferences = loadDesktopPreferences();
    if (preferences.appearanceMode !== 'system' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const applySystemTheme = (): void => {
      const nextMode = resolveSystemThemeMode();
      const nextSettings = nextMode === 'light' ? preferences.lightTheme : preferences.darkTheme;
      applyResolvedTheme(buildAppearanceTheme(nextMode, nextSettings));
    };

    mediaQuery.addEventListener?.('change', applySystemTheme);
    return () => mediaQuery.removeEventListener?.('change', applySystemTheme);
  }, [applyResolvedTheme]);

  return (
    <PiwinUiProvider manifest={activeTheme}>
      <AppErrorBoundary>
        {isPrimitiveGalleryRoute() ? (
          <PrimitiveGallery onApplyTheme={applyResolvedTheme} />
        ) : isArtifactGalleryRoute() ? (
          <ArtifactGallery />
        ) : (
          <App activeTheme={activeTheme} onThemeApplied={applyResolvedTheme} />
        )}
      </AppErrorBoundary>
    </PiwinUiProvider>
  );
}
