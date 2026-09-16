/**
 * Desktop viewport policy for the browser workbench (spec §4.1).
 *
 * The Host stays authoritative: this module only decides *when* the panel
 * asks for a follow resize, and it never touches the coordinate space
 * optimistically — a failed request keeps the previous actual viewport.
 */
import { useEffect, useRef, type RefObject } from 'react';
import type { BrowserViewportMode } from '@piwin/contracts';

export type BrowserViewportSize = { width: number; height: number };

/**
 * Axis changes smaller than this are not worth a round trip. 1px: the frame is
 * shown filled, so any leftover difference would read as a seam or stretch.
 */
export const BROWSER_FOLLOW_RESIZE_MIN_DELTA_PX = 1;

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
  /** Last size the Host accepted (undefined until the first success). */
  lastAccepted(): BrowserViewportSize | undefined;
  dispose(): void;
};

export type BrowserViewportFollowControllerOptions = {
  send: (size: BrowserViewportSize) => Promise<unknown>;
  minDeltaPx?: number;
};

/**
 * Follow-mode resizes without a debounce: the first change goes out at once,
 * changes during an in-flight request collapse into the latest size, and that
 * size is sent as soon as the Host answers. A panel drag therefore tracks the
 * pointer at the Host's own pace instead of waiting for the drag to stop.
 * Agent activity does not hold resizes back — the Host queues them between
 * agent operations.
 */
export function createBrowserViewportFollowController(
  options: BrowserViewportFollowControllerOptions,
): BrowserViewportFollowController {
  const minDeltaPx = options.minDeltaPx ?? BROWSER_FOLLOW_RESIZE_MIN_DELTA_PX;

  let accepted: BrowserViewportSize | undefined;
  let latest: BrowserViewportSize | undefined;
  let sending = false;
  let disposed = false;

  async function flush(): Promise<void> {
    if (disposed || sending) return;
    const next = latest;
    latest = undefined;
    if (next === undefined || !shouldSendFollowResize(accepted, next, minDeltaPx)) return;
    sending = true;
    try {
      await options.send(next);
      // Only a Host-accepted resize moves the coordinate space.
      accepted = next;
    } catch {
      // Keep the previous accepted size; the next observation retries.
    } finally {
      sending = false;
      if (latest !== undefined) void flush();
    }
  }

  return {
    observe(size) {
      if (disposed || size === undefined) return;
      latest = size;
      void flush();
    },
    lastAccepted: () => accepted,
    dispose() {
      disposed = true;
      latest = undefined;
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
  resize: BrowserViewportResize;
};

/**
 * Sends follow-mode `browser/resize` requests for the panel content box.
 * No-ops when follow is not the active mode.
 */
export function useBrowserViewport(input: UseBrowserViewportInput): void {
  const latest = useRef(input);
  latest.current = input;

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
    follow.observe(resolveFollowViewportBox(element));
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
    };
  }, [input.enabled, input.containerRef]);
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
