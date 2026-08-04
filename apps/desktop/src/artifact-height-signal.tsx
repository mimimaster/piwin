/**
 * Lightweight signal channel for artifact iframe height changes.
 *
 * When an ArtifactFrame's iframe grows via the postMessage height bridge,
 * the transcript scroll container must re-evaluate whether to scroll to
 * bottom. Without this signal, `activitySignal` in App.tsx only captures
 * text length changes, so iframe height growth alone does not trigger
 * follow-tail scrolling — the view appears "stuck" during streaming SVG.
 */
import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

export type ArtifactHeightSignalContextValue = {
  /** Called by ArtifactFrame when the iframe height changes. */
  notifyHeightChange: (height: number) => void;
};

const ArtifactHeightSignalContext = createContext<ArtifactHeightSignalContextValue | null>(null);

export function ArtifactHeightSignalProvider({
  value,
  children,
}: {
  value: ArtifactHeightSignalContextValue;
  children: ReactNode;
}): ReactElement {
  return (
    <ArtifactHeightSignalContext.Provider value={value}>
      {children}
    </ArtifactHeightSignalContext.Provider>
  );
}

export function useArtifactHeightSignal(): ArtifactHeightSignalContextValue | null {
  return useContext(ArtifactHeightSignalContext);
}
