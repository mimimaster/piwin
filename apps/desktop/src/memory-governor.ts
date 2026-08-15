/**
 * Frontend Memory Governor for WebContent degradation & recovery.
 *
 * Implements multi-tier degradation under high memory pressure:
 * Level 0 (Normal): Full features enabled (Shiki highlight, caching, artifact frames).
 * Level 1 (Moderate): Purge syntax highlight LRU caches & cancel non-viewport token requests.
 * Level 2 (Critical / Safe Mode): Disable syntax highlighting (plain text fallback), unload background artifacts.
 */
import { globalHighlightCache } from './syntax/highlight-cache';

export type MemoryPressureLevel = 'normal' | 'moderate' | 'critical';

export type MemoryGovernorListener = (level: MemoryPressureLevel) => void;

class MemoryGovernor {
  private level: MemoryPressureLevel = 'normal';
  private readonly listeners = new Set<MemoryGovernorListener>();

  public getLevel = (): MemoryPressureLevel => {
    return this.level;
  };

  public getDegradationLevel = (): MemoryPressureLevel => {
    return this.level;
  };

  public isHighlightDisabled = (): boolean => {
    return this.level === 'critical';
  };

  public subscribe = (listener: MemoryGovernorListener): () => void => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Applies degradation actions according to the target memory pressure level.
   */
  public setLevel = (nextLevel: MemoryPressureLevel): void => {
    if (this.level === nextLevel) return;
    this.level = nextLevel;

    if (nextLevel === 'moderate' || nextLevel === 'critical') {
      // Level 1 / 2: Purge highlight LRU cache immediately to free memory
      globalHighlightCache.clear();
    }

    // Notify listeners (UI hooks, artifact managers)
    for (const listener of this.listeners) {
      try {
        listener(nextLevel);
      } catch (err) {
        console.warn('[memory-governor] listener error:', err);
      }
    }
  };

  public reset = (): void => {
    this.setLevel('normal');
  };
}

export const globalMemoryGovernor = new MemoryGovernor();

// Listen for Tauri native memory pressure events if available
if (typeof window !== 'undefined') {
  window.addEventListener('desktop:memory-pressure' as never, ((event: CustomEvent<{ level?: MemoryPressureLevel }>) => {
    const level = event.detail?.level ?? 'moderate';
    globalMemoryGovernor.setLevel(level);
  }) as EventListener);
}
