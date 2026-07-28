/**
 * Single React owner of the resolved active ThemeManifest.
 * Document CSS tokens, the Mantine provider, and artifact mapping are all
 * projections of the manifest held here (plan: quiet-workbench P0 convergence).
 */
import { useCallback, useLayoutEffect, useState } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { PrimitiveGallery } from './e2e/primitive-gallery';
import {
  applyAppearanceToDocument,
  PIWIN_APPEARANCE_DARK,
  resolveDesktopAppearance,
} from './appearance-tokens';

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
  const [activeTheme, setActiveTheme] = useState<ThemeManifest>(PIWIN_APPEARANCE_DARK);

  const applyResolvedTheme = useCallback((candidateTheme: ThemeManifest) => {
    const resolvedTheme = resolveDesktopAppearance(candidateTheme);
    // Apply document tokens before the state update so CSS and Mantine never
    // present mismatched themes within one commit.
    applyAppearanceToDocument(resolvedTheme);
    setActiveTheme(resolvedTheme);
  }, []);

  // Guard: a future caller that sets root state without the callback still
  // gets its manifest projected to document tokens synchronously post-render.
  useLayoutEffect(() => {
    applyAppearanceToDocument(activeTheme);
  }, [activeTheme]);

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
