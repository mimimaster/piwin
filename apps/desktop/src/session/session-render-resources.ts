import { scheduleIdleTask } from '../automation/schedule-idle-task.js';

type RenderResource = { sessionKey: string; reclaim: () => void; reclaimed: boolean };
type IdleScheduler = (task: () => void) => () => void;

/** Equal session ids on different Hosts must not share a presentation lifetime. */
export function sessionRenderResourceKey(hostKey: string, sessionId: string): string {
  return JSON.stringify([hostKey, sessionId]);
}

/** Owns disposable presentation resources, never messages, drafts, or Host execution. */
export function createSessionRenderResourceRegistry(schedule: IdleScheduler = scheduleIdleTask) {
  let visibleKeys: Set<string> | null = null;
  let cancelPending: (() => void) | null = null;
  const resources = new Map<symbol, RenderResource>();
  const listeners = new Set<() => void>();

  const isVisible = (sessionKey: string): boolean =>
    visibleKeys === null || visibleKeys.has(sessionKey);
  const requestReclaim = (): void => {
    if (cancelPending !== null || visibleKeys === null) return;
    cancelPending = schedule(() => {
      cancelPending = null;
      for (const [token, resource] of [...resources]) {
        // Navigation may race this idle callback, or occur inside an earlier release.
        if (!resources.has(token) || resource.reclaimed || isVisible(resource.sessionKey)) continue;
        resource.reclaimed = true;
        try {
          resource.reclaim();
        } catch (error) {
          console.warn('[session-render-resources] reclaim failed:', error);
        }
      }
    });
  };

  return {
    isVisible,
    requestReclaim,
    register(sessionKey: string, reclaim: () => void): () => void {
      const token = Symbol(sessionKey);
      resources.set(token, { sessionKey, reclaim, reclaimed: false });
      if (!isVisible(sessionKey)) requestReclaim();
      return () => {
        resources.delete(token);
      };
    },
    setVisible(keys: readonly string[]): void {
      const next = new Set(keys);
      if (
        visibleKeys !== null &&
        next.size === visibleKeys.size &&
        [...next].every((key) => visibleKeys?.has(key))
      )
        return;
      visibleKeys = next;
      for (const resource of resources.values()) {
        if (isVisible(resource.sessionKey)) resource.reclaimed = false;
      }
      for (const listener of [...listeners]) listener();
      requestReclaim();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset(): void {
      cancelPending?.();
      cancelPending = null;
      resources.clear();
      visibleKeys = null;
      for (const listener of [...listeners]) listener();
    },
  };
}

export const sessionRenderResources = createSessionRenderResourceRegistry();
