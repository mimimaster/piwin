/**
 * TypeScript mirror of the Rust `desktop:memory-pressure` observability
 * payload (src-tauri/src/memory_pressure/types.rs), plus runtime guards.
 *
 * The Rust sensor is policy-free: these types are the wire contract only.
 * Tier classification stays in memory-pressure.ts. Field names are the
 * serde camelCase spellings; optional fields are absent (never null, never
 * 0-bytes) when the platform could not sample them.
 */
import type {
  DesktopMemoryObservabilitySnapshot,
  DesktopMemoryOsPressureLevel,
  DesktopMemoryPressureSample,
  DesktopMemoryProcessSample,
  DesktopMemoryPurgeResult,
  DesktopMemoryRetiredProcess,
  DesktopMemorySampleError,
  DesktopMemorySampleErrorKind,
  DesktopMemorySampleQuality,
} from '@piwin/contracts';

export type NativeOsPressureLevel = DesktopMemoryOsPressureLevel;

export type ProcessWindowRole = DesktopMemoryProcessSample['role'];

export type NativeProcessSample = DesktopMemoryProcessSample;

export type NativeRetiredProcess = DesktopMemoryRetiredProcess;

export type NativeSampleErrorKind = DesktopMemorySampleErrorKind;

export type NativeSampleError = DesktopMemorySampleError;

export type SampleQuality = DesktopMemorySampleQuality;

/**
 * Payload of `desktop:memory-pressure` events. `bytes`, `availableBytes` and
 * `level` keep their legacy meaning; everything else is additive
 * observability emitted by the S00 monitor baseline.
 */
export type MemoryPressureEventDetail = DesktopMemoryPressureSample;

export type MemoryPurgeStatus = DesktopMemoryPurgeResult['status'];

/** Payload of `desktop:memory-purge` lifecycle events. */
export type NativeMemoryPurgeResult = DesktopMemoryPurgeResult;

/** Return shape of the `memory_observability_snapshot` Tauri command. */
export type NativeMemoryObservabilitySnapshot = DesktopMemoryObservabilitySnapshot;

/** Finite non-negative byte count (fields like availableBytes may be 0). */
export function isFiniteByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A footprint of 0 bytes is never a valid sample — missing stays missing. */
export function isPositiveByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isNativeOsPressureLevel(value: unknown): value is NativeOsPressureLevel {
  return (
    value === 'normal' || value === 'warning' || value === 'urgent' || value === 'critical'
  );
}

function isProcessSample(value: unknown): value is NativeProcessSample {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const sample = value as Record<string, unknown>;
  if (typeof sample.windowLabel !== 'string') {
    return false;
  }
  if (sample.role !== 'main' && sample.role !== 'auxiliary') {
    return false;
  }
  if (sample.role !== (sample.windowLabel === 'main' ? 'main' : 'auxiliary')) {
    return false;
  }
  if (sample.pid !== undefined && (typeof sample.pid !== 'number' || !Number.isInteger(sample.pid))) {
    return false;
  }
  if (sample.startClock !== undefined && typeof sample.startClock !== 'string') {
    return false;
  }
  if (sample.footprintBytes !== undefined && !isPositiveByteCount(sample.footprintBytes)) {
    return false;
  }
  return sample.shared === true || sample.shared === false;
}

export function isProcessSampleArray(value: unknown): value is NativeProcessSample[] {
  return Array.isArray(value) && value.every(isProcessSample);
}

function isRetiredProcess(value: unknown): value is NativeRetiredProcess {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const retired = value as Record<string, unknown>;
  if (typeof retired.pid !== 'number' || !Number.isInteger(retired.pid)) {
    return false;
  }
  if (typeof retired.lastWindowLabel !== 'string') {
    return false;
  }
  if (retired.startClock !== undefined && typeof retired.startClock !== 'string') {
    return false;
  }
  return retired.lastFootprintBytes === undefined || isFiniteByteCount(retired.lastFootprintBytes);
}

function isSampleError(value: unknown): value is NativeSampleError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const error = value as Record<string, unknown>;
  if (error.kind !== 'webview-pid' && error.kind !== 'footprint' && error.kind !== 'os-pressure') {
    return false;
  }
  if (typeof error.message !== 'string') {
    return false;
  }
  return error.windowLabel === undefined || typeof error.windowLabel === 'string';
}

/**
 * Structural guard for `desktop:memory-pressure` details: legacy byte/level
 * fields plus the optional observability additions. Optional fields are only
 * checked when present; malformed optionals reject the whole detail.
 */
export function isMemoryPressureEventDetail(value: unknown): value is MemoryPressureEventDetail {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const detail = value as Record<string, unknown>;
  const checks: Array<[string, (v: unknown) => boolean]> = [
    ['bytes', isFiniteByteCount],
    ['availableBytes', isFiniteByteCount],
    ['availableBytesKind', (v) => v === 'reclaimable-estimate'],
    ['level', (v) => v === 'normal' || v === 'moderate' || v === 'critical'],
    ['sampleId', (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0],
    ['timestampMs', isFiniteByteCount],
    ['monotonicMs', isFiniteByteCount],
    ['appVersion', (v) => typeof v === 'string'],
    ['osPressure', isNativeOsPressureLevel],
    ['aggregateFootprintBytes', isFiniteByteCount],
    ['processes', isProcessSampleArray],
    [
      'retiredProcesses',
      (v) => Array.isArray(v) && v.every(isRetiredProcess),
    ],
    [
      'unknownWindows',
      (v) => Array.isArray(v) && v.every((label) => typeof label === 'string'),
    ],
    ['errors', (v) => Array.isArray(v) && v.every(isSampleError)],
    ['quality', (v) => v === 'full' || v === 'partial' || v === 'unavailable'],
  ];
  return checks.every(([key, check]) => detail[key] === undefined || check(detail[key]));
}

/**
 * Effective main-window footprint for classification: the `main` process
 * sample's `footprintBytes` wins, `detail.bytes` is the fallback, and 0 or
 * absent always means "missing" (never a real measurement).
 */
export function mainFootprintBytes(detail: MemoryPressureEventDetail): number | undefined {
  if (isProcessSampleArray(detail.processes)) {
    const main = detail.processes.find((process) => process.role === 'main');
    if (main && isPositiveByteCount(main.footprintBytes)) {
      return main.footprintBytes;
    }
  }
  if (isPositiveByteCount(detail.bytes)) {
    return detail.bytes;
  }
  return undefined;
}

/** Fully sampled payload fixture: main + one auxiliary window, OS pressure on. */
export const SAMPLE_FULL_PAYLOAD: MemoryPressureEventDetail = {
  sampleId: 42,
  timestampMs: 1_700_000_000_000,
  monotonicMs: 25_000,
  appVersion: '0.2.16',
  osPressure: 'normal',
  bytes: 900 * 1024 * 1024,
  aggregateFootprintBytes: 1_100 * 1024 * 1024,
  quality: 'full',
  processes: [
    {
      windowLabel: 'main',
      role: 'main',
      pid: 4242,
      startClock: '18446744073709551615',
      footprintBytes: 900 * 1024 * 1024,
      shared: false,
    },
    {
      windowLabel: 'pin-1',
      role: 'auxiliary',
      pid: 4243,
      startClock: '18446744073709551616',
      footprintBytes: 200 * 1024 * 1024,
      shared: false,
    },
  ],
  retiredProcesses: [],
  unknownWindows: [],
  errors: [],
};

/** Partially sampled payload: one window's SPI failed, ratio fallback on. */
export const SAMPLE_PARTIAL_PAYLOAD: MemoryPressureEventDetail = {
  sampleId: 43,
  timestampMs: 1_700_000_005_000,
  monotonicMs: 30_000,
  appVersion: '0.2.16',
  availableBytes: 2 * 1024 * 1024 * 1024,
  availableBytesKind: 'reclaimable-estimate',
  bytes: 512 * 1024 * 1024,
  aggregateFootprintBytes: 512 * 1024 * 1024,
  quality: 'partial',
  processes: [
    {
      windowLabel: 'main',
      role: 'main',
      pid: 4242,
      startClock: '18446744073709551615',
      footprintBytes: 512 * 1024 * 1024,
      shared: false,
    },
    {
      windowLabel: 'pet-overlay',
      role: 'auxiliary',
      shared: false,
    },
  ],
  retiredProcesses: [
    {
      pid: 4200,
      startClock: '18446744073709551000',
      lastWindowLabel: 'pin-1',
      lastFootprintBytes: 150 * 1024 * 1024,
    },
  ],
  unknownWindows: ['pet-overlay'],
  errors: [
    { kind: 'webview-pid', windowLabel: 'pet-overlay', message: 'no WebContent pid captured' },
  ],
};
