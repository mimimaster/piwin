import { globalMemoryGovernor, type MemoryPressureLevel } from './memory-governor';

const MIB = 1024 * 1024;

// Visual degradation only (glass at 768, highlighting/textures at 1536).
// Renderer reclaim is SELF_HEAL_RECLAIM_BYTES — 2026-08-22 packaged sample
// sat at 650–1000 MB with gfx pinned, so waiting for 1536 never fired.
export const MEMORY_PRESSURE_MODERATE_BYTES = 768 * MIB;
export const MEMORY_PRESSURE_CRITICAL_BYTES = 1536 * MIB;
export const MEMORY_PRESSURE_HYSTERESIS_BYTES = 64 * MIB;

const OS_CRITICAL_AVAILABLE_BYTES = 64 * MIB;
const OS_MODERATE_AVAILABLE_BYTES = 256 * MIB;

export type MemoryPressureSample = {
  bytes: number;
  availableBytes?: number;
};

export function classifyMemoryPressure(
  sample: MemoryPressureSample,
  currentLevel: MemoryPressureLevel = 'normal',
): MemoryPressureLevel {
  let baseLevel: MemoryPressureLevel = 'normal';
  if (sample.availableBytes !== undefined) {
    if (sample.availableBytes <= OS_CRITICAL_AVAILABLE_BYTES) {
      return 'critical';
    }
    if (sample.availableBytes <= OS_MODERATE_AVAILABLE_BYTES) {
      baseLevel = 'moderate';
    }
  }

  if (currentLevel === 'critical') {
    if (sample.bytes >= MEMORY_PRESSURE_CRITICAL_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES) {
      return 'critical';
    }
    if (sample.bytes >= MEMORY_PRESSURE_MODERATE_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES) {
      return 'moderate';
    }
    return baseLevel;
  }

  if (currentLevel === 'moderate') {
    if (sample.bytes >= MEMORY_PRESSURE_CRITICAL_BYTES) {
      return 'critical';
    }
    if (sample.bytes >= MEMORY_PRESSURE_MODERATE_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES) {
      return 'moderate';
    }
    return baseLevel;
  }

  if (sample.bytes >= MEMORY_PRESSURE_CRITICAL_BYTES) {
    return 'critical';
  }
  if (sample.bytes >= MEMORY_PRESSURE_MODERATE_BYTES) {
    return 'moderate';
  }

  return baseLevel;
}

export function applyMemoryPressureSample(sample: MemoryPressureSample): MemoryPressureLevel {
  lastSampledBytes = sample.bytes;
  const currentLevel = globalMemoryGovernor.getLevel();
  const nextLevel = classifyMemoryPressure(sample, currentLevel);
  globalMemoryGovernor.setLevel(nextLevel);
  return nextLevel;
}

/**
 * Payload of `desktop:memory-pressure` events. The Rust sensor
 * (src-tauri/src/memory_pressure.rs) emits `{ bytes, availableBytes }`
 * samples of the main WebContent footprint; the legacy fallback path (and
 * manual Web Inspector dispatch) may instead carry a pre-classified `level`.
 */
export type MemoryPressureEventDetail = {
  bytes?: number;
  availableBytes?: number;
  level?: MemoryPressureLevel;
};

const PRESSURE_LEVEL_RANK: Record<MemoryPressureLevel, number> = {
  normal: 0,
  moderate: 1,
  critical: 2,
};

/**
 * Minimum time a degradation tier is held after an escalation before byte
 * samples may lower it again. The byte hysteresis (64 MiB) alone cannot stop
 * visible flapping when the footprint hovers around a threshold: recovery
 * re-creates the just-destroyed backdrop-filter layers, the footprint climbs
 * back, and the glass would blink off/on every few samples. The dwell caps
 * that to at most one transition pair per window.
 */
export const MEMORY_PRESSURE_RECOVERY_DWELL_MS = 3 * 60 * 1000;

let lastEscalationAtMs = Number.NEGATIVE_INFINITY;

/**
 * Dwell state is module-level because the bridge is a singleton; tests reset
 * it between cases.
 */
export function resetMemoryPressureRecoveryDwell(): void {
  lastEscalationAtMs = Number.NEGATIVE_INFINITY;
}

let lastSampledBytes: number | null = null;

/** Latest main-window WebContent footprint, or null before the first sample. */
export function getLastMemoryPressureBytes(): number | null {
  return lastSampledBytes;
}

export function resetLastMemoryPressureBytes(): void {
  lastSampledBytes = null;
}

function isMemoryPressureLevel(value: unknown): value is MemoryPressureLevel {
  return value === 'normal' || value === 'moderate' || value === 'critical';
}

function isFiniteByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Route one pressure event into the governor. Byte samples go through the
 * classifier (single home for thresholds + hysteresis) and respect the
 * recovery dwell; explicit level payloads (fallback sensor, manual dispatch)
 * bypass the dwell. On an escalation edge the native purge is requested after
 * the synchronous CSS degradation has already destroyed the expensive
 * compositor layers.
 */
export function applyMemoryPressureEvent(
  detail: MemoryPressureEventDetail | undefined,
  nowMs: number = Date.now(),
): MemoryPressureLevel {
  const previousLevel = globalMemoryGovernor.getLevel();
  let nextLevel = previousLevel;

  if (detail !== undefined && isFiniteByteCount(detail.bytes)) {
    lastSampledBytes = detail.bytes;
    const sample: MemoryPressureSample = { bytes: detail.bytes };
    if (isFiniteByteCount(detail.availableBytes)) {
      sample.availableBytes = detail.availableBytes;
    }
    const classified = classifyMemoryPressure(sample, previousLevel);
    const holdForDwell =
      PRESSURE_LEVEL_RANK[classified] < PRESSURE_LEVEL_RANK[previousLevel] &&
      nowMs - lastEscalationAtMs < MEMORY_PRESSURE_RECOVERY_DWELL_MS;
    nextLevel = holdForDwell ? previousLevel : classified;
    globalMemoryGovernor.setLevel(nextLevel);
  } else if (detail !== undefined && isMemoryPressureLevel(detail.level)) {
    globalMemoryGovernor.setLevel(detail.level);
    nextLevel = detail.level;
  }

  if (PRESSURE_LEVEL_RANK[nextLevel] > PRESSURE_LEVEL_RANK[previousLevel]) {
    lastEscalationAtMs = nowMs;
    void requestNativeWebviewMemoryPurge();
  }
  return nextLevel;
}

let memoryPressureBridgeInstalled = false;

/**
 * Wire the `desktop:memory-pressure` channel into the governor. Called once
 * from main.tsx before first render.
 *
 * Rust is a policy-free sensor; classification lives here so thresholds stay
 * unit-tested in one place. The DOM CustomEvent path is kept so Web Inspector
 * and tests can inject samples without Tauri:
 *   window.dispatchEvent(new CustomEvent('desktop:memory-pressure',
 *     { detail: { bytes: 900 * 1024 * 1024 } }))
 */
export function installMemoryPressureBridge(): void {
  if (typeof window === 'undefined' || memoryPressureBridgeInstalled) {
    return;
  }
  memoryPressureBridgeInstalled = true;

  window.addEventListener('desktop:memory-pressure', ((event: Event) => {
    applyMemoryPressureEvent((event as CustomEvent<MemoryPressureEventDetail>).detail);
  }) as EventListener);

  void bridgeTauriMemoryPressureEvents().catch((error) => {
    console.warn('[memory-pressure] native pressure bridge unavailable:', error);
  });
}

/**
 * Re-dispatch the Rust-side Tauri event onto the DOM event handled above.
 * Without this bridge the governor never hears about native samples and the
 * degradation tiers stay dead code. Non-Tauri harnesses (tests, browser dev)
 * have no event channel and intentionally keep the governor at `normal`.
 */
async function bridgeTauriMemoryPressureEvents(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return;
  }
  const { listen } = await import('@tauri-apps/api/event');
  await listen<MemoryPressureEventDetail>('desktop:memory-pressure', (event) => {
    window.dispatchEvent(new CustomEvent('desktop:memory-pressure', { detail: event.payload }));
  });
}

/**
 * Best-effort WKWebsiteDataStore memory-cache purge via the Rust
 * `purge_webview_memory` command (drops decoded images/scripts inside
 * WebContent). No-op outside Tauri; failures are logged, never thrown —
 * CSS degradation must not depend on the purge succeeding.
 */
export async function requestNativeWebviewMemoryPurge(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('purge_webview_memory');
  } catch (error) {
    console.warn('[memory-pressure] webview memory purge failed:', error);
  }
}
