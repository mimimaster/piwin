/**
 * Renderer self-heal: recover WebContent-pinned graphics memory by relaunching
 * the renderer process when degradation alone cannot.
 *
 * Forensics (2026-08-21, dev instance): sustained streaming/HMR repaint left
 * 1088 MB of "Owned physical footprint (unmapped) (graphics)" pinned in the
 * WebContent process. It survived full DOM teardown (`display: none` on
 * everything), simulated WebKit memory pressure, GC, and two full document
 * navigations. Killing the renderer released it (1365 MB → 185 MB); WKWebView
 * reloads the page and the shell re-hydrates from the Host (ADR 0038).
 *
 * 2026-08-22 packaged-app sample: main WebContent climbed 164 → 900+ MB over
 * ~3 h of a quiet session (gfx 32 → 500+). Governor moderate (768) stripped
 * glass and did not move the IOSurface ledger. Self-heal must not wait for the
 * visual-critical ceiling (1536) — that tier also sheds highlighting while the
 * user is looking. Reclaim is therefore a separate byte floor, and
 * ordinarily fires when the user is not looking (hidden, or unfocused long
 * enough). At 1536 MiB it also reclaims a focused/streaming shell; renderer-local
 * work and owner preflight vetoes remain protected (2026-11-04).
 *
 * Policy lives here (unit-tested, injectable clock); the Rust command
 * `relaunch_webview_renderer` is the mechanism.
 */
import {
  getLastMemoryPressureBytes,
  MEMORY_PRESSURE_CRITICAL_BYTES,
} from '../notes/memory-pressure.js';
import { getWindowPresence, subscribeWindowPresence } from './window-focus-signal';
import { prepareRendererRelaunch } from './renderer-relaunch-preparation.js';
import {
  readRendererRelaunchAttempt,
  recordRendererRelaunchAttempt,
} from './renderer-relaunch-cooldown.js';

const MIB = 1024 * 1024;

/**
 * Release idle-after-use plateau sat at 650–1000 MB with gfx pinned. Cold
 * packaged start is ~164 MB; a healthy loaded idle is well below this floor.
 * Independent of MEMORY_PRESSURE_CRITICAL_BYTES so we can recycle without
 * turning the visible UI into safe-mode.
 */
export const SELF_HEAL_RECLAIM_BYTES = 512 * MIB;

/** Reclaim even a focused/streaming shell; execution belongs to the Host. */
export const SELF_HEAL_MAX_BYTES = MEMORY_PRESSURE_CRITICAL_BYTES;

/** Avoid a reload loop without letting the ordinary ten-minute hold defeat the budget. */
export const SELF_HEAL_PRESSURE_COOLDOWN_MS = 60_000;

/** Align with parking: cmd-tab must not recycle the renderer. */
export const SELF_HEAL_HIDDEN_HOLD_MS = 120_000;

/**
 * Activity Monitor in front leaves the document visible. Five minutes of
 * backgrounded-but-on-screen is the Chrome discarded-tab analog that still
 * avoids a flash while the user is glancing at piwin on another display.
 */
export const SELF_HEAL_UNFOCUSED_HOLD_MS = 5 * 60 * 1000;

/** Minimum spacing between relaunch attempts (kill failures, SPI loss). */
export const SELF_HEAL_COOLDOWN_MS = 10 * 60 * 1000;

/** Decision cadence; coarse on purpose. */
export const SELF_HEAL_TICK_MS = 30 * 1000;

export type RendererActivity = {
  runActive: boolean;
  /** Renderer-local content or media that cannot survive termination. */
  protectedWork: boolean;
};

export type RendererSelfHealInput = RendererActivity & {
  bytes: number | null;
  documentHidden: boolean;
  windowFocused: boolean;
  hiddenSinceMs: number | null;
  unfocusedSinceMs: number | null;
  lastAttemptAtMs: number | null;
  nowMs: number;
};

export function shouldRelaunchRenderer(input: RendererSelfHealInput): boolean {
  if (
    input.bytes === null ||
    !Number.isFinite(input.bytes) ||
    input.bytes < SELF_HEAL_RECLAIM_BYTES
  ) {
    return false;
  }
  if (input.protectedWork) {
    return false;
  }
  const overBudget = input.bytes >= SELF_HEAL_MAX_BYTES;
  const cooldownMs = overBudget ? SELF_HEAL_PRESSURE_COOLDOWN_MS : SELF_HEAL_COOLDOWN_MS;
  if (input.lastAttemptAtMs !== null && input.nowMs - input.lastAttemptAtMs < cooldownMs) {
    return false;
  }
  if (overBudget) {
    return true;
  }
  if (input.runActive) {
    return false;
  }
  const hiddenLongEnough =
    input.documentHidden &&
    input.hiddenSinceMs !== null &&
    input.nowMs - input.hiddenSinceMs >= SELF_HEAL_HIDDEN_HOLD_MS;
  const unfocusedLongEnough =
    !input.windowFocused &&
    input.unfocusedSinceMs !== null &&
    input.nowMs - input.unfocusedSinceMs >= SELF_HEAL_UNFOCUSED_HOLD_MS;
  return hiddenLongEnough || unfocusedLongEnough;
}

export type RendererSelfHealDeps = {
  getBytes: () => number | null;
  getActivity: () => RendererActivity;
  isDocumentHidden: () => boolean;
  isWindowFocused: () => boolean;
  /** Native termination skips browser unload events; persist the current view first. */
  beforeRelaunch?: () => boolean | void;
  lastAttemptAtMs?: number | null;
  recordAttempt?: (timestamp: number) => void;
  requestRelaunch: () => Promise<boolean>;
  now: () => number;
};

export type RendererSelfHeal = {
  /** Evaluate once; exposed for tests. Returns true when a relaunch fired. */
  tick: () => boolean;
  dispose: () => void;
};

export function createRendererSelfHeal(deps: RendererSelfHealDeps): RendererSelfHeal {
  let hiddenSinceMs: number | null = null;
  let unfocusedSinceMs: number | null = null;
  let lastAttemptAtMs = deps.lastAttemptAtMs ?? null;
  let inFlight = false;

  const tick = (): boolean => {
    const nowMs = deps.now();
    const documentHidden = deps.isDocumentHidden();
    const windowFocused = deps.isWindowFocused();
    if (documentHidden) {
      hiddenSinceMs ??= nowMs;
    } else {
      hiddenSinceMs = null;
    }
    if (!windowFocused) {
      unfocusedSinceMs ??= nowMs;
    } else {
      unfocusedSinceMs = null;
    }

    const fire = shouldRelaunchRenderer({
      bytes: deps.getBytes(),
      ...deps.getActivity(),
      documentHidden,
      windowFocused,
      hiddenSinceMs,
      unfocusedSinceMs,
      lastAttemptAtMs,
      nowMs,
    });
    if (!fire || inFlight) {
      return false;
    }
    if (deps.beforeRelaunch?.() === false) {
      return false;
    }
    lastAttemptAtMs = nowMs;
    deps.recordAttempt?.(nowMs);
    inFlight = true;
    console.warn('[renderer-self-heal] reclaiming WebContent renderer');
    void deps
      .requestRelaunch()
      .then((relaunched) => {
        if (!relaunched) console.warn('[renderer-self-heal] native renderer relaunch unavailable');
      })
      .catch((error: unknown) => {
        console.warn('[renderer-self-heal] relaunch request failed:', error);
      })
      .finally(() => {
        inFlight = false;
      });
    return true;
  };

  return {
    tick,
    dispose: () => undefined,
  };
}

async function invokeRelaunchRenderer(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<boolean>('relaunch_webview_renderer');
}

let installedTick: (() => boolean) | null = null;

/** Parking calls this at the 2-minute mark so we do not wait for the next interval. */
export function requestRendererSelfHealTick(): boolean {
  return installedTick?.() ?? false;
}

/**
 * Wire the self-heal loop for the Tauri shell. Activity separates Host work
 * from protected renderer-local work; non-Tauri harnesses install
 * nothing. Returns a cleanup for effect symmetry.
 */
export function installRendererSelfHeal(getActivity: () => RendererActivity): () => void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => undefined;
  }
  const selfHeal = createRendererSelfHeal({
    getBytes: getLastMemoryPressureBytes,
    getActivity,
    isDocumentHidden: () => !getWindowPresence().documentVisible,
    isWindowFocused: () => getWindowPresence().focused,
    beforeRelaunch: prepareRendererRelaunch,
    lastAttemptAtMs: readRendererRelaunchAttempt(),
    recordAttempt: recordRendererRelaunchAttempt,
    requestRelaunch: invokeRelaunchRenderer,
    now: Date.now,
  });
  const unsubscribePresence = subscribeWindowPresence(() => {
    selfHeal.tick();
  });
  installedTick = () => selfHeal.tick();
  const onPressure = (): void => {
    selfHeal.tick();
  };
  window.addEventListener('desktop:memory-pressure', onPressure);
  const timer = setInterval(() => {
    selfHeal.tick();
  }, SELF_HEAL_TICK_MS);

  return () => {
    installedTick = null;
    clearInterval(timer);
    unsubscribePresence();
    window.removeEventListener('desktop:memory-pressure', onPressure);
    selfHeal.dispose();
  };
}
