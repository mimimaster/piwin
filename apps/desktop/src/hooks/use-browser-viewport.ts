/**
 * Desktop viewport policy for the browser workbench (spec §4.1).
 *
 * The Host stays authoritative: this module only decides *when* the panel
 * asks for a follow resize, and it never touches the coordinate space
 * optimistically — a failed request keeps the previous actual viewport.
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { BrowserController, BrowserViewportMode } from '@piwin/contracts';

export type BrowserViewportSize = { width: number; height: number };

/** Continuous ResizeObserver churn is debounced before a `browser/resize`. */
export const BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS = 150;
/** Axis changes smaller than this are not worth a round trip. */
export const BROWSER_FOLLOW_RESIZE_MIN_DELTA_PX = 8;

export type BrowserViewportPresetId = 'responsive' | 'desktop' | 'mobile' | 'tablet' | 'custom';

export type BrowserViewportPreset = {
  mode: BrowserViewportMode;
  width: number;
  height: number;
  /** Custom keeps the current size and lets the user edit it. */
  editable?: boolean;
};

/** Viewport menu presets (spec §4.2). */
export const BROWSER_VIEWPORT_MENU_PRESETS: Record<BrowserViewportPresetId, BrowserViewportPreset> = {
  responsive: { mode: 'follow', width: 1280, height: 800 },
  desktop: { mode: 'fixed', width: 1280, height: 800 },
  mobile: { mode: 'mobile', width: 375, height: 812 },
  tablet: { mode: 'custom', width: 768, height: 1024 },
  custom: { mode: 'custom', width: 1280, height: 800, editable: true },
};

/** Panel content box in whole CSS px, or undefined before first layout. */
export function resolveFollowViewportBox(
  element: { getBoundingClientRect(): { width: number; height: number } } | null,
): BrowserViewportSize | undefined {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return undefined;
  }
  return { width, height };
}

/** True when at least one axis moved by the minimum delta (or nothing sent yet). */
export function shouldSendFollowResize(
  previous: BrowserViewportSize | undefined,
  next: BrowserViewportSize,
  minDeltaPx: number = BROWSER_FOLLOW_RESIZE_MIN_DELTA_PX,
): boolean {
  if (previous === undefined) return true;
  return (
    Math.abs(next.width - previous.width) >= minDeltaPx ||
    Math.abs(next.height - previous.height) >= minDeltaPx
  );
}

export type BrowserViewportFollowController = {
  observe(size: BrowserViewportSize | undefined): void;
  setController(controller: BrowserController): void;
  /** Last size the Host accepted (undefined until the first success). */
  lastAccepted(): BrowserViewportSize | undefined;
  dispose(): void;
};

export type BrowserViewportFollowControllerOptions = {
  send: (size: BrowserViewportSize) => Promise<unknown>;
  debounceMs?: number;
  minDeltaPx?: number;
  /** Test seams; production uses window timers. */
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
};

/**
 * Debounce + ownership gate for follow-mode resizes.
 *
 * The agent owns the page while it holds the lock; a resize then would move the
 * coordinate space under a running action, so the intent is held and committed
 * once the lock is released (spec §4.1).
 */
export function createBrowserViewportFollowController(
  options: BrowserViewportFollowControllerOptions,
): BrowserViewportFollowController {
  const debounceMs = options.debounceMs ?? BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS;
  const minDeltaPx = options.minDeltaPx ?? BROWSER_FOLLOW_RESIZE_MIN_DELTA_PX;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

  let accepted: BrowserViewportSize | undefined;
  let pending: BrowserViewportSize | undefined;
  let controller: BrowserController = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let disposed = false;

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
  }

  // Read through a helper so the type checker does not keep the narrowed
  // 'idle' | 'user' union from the early return below.
  function agentHoldsLock(): boolean {
    return controller === 'agent';
  }

  async function commit(): Promise<void> {
    if (disposed || sending) return;
    const next = pending;
    if (next === undefined) return;
    if (controller === 'agent') return;
    if (!shouldSendFollowResize(accepted, next, minDeltaPx)) {
      pending = undefined;
      return;
    }
    sending = true;
    pending = undefined;
    try {
      await options.send(next);
      // Only a Host-accepted resize moves the coordinate space.
      accepted = next;
    } catch {
      // Keep the previous accepted size; the next observation retries.
    } finally {
      sending = false;
      if (pending !== undefined && !agentHoldsLock()) void commit();
    }
  }

  function schedule(): void {
    cancelTimer();
    timer = setTimer(() => {
      timer = undefined;
      void commit();
    }, debounceMs);
  }

  return {
    observe(size) {
      if (disposed || size === undefined) return;
      if (!shouldSendFollowResize(accepted, size, minDeltaPx)) return;
      pending = size;
      schedule();
    },
    setController(next) {
      // Only a real release flushes the held intent. The mount-time call is a
      // no-op, otherwise the first observation would skip the debounce.
      const wasAgent = controller === 'agent';
      controller = next;
      if (wasAgent && next !== 'agent' && pending !== undefined) {
        cancelTimer();
        void commit();
      }
    },
    lastAccepted: () => accepted,
    dispose() {
      disposed = true;
      cancelTimer();
      pending = undefined;
    },
  };
}

export type BrowserViewportResizeOptions = {
  leaseId?: string;
  mode?: BrowserViewportMode;
  origin?: 'follow' | 'explicit';
};

export type BrowserViewportResize = (
  width: number,
  height: number,
  options?: BrowserViewportResizeOptions,
) => Promise<unknown>;

export type UseBrowserViewportInput = {
  /** The element whose box the page should follow (the frame content area). */
  containerRef: RefObject<HTMLElement | null>;
  /** Only follow mode drives the Host viewport from the panel box. */
  enabled: boolean;
  /** Mirror lease id; the Host only accepts follow resizes from one live lease. */
  leaseId: string | undefined;
  controller: BrowserController;
  resize: BrowserViewportResize;
};

/**
 * Sends follow-mode `browser/resize` requests for the panel content box.
 * No-ops when follow is not the active mode, and never resizes while the agent
 * holds the lock — the held intent is committed after release.
 */
export function useBrowserViewport(input: UseBrowserViewportInput): void {
  const latest = useRef(input);
  latest.current = input;
  const followRef = useRef<BrowserViewportFollowController | null>(null);

  useEffect(() => {
    if (!input.enabled) return;
    const element = input.containerRef.current;
    if (!element) return;
    const follow = createBrowserViewportFollowController({
      send: (size) => {
        const current = latest.current;
        return current.resize(size.width, size.height, {
          ...(current.leaseId !== undefined ? { leaseId: current.leaseId } : {}),
          mode: 'follow',
          origin: 'follow',
        });
      },
    });
    follow.setController(latest.current.controller);
    follow.observe(resolveFollowViewportBox(element));
    followRef.current = follow;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            follow.observe(resolveFollowViewportBox(element));
          });
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      follow.dispose();
      if (followRef.current === follow) followRef.current = null;
    };
  }, [input.enabled, input.containerRef]);

  useEffect(() => {
    followRef.current?.setController(input.controller);
  }, [input.controller]);
}

/**
 * Map a stored preference back onto a menu entry. Tablet shares `custom` mode
 * with the free-form size, so it is recognised by its preset dimensions.
 */
export function resolveViewportPresetId(preference: {
  mode: BrowserViewportMode;
  width: number;
  height: number;
}): BrowserViewportPresetId {
  if (preference.mode === 'follow') return 'responsive';
  if (preference.mode === 'fixed') return 'desktop';
  if (preference.mode === 'mobile') return 'mobile';
  const tablet = BROWSER_VIEWPORT_MENU_PRESETS.tablet;
  if (preference.mode === 'custom' && preference.width === tablet.width && preference.height === tablet.height) {
    return 'tablet';
  }
  return 'custom';
}
