/**
 * Internal style-mode switch from the Host's `artifact.styleModes` config
 * (not user-visible). `host-only` renders every expressive fence under host
 * style. Module-level so the fence controllers read it without threading a
 * prop through every transcript layer.
 */
import { useSyncExternalStore } from 'react';
import type { ArtifactStyleModes } from '@piwin/artifact';

let current: ArtifactStyleModes = 'model';
const listeners = new Set<() => void>();

export function setArtifactStyleModes(next: ArtifactStyleModes | undefined): void {
  const value: ArtifactStyleModes = next === 'host-only' ? 'host-only' : 'model';
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener();
}

export function getArtifactStyleModes(): ArtifactStyleModes {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useArtifactStyleModes(): ArtifactStyleModes {
  return useSyncExternalStore(subscribe, getArtifactStyleModes, getArtifactStyleModes);
}
