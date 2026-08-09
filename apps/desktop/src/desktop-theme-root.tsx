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
import { PrimitiveGallery } from './e2e/primitive-gallery';
import {
  buildAppearanceTheme,
  applyAppearanceToDocument,
  beginThemeSwitch,
  resolveDesktopAppearance,
  resolveSystemThemeMode,
} from './appearance-tokens';
import { loadDesktopPreferences, type AppearanceMode } from './ui-preferences';

/**
 * Test-harness route, compiled in only when Playwright's Vite server sets
 * VITE_PIWIN_E2E_FIXTURES. Production builds statically resolve the flag to
 * undefined, so the gallery can never render from product navigation.
 */
const E2E_PRIMITIVE_GALLERY_HASH = '#/e2e/primitives';

function isPrimitiveGalleryRoute(): boolean {
  return (
    import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true' &&
    typeof window !== 'undefined' &&
    window.location.hash === E2E_PRIMITIVE_GALLERY_HASH
  );
}

export function DesktopThemeRoot() {
  const [activeTheme, setActiveTheme] = useState<ThemeManifest>(() => {
    const preferences = loadDesktopPreferences();
    const activeMode = resolvePreferredThemeMode(preferences.appearanceMode);
    const themeSettings = activeMode === 'light' ? preferences.lightTheme : preferences.darkTheme;
    return buildAppearanceTheme(activeMode, themeSettings);
  });

  const applyResolvedTheme = useCallback((candidateTheme: ThemeManifest) => {
    const resolvedTheme = resolveDesktopAppearance(candidateTheme);
    // Apply document tokens before the state update so CSS and Mantine never
    // present mismatched themes within one commit. Freeze transitions so the
    // whole shell does not smear color/geometry for 120–200ms.
    beginThemeSwitch();
    applyAppearanceToDocument(resolvedTheme);
    setActiveTheme(resolvedTheme);
  }, []);

  // Guard: a future caller that sets root state without the callback still
  // gets its manifest projected to document tokens synchronously post-render.
  useLayoutEffect(() => {
    applyAppearanceToDocument(activeTheme);
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
        ) : (
          <App activeTheme={activeTheme} onThemeApplied={applyResolvedTheme} />
        )}
      </AppErrorBoundary>
    </PiwinUiProvider>
  );
}

function resolvePreferredThemeMode(appearanceMode: AppearanceMode): 'light' | 'dark' {
  return appearanceMode === 'system' ? resolveSystemThemeMode() : appearanceMode;
}
