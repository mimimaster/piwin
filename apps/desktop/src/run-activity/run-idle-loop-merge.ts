import type { RunIdleLoopNotice } from '@piwin/contracts';

/**
 * Merge an incoming idle-loop notice onto the one already projected for a
 * Run. A dismissal is sticky: a late live update or an older transcript row
 * must never bring a closed card back.
 */
export function mergeIdleLoop(
  next: RunIdleLoopNotice | undefined,
  previous: RunIdleLoopNotice | undefined,
): { idleLoop?: RunIdleLoopNotice } {
  const notice = next ?? previous;
  if (notice === undefined) return {};
  if (notice.dismissed !== true && (next?.dismissed === true || previous?.dismissed === true)) {
    return { idleLoop: { ...notice, dismissed: true } };
  }
  return { idleLoop: notice };
}
