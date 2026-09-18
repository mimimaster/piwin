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
import { SessionDragProvider } from './workbench/docking/docking-session-drag.js';
import { ArtifactGallery } from './e2e/artifact-gallery';
import { InkstoneChainGallery } from './e2e/inkstone-chain-gallery';
import { PrimitiveGallery } from './e2e/primitive-gallery';
import { TranscriptScrollGallery } from './e2e/transcript-scroll-gallery';
import { LiveSpikePanel } from './live-spike/LiveSpikePanel';
import {
  buildAppearanceTheme,
  applyAppearanceToDocument,
  beginThemeSwitch,
  loadAndRegisterAllCustomFonts,
  resolveDesktopAppearance,
  resolveSystemThemeMode,
} from './appearance-tokens';
import { isDocumentThemeId, rememberAppliedTheme, resolveStartupAppearance } from './theme-startup';
import { loadDesktopPreferences } from './ui-preferences';
import { useWebViewport } from './hooks/use-web-viewport';
import { applyWindowChromeToDocument } from './window-chrome';

/**
 * Test-harness route, compiled in only when Playwright's Vite server sets
 * VITE_PIWIN_E2E_FIXTURES. Production builds statically resolve the flag to
 * undefined, so the gallery can never render from product navigation.
 */
const E2E_PRIMITIVE_GALLERY_HASH = '#/e2e/primitives';
const E2E_ARTIFACT_GALLERY_HASH = '#/e2e/artifacts';
const E2E_INKSTONE_CHAIN_HASH = '#/e2e/inkstone-chain';
const LIVE_SPIKE_HASH = '#/live-spike';

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

function isInkstoneChainGalleryRoute(): boolean {
  return isE2eFixtureRoute(E2E_INKSTONE_CHAIN_HASH);
}

/** R1 only: explicit env flag + hash. Production builds strip the flag. */
function isLiveSpikeRoute(): boolean {
  if (import.meta.env.VITE_PIWIN_LIVE_SPIKE !== '1' || typeof window === 'undefined') {
    return false;
  }
  const hash = window.location.hash;
  return hash === LIVE_SPIKE_HASH || hash.startsWith(`${LIVE_SPIKE_HASH}?`);
}

function themePaintEquals(left: ThemeManifest, right: ThemeManifest): boolean {
  return (
    left.id === right.id &&
    left.mode === right.mode &&
    left.tokens.bg.toLowerCase() === right.tokens.bg.toLowerCase() &&
    left.tokens.text.toLowerCase() === right.tokens.text.toLowerCase() &&
    left.tokens.accent.toLowerCase() === right.tokens.accent.toLowerCase()
  );
}

export function DesktopThemeRoot() {
  useWebViewport();
  useLayoutEffect(() => {
    applyWindowChromeToDocument(document.documentElement);
  }, []);
  // Same resolver as main.tsx pre-paint so React's first commit matches the
  // document tokens already on <html> (no Noir → ink-wash jump).
  const [activeTheme, setActiveTheme] = useState<ThemeManifest>(() => resolveStartupAppearance());

  useEffect(() => {
    const preferences = loadDesktopPreferences();
    void loadAndRegisterAllCustomFonts(preferences.customFonts);
  }, []);

  const applyResolvedTheme = useCallback((candidateTheme: ThemeManifest) => {
    const resolvedTheme = resolveDesktopAppearance(candidateTheme);
    const sameSheet = isDocumentThemeId(resolvedTheme.id);
    // Same structural face (paper/ink) can still carry new Appearance colors.
    // Always paint tokens. Skip the switch freeze so a hex tweak does not
    // flash the whole shell; skip React state when paint is unchanged so
    // Host re-sending the same library theme stays a no-op.
    if (!sameSheet) {
      beginThemeSwitch();
    }
    const preferences = loadDesktopPreferences();
    applyAppearanceToDocument(resolvedTheme, preferences.customFonts);
    rememberAppliedTheme(resolvedTheme);
    setActiveTheme((previous) => (themePaintEquals(previous, resolvedTheme) ? previous : resolvedTheme));
  }, []);

  // Guard: a future caller that sets root state without the callback still
  // gets its manifest projected to document tokens synchronously post-render.
  useLayoutEffect(() => {
    const preferences = loadDesktopPreferences();
    applyAppearanceToDocument(activeTheme, preferences.customFonts);
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
        {isLiveSpikeRoute() ? (
          <LiveSpikePanel />
        ) : isPrimitiveGalleryRoute() ? (
          <PrimitiveGallery onApplyTheme={applyResolvedTheme} />
        ) : isArtifactGalleryRoute() ? (
          <ArtifactGallery />
        ) : isInkstoneChainGalleryRoute() ? (
          <InkstoneChainGallery />
        ) : isE2eFixtureRoute('#/e2e/transcript-scroll') ? (
          <TranscriptScrollGallery />
        ) : (
          <SessionDragProvider>
            <App activeTheme={activeTheme} onThemeApplied={applyResolvedTheme} />
          </SessionDragProvider>
        )}
      </AppErrorBoundary>
    </PiwinUiProvider>
  );
}
