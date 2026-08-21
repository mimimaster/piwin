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
 * Policy lives here (unit-tested, injectable clock); the Rust command
 * `relaunch_webview_renderer` is the mechanism. Deliberately conservative:
 * only while the governor has held `critical` continuously, no run is
 * streaming, and the window is hidden — the relaunch flash happens when the
 * user is not looking, and an unsent composer draft implies a visible window.
 */
import { globalMemoryGovernor, type MemoryPressureLevel } from './memory-governor';

/** Critical must persist this long before a relaunch is considered. */
export const SELF_HEAL_CRITICAL_HOLD_MS = 5 * 60 * 1000;

/** Minimum spacing between relaunch attempts (kill failures, SPI loss). */
export const SELF_HEAL_COOLDOWN_MS = 30 * 60 * 1000;

/** Decision cadence; coarse on purpose — this is a last-resort valve. */
export const SELF_HEAL_TICK_MS = 60 * 1000;

export type RendererSelfHealInput = {
  level: MemoryPressureLevel;
  /** Epoch ms when the governor entered critical, or null while not critical. */
  criticalSinceMs: number | null;
  /** A chat run is streaming/compacting; never interrupt active work. */
  busy: boolean;
  documentHidden: boolean;
  lastAttemptAtMs: number | null;
  nowMs: number;
};

export function shouldRelaunchRenderer(input: RendererSelfHealInput): boolean {
  if (input.level !== 'critical' || input.criticalSinceMs === null) {
    return false;
  }
  if (input.busy || !input.documentHidden) {
    return false;
  }
  if (input.nowMs - input.criticalSinceMs < SELF_HEAL_CRITICAL_HOLD_MS) {
    return false;
  }
  if (
    input.lastAttemptAtMs !== null &&
    input.nowMs - input.lastAttemptAtMs < SELF_HEAL_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

export type RendererSelfHealDeps = {
  getLevel: () => MemoryPressureLevel;
  subscribeLevel: (listener: (level: MemoryPressureLevel) => void) => () => void;
  isBusy: () => boolean;
  isDocumentHidden: () => boolean;
  requestRelaunch: () => Promise<boolean>;
  now: () => number;
};

export type RendererSelfHeal = {
  /** Evaluate once; exposed for tests. Returns true when a relaunch fired. */
  tick: () => boolean;
  dispose: () => void;
};

export function createRendererSelfHeal(deps: RendererSelfHealDeps): RendererSelfHeal {
  let criticalSinceMs: number | null = deps.getLevel() === 'critical' ? deps.now() : null;
  let lastAttemptAtMs: number | null = null;

  const unsubscribe = deps.subscribeLevel((level) => {
    if (level === 'critical') {
      criticalSinceMs ??= deps.now();
    } else {
      criticalSinceMs = null;
    }
  });

  const tick = (): boolean => {
    const fire = shouldRelaunchRenderer({
      level: deps.getLevel(),
      criticalSinceMs,
      busy: deps.isBusy(),
      documentHidden: deps.isDocumentHidden(),
      lastAttemptAtMs,
      nowMs: deps.now(),
    });
    if (!fire) {
      return false;
    }
    lastAttemptAtMs = deps.now();
    console.warn(
      '[renderer-self-heal] critical pressure held while hidden and idle; relaunching WebContent',
    );
    void deps.requestRelaunch().catch((error: unknown) => {
      console.warn('[renderer-self-heal] relaunch request failed:', error);
    });
    return true;
  };

  return {
    tick,
    dispose: () => {
      unsubscribe();
    },
  };
}

async function invokeRelaunchRenderer(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<boolean>('relaunch_webview_renderer');
}

/**
 * Wire the self-heal loop for the Tauri shell. `isBusy` is provided by the
 * App (streaming/compacting state); non-Tauri harnesses install nothing.
 * Returns a cleanup for effect symmetry.
 */
export function installRendererSelfHeal(isBusy: () => boolean): () => void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => undefined;
  }
  const selfHeal = createRendererSelfHeal({
    getLevel: globalMemoryGovernor.getLevel,
    subscribeLevel: globalMemoryGovernor.subscribe,
    isBusy,
    isDocumentHidden: () => document.visibilityState === 'hidden',
    requestRelaunch: invokeRelaunchRenderer,
    now: Date.now,
  });
  const timer = setInterval(() => {
    selfHeal.tick();
  }, SELF_HEAL_TICK_MS);
  return () => {
    clearInterval(timer);
    selfHeal.dispose();
  };
}
