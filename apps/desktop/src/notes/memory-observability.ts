/**
 * Tauri glue for the S00 memory-observability baseline: ack emitted samples
 * and read the bounded observability snapshot. Both are no-ops outside Tauri
 * (tests, browser dev) and never throw — diagnostics must not break policy.
 */
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Ack one emitted `sampleId` so the native monitor may emit the next tick.
 * Emissions are ack-gated rather than queued; without acks the monitor only
 * counts stalled ticks and keeps rewriting the mapping file.
 */
export async function ackNativeMemorySample(sampleId: number): Promise<boolean> {
  if (!isTauriRuntime() || !Number.isInteger(sampleId) || sampleId < 0) {
    return false;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<boolean>('ack_memory_sample', { sampleId })) === true;
  } catch (error) {
    console.warn('[memory-observability] sample ack failed:', error);
    return false;
  }
}

/** Bounded recent samples + purge lifecycle + pending-ack state. */
export async function getMemoryObservabilitySnapshot(): Promise<NativeMemoryObservabilitySnapshot | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<NativeMemoryObservabilitySnapshot>('memory_observability_snapshot');
  } catch (error) {
    console.warn('[memory-observability] snapshot failed:', error);
    return null;
  }
}
