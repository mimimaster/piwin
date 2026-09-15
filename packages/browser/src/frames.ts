/**
 * Throttled screenshot frame capture for the desktop mirror panel (ADR 0020 §2).
 * A frame is JPEG bytes plus metadata; only the local JSON adapter turns that
 * into base64 (spec §4.1.2). Emitted at most every `intervalMs` and only while
 * the mirror still owns a lease.
 */
export type FramePayload = {
  bytes: Uint8Array;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  /** Page compositor DPR that produced the pixels (spec §4.1.1). */
  sourceDpr: number;
};

export type FrameEvent = FramePayload & { ts: number };

export type FrameLoopOptions = {
  capture: () => Promise<FramePayload>;
  hasSubscriber: () => boolean;
  /** Minimum interval between emissions in ms (default 250 ≈ 4 fps). */
  intervalMs?: number;
  now?: () => number;
  emit: (frame: FrameEvent) => void;
};

export type FrameLoop = {
  start(): void;
  stop(): void;
  /** Captures now if the throttle allows and a subscriber is present. */
  requestFrame(): Promise<void>;
};

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? (() => Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  // Start "in the past" so the very first request/capture emits immediately
  // instead of being throttled by the initial timestamp of 0.
  let lastEmit = -Infinity;
  let inFlight = false;
  let pending = false;

  async function attemptCapture(): Promise<void> {
    if (inFlight) {
      pending = true;
      return;
    }
    if (!options.hasSubscriber()) return;
    if (now() - lastEmit < intervalMs) return;

    inFlight = true;
    try {
      const payload = await options.capture();
      // The consumer may have released its lease while an asynchronous
      // screenshot was in flight. Do not forward that now-unowned data URL.
      if (!options.hasSubscriber()) return;
      const ts = now();
      lastEmit = ts;
      options.emit({ ...payload, ts });
    } catch {
      // Frame capture is best-effort: a failing screenshot (e.g. while a
      // navigation is tearing the page down) must not reject `requestFrame()`
      // — `navigate()` awaits it — nor become an unhandled rejection from the
      // interval call sites. The `finally` block resets inFlight/pending so
      // the loop stays healthy and the next tick retries.
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        void attemptCapture();
      }
    }
  }

  return {
    start(): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        void attemptCapture();
      }, intervalMs);
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      pending = false;
      lastEmit = -Infinity;
    },
    requestFrame(): Promise<void> {
      return attemptCapture();
    },
  };
}
