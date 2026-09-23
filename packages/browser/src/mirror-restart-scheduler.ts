/**
 * Quiet period before the screencast is rebuilt for a new viewport. A follow
 * drag resizes once per step; this is long enough to span the gaps between
 * steps and short enough that the settled frame sharpens right after release.
 */
export const BROWSER_MIRROR_RESTART_SETTLE_MS = 250;

export type MirrorRestartScheduler = {
  /** Restart once resizes stop arriving; each call pushes the restart back. */
  schedule(): void;
  cancel(): void;
};

/**
 * Restarting the screencast re-encodes at the new size — on a CPU-rendered
 * Chromium that is the costliest step of a resize. The running screencast
 * keeps streaming (downscaled into its old box) while a drag is in flight, so
 * only the settled size needs a rebuild.
 */
export function createMirrorRestartScheduler(options: {
  restart: () => Promise<void>;
  onError: (error: unknown) => void;
  settleMs?: number;
}): MirrorRestartScheduler {
  const settleMs = options.settleMs ?? BROWSER_MIRROR_RESTART_SETTLE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        options.restart().catch(options.onError);
      }, settleMs);
      timer.unref?.();
    },
    cancel,
  };
}
