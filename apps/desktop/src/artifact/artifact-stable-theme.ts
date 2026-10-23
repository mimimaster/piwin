import { useRef } from 'react';
import type { ArtifactThemeVariables } from '@piwin/artifact';

function areArtifactThemesEqual(
  current: ArtifactThemeVariables | undefined,
  next: ArtifactThemeVariables | undefined,
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  const currentValues = current as Readonly<Record<string, string | undefined>>;
  const nextValues = next as Readonly<Record<string, string | undefined>>;
  const names = new Set([...Object.keys(currentValues), ...Object.keys(nextValues)]);
  for (const name of names) {
    if (currentValues[name] !== nextValues[name]) return false;
  }
  return true;
}

/**
 * Callers map the active manifest to a fresh object on every render. Keep a
 * value-equivalent theme reference stable: in the transcript Streamdown's
 * component registry would otherwise change type and remount the Artifact
 * iframe for every token, and the Canvas would rebuild its whole sandbox
 * document on every render of the workbench.
 */
export function useStableArtifactTheme(
  theme: ArtifactThemeVariables | undefined,
): ArtifactThemeVariables | undefined {
  const stableThemeRef = useRef<ArtifactThemeVariables | undefined>(theme);
  if (!areArtifactThemesEqual(stableThemeRef.current, theme)) {
    stableThemeRef.current = theme;
  }
  return stableThemeRef.current;
}
