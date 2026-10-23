import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';

/**
 * A user's explicit open/closed choice for one turn's work fold, and the run
 * episode it was made in.
 */
export type WorkDisclosureOverride = {
  open: boolean;
  /** Made while the chain was running. */
  setWhileLive: boolean;
  /** The turn's run ids at toggle time (`encodeTurnRunIds`). */
  runKey: string;
};

/**
 * Resolve whether a turn's work fold is open.
 *
 * A toggle made while the run is live only lasts until the run settles: the
 * chain then folds once into the 已工作 summary (or the density default).
 * A resumed run starts a new episode, so a choice made during the pause is
 * also dropped when the model recovers. A toggle made on a settled turn whose
 * runs have not changed is the reader's choice and sticks.
 */
export function resolveWorkDisclosureOpen(
  override: WorkDisclosureOverride | undefined,
  projection: TurnWorkDisclosureProjection | null,
  runKey: string,
  defaultOpen: boolean,
): boolean {
  if (override === undefined) return defaultOpen;
  if (override.runKey !== runKey) return defaultOpen;
  if (override.setWhileLive && projection?.live !== true) return defaultOpen;
  return override.open;
}

/** Record a toggle against the fold state the user actually saw. */
export function toggleWorkDisclosureOverride(
  current: WorkDisclosureOverride | undefined,
  projection: TurnWorkDisclosureProjection | null,
  runKey: string,
  defaultOpen: boolean,
): WorkDisclosureOverride {
  return {
    open: !resolveWorkDisclosureOpen(current, projection, runKey, defaultOpen),
    setWhileLive: projection?.live === true,
    runKey,
  };
}
