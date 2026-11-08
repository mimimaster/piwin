import { scheduleIdleTask } from '../automation/schedule-idle-task.js';
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';

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
  /**
   * Sessions whose cold view is mid-restore. Restoring is a PROTECTION
   * reason, on par with visibility: a presentation that is being rebuilt
   * must never be released underneath the restore, so the reclaim loop
   * skips these keys the same way it skips visible ones.
   */
  const restoringKeys = new Set<string>();

  const isVisible = (sessionKey: string): boolean =>
    visibleKeys === null || visibleKeys.has(sessionKey);
  const isRestoring = (sessionKey: string): boolean => restoringKeys.has(sessionKey);
  const isProtected = (sessionKey: string): boolean =>
    isVisible(sessionKey) || isRestoring(sessionKey);
  const requestReclaim = (): void => {
    if (cancelPending !== null || visibleKeys === null) return;
    cancelPending = schedule(() => {
      cancelPending = null;
      for (const [token, resource] of [...resources]) {
        // Navigation may race this idle callback, or occur inside an earlier release.
        if (!resources.has(token) || resource.reclaimed || isProtected(resource.sessionKey))
          continue;
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
    isRestoring,
    requestReclaim,
    /**
     * Mark a session's cold view as mid-restore (or clear the mark). While
     * set, the key is protected exactly like a visible one. Clearing the
     * mark re-evaluates reclaim so a still-hidden session is not pinned.
     */
    setRestoring(sessionKey: string, restoring: boolean): void {
      if (restoring) {
        if (restoringKeys.has(sessionKey)) return;
        restoringKeys.add(sessionKey);
        for (const listener of [...listeners]) listener();
        return;
      }
      if (!restoringKeys.delete(sessionKey)) return;
      for (const listener of [...listeners]) listener();
      requestReclaim();
    },
    /** Presentations currently marked mid-restore (protection reason). */
    restoringCount(): number {
      return restoringKeys.size;
    },
    register(sessionKey: string, reclaim: () => void): () => void {
      const token = Symbol(sessionKey);
      resources.set(token, { sessionKey, reclaim, reclaimed: false });
      if (!isProtected(sessionKey)) requestReclaim();
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
      restoringKeys.clear();
      visibleKeys = null;
      for (const listener of [...listeners]) listener();
    },
    /** Live (registered, not yet released) presentation resources. */
    count(): number {
      return resources.size;
    },
    /** Registered presentations whose session key is currently visible. */
    visibleCount(): number {
      let count = 0;
      for (const resource of resources.values()) {
        if (isVisible(resource.sessionKey)) count += 1;
      }
      return count;
    },
  };
}

export const sessionRenderResources = createSessionRenderResourceRegistry();

desktopMetrics.registerResourceCountProvider(
  'sessionRenderResources',
  () => sessionRenderResources.count(),
);
desktopMetrics.registerResourceCountProvider(
  'restoringSessions',
  () => sessionRenderResources.restoringCount(),
);
