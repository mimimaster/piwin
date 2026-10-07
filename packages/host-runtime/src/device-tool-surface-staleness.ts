/**
 * A generation freezes its tool surface, so a device tool that became
 * available afterwards is invisible to that session until it is rebuilt.
 *
 * Only a gain is worth a rebuild: a rebuilt generation loses its native
 * conversation state and is re-seeded from history. When a device withdraws
 * its offer the tool simply reports that the device is unavailable.
 *
 * `offeredAtBuild` is `undefined` for generations that never carry device
 * tools (subagents, Hosts composed without them); those are never stale.
 */
export function deviceToolsGainedSinceBuild(
  offeredAtBuild: boolean | undefined,
  offeredNow: boolean,
): boolean {
  return offeredAtBuild === false && offeredNow;
}
