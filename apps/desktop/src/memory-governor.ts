/**
 * Frontend Memory Governor for WebContent degradation & recovery.
 *
 * Implements multi-tier degradation under high memory pressure:
 * Level 0 (Normal): Full features (Shiki highlight, caching, glass surfaces).
 * Level 1 (Moderate): Purge syntax highlight LRU caches and strip
 *   GPU-expensive CSS (backdrop-filter compositor layers) via the
 *   html[data-memory-pressure] attribute consumed by
 *   styles/memory-degradation.css.
 * Level 2 (Critical / Safe Mode): Additionally disable syntax highlighting
 *   (plain text fallback), shed decorative theme textures, and evict
 *   non-forceKeep live artifact iframes via artifact-memory-bridge.ts.
 *
 * Pressure samples reach the governor through memory-pressure.ts
 * (installMemoryPressureBridge); this module stays free of Tauri/event glue
 * so it can be driven directly in tests. Subscribers perform the artifact
 * eviction — the governor itself does not import @piwin/artifact.
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

    // The degradation stylesheet keys off this attribute to destroy
    // backdrop-filter layers, letting WebKit return their IOSurface memory.
    if (typeof document !== 'undefined') {
      if (nextLevel === 'normal') {
        delete document.documentElement.dataset.memoryPressure;
      } else {
        document.documentElement.dataset.memoryPressure = nextLevel;
      }
    }

    // Notify listeners (highlight UI, artifact-memory-bridge).
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
