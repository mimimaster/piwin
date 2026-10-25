import type { DialPath } from '@piwin/host-client';

/**
 * Which path each channel Host's live connection uses right now (ADR 0101
 * §8), for the runtime chip. Undefined while reconnecting.
 */
const paths = new Map<string, DialPath>();
const listeners = new Set<() => void>();

export function reportChannelPath(hostId: string, path: DialPath | undefined): void {
  if (paths.get(hostId) === path) return;
  if (path === undefined) paths.delete(hostId);
  else paths.set(hostId, path);
  for (const listener of listeners) listener();
}

export function readChannelPath(hostId: string): DialPath | undefined {
  return paths.get(hostId);
}

export function subscribeChannelPath(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
