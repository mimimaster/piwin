/**
 * S07 presentation helpers for the memory diagnostics panel: byte/age
 * formatting, ordinary-language summaries of reclaim-ledger episodes and
 * renderer-recovery reasons, plus the renderer-side data bundle the panel
 * renders. No React — unit-testable in isolation.
 */
import type { MemoryPressureLevel } from './cache-budget.js';
import type { ReclaimLedgerEntry } from './reclaim-ledger.js';
import type { ManualReclaimResult } from './reclaim-wiring.js';
import type { DesktopObservabilitySnapshot } from '../run-activity/diagnostic-metrics.js';
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract.js';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { memoryDiagnosticsCopy } from './memory-diagnostics-copy.js';

export type SampleFreshness = 'fresh' | 'stale' | 'missing';

/** Panel readings older than two minutes are treated as stale. */
export const PANEL_STALE_SAMPLE_AGE_MS = 120_000;

/**
 * Everything the panel renders per tick. The native snapshot may be null
 * (non-Tauri runtime / invoke failure); the frontend counters are always
 * collectable.
 */
export type MemoryDiagnosticsPanelData = {
  native: NativeMemoryObservabilitySnapshot | null;
  frontend: DesktopObservabilitySnapshot;
  level: MemoryPressureLevel;
  /** Current reclaim episode, otherwise the latest completed one. */
  episode: ReclaimLedgerEntry | undefined;
  /** Registered presentation resources still live. */
  presentations: number;
  /** Of those, how many sit on a visible session key. */
  visible: number;
  /** Cold views mid-restore (protected like visible ones). */
  restoring: number;
  /** Warm transcript snapshots across registered caches. */
  warmSnapshots: number;
  /** Reclaim candidates a manual release could act on right now. */
  eligibleCandidates: number;
  /** Whether occlusion parking (`html[data-memory-parked]`) is currently active. */
  parked?: boolean;
};

export type VisualDegradationPolicyEntry = {
  id: 'core-motion' | 'text-shimmer' | 'glass-and-masks';
  label: string;
  status: string;
  active: boolean;
};

/** Real-time count of mounted whitelisted status animations (`ui-anim-*`). */
export function getLiveStatusAnimationCount(
  data: Pick<MemoryDiagnosticsPanelData, 'frontend'> | null,
): number {
  return data?.frontend.resourceCounts['liveStatusAnimations'] ?? 0;
}

/**
 * Current visual/motion degradation matrix matching `memory-degradation.css`.
 * Core status indicators stay full at all pressure levels while visible, and
 * pause only when occluded (`parked`).
 */
export function describeVisualDegradationPolicy(
  data: Pick<MemoryDiagnosticsPanelData, 'level' | 'parked' | 'frontend'> | null,
  locale: DesktopLocale = 'en',
): VisualDegradationPolicyEntry[] {
  const copy = memoryDiagnosticsCopy(locale);
  const level = data?.level ?? 'normal';
  const parked = data?.parked === true;
  const liveCount = getLiveStatusAnimationCount(data);
  const pressureDegraded = level !== 'normal' || parked;
  const coreMotionStatus = parked
    ? copy.motionPolicyItems.coreMotion.paused(liveCount)
    : copy.motionPolicyItems.coreMotion.active(liveCount);

  return [
    {
      id: 'core-motion',
      label: copy.motionPolicyItems.coreMotion.label,
      status: coreMotionStatus,
      active: !parked,
    },
    {
      id: 'text-shimmer',
      label: copy.motionPolicyItems.shimmer.label,
      status: pressureDegraded
        ? copy.motionPolicyItems.shimmer.degraded
        : copy.motionPolicyItems.shimmer.active,
      active: !pressureDegraded,
    },
    {
      id: 'glass-and-masks',
      label: copy.motionPolicyItems.glassAndMasks.label,
      status: pressureDegraded
        ? copy.motionPolicyItems.glassAndMasks.degraded
        : copy.motionPolicyItems.glassAndMasks.active,
      active: !pressureDegraded,
    },
  ];
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

export function sampleFreshness(
  timestampMs: number | undefined,
  nowMs: number,
): SampleFreshness {
  if (timestampMs === undefined || !Number.isFinite(timestampMs)) {
    return 'missing';
  }
  return nowMs - timestampMs <= PANEL_STALE_SAMPLE_AGE_MS ? 'fresh' : 'stale';
}

/** Governor level → badge tone, mirroring the escalation semantics. */
export function governorLevelTone(level: MemoryPressureLevel): 'success' | 'warning' | 'danger' {
  if (level === 'critical') return 'danger';
  if (level === 'moderate') return 'warning';
  return 'success';
}

/**
 * Localized resource estimate and episode state for technical details.
 * This is separate from the before/after process-footprint evidence.
 */
export function describeEpisodeOutcome(episode: ReclaimLedgerEntry, locale: DesktopLocale = 'en'): string {
  const copy = memoryDiagnosticsCopy(locale);
  const outcome = episode.outcome;
  const base = outcome === undefined ? copy.running : copy.outcomes[outcome];
  if (episode.releasedBytesEstimate > 0) {
    return `${copy.estimate} ≈${formatBytes(episode.releasedBytesEstimate)} · ${base}`;
  }
  return base;
}

/** Plain-language summary of a manual-release result line. */
export function describeManualReclaimResult(result: ManualReclaimResult, locale: DesktopLocale = 'en'): string {
  const copy = memoryDiagnosticsCopy(locale);
  if (result.reason === 'no-candidates') {
    return copy.manualNone;
  }
  if (result.releasedKeys.length === 0) {
    return copy.manualNoRelease;
  }
  return result.releasedBytes > 0
    ? copy.manualReleased(result.releasedKeys.length, formatBytes(result.releasedBytes))
    : copy.manualRequested(result.releasedKeys.length);
}

/** Ordinary-language renderer-recovery blockers for the restart button. */
export function describeRecoveryReason(reason: string | undefined, locale: DesktopLocale = 'en'): string {
  const copy = memoryDiagnosticsCopy(locale);
  const reasons: Record<string, string> = copy.recoveryReasons;
  return reason === undefined ? copy.restartUnavailable : reasons[reason] ?? copy.restartUnavailable;
}
