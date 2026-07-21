/**
 * Pure height settle policy for artifact iframes.
 * Ported from openwebui_m artifactHeightPolicy — no DOM.
 */
import { ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS } from './constants.js';
import type {
  ArtifactHeightMeasurementMode,
  ArtifactHeightPhase,
} from './types.js';

export { ARTIFACT_INTERACTION_SHRINK_CONFIRM_MS };

export type ResolveImmediateArtifactHeightInput = {
  height: number;
  currentHeight: number;
  floor: number;
  phase: ArtifactHeightPhase;
  mode: ArtifactHeightMeasurementMode;
  minHeight: number;
  initialHeight: number;
};

export type ResolveInteractiveArtifactShrinkInput = {
  phase: ArtifactHeightPhase;
  mode: ArtifactHeightMeasurementMode;
  nextHeight: number;
  currentHeight: number;
  timerActive: boolean;
};

export type ResolveInteractiveArtifactShrinkResult = {
  defer: boolean;
  startTimer: boolean;
  pendingHeight: number | null;
};

export function normalizeArtifactHeight(
  height: number,
  minHeight: number,
  initialHeight: number,
): number {
  return Math.max(minHeight, Math.ceil(height || initialHeight));
}

/** Clamp measured height into [minHeight, maxHeight]. */
export function clampArtifactHeight(
  height: number,
  minHeight: number,
  maxHeight: number,
  initialHeight: number,
): number {
  const normalized = normalizeArtifactHeight(height, minHeight, initialHeight);
  return Math.min(maxHeight, normalized);
}

export function resolveImmediateArtifactHeight(
  input: ResolveImmediateArtifactHeightInput,
): number {
  const nextHeight = normalizeArtifactHeight(
    input.height,
    input.minHeight,
    input.initialHeight,
  );

  if (input.phase === 'protected') {
    return Math.max(input.floor, nextHeight);
  }

  if (input.phase === 'interactive' && input.mode === 'normal') {
    return Math.max(input.currentHeight, nextHeight);
  }

  return nextHeight;
}

export function resolveInteractiveArtifactShrink(
  input: ResolveInteractiveArtifactShrinkInput,
): ResolveInteractiveArtifactShrinkResult {
  const shouldConfirmShrink =
    input.phase === 'interactive' &&
    input.mode === 'interaction' &&
    input.nextHeight < input.currentHeight;

  if (!shouldConfirmShrink) {
    return { defer: false, startTimer: false, pendingHeight: null };
  }

  return {
    defer: true,
    startTimer: !input.timerActive,
    pendingHeight: input.nextHeight,
  };
}
