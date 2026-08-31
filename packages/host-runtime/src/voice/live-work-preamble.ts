/**
 * One work-session preamble per Live call. Later handovers wrap only the brief.
 */

const injectedCallIds = new Set<string>();

export function shouldInjectLiveWorkPreamble(callId: string | undefined): boolean {
  if (!callId) return true;
  if (injectedCallIds.has(callId)) return false;
  injectedCallIds.add(callId);
  return true;
}

export function forgetLiveWorkPreamble(callId: string): void {
  injectedCallIds.delete(callId);
}
