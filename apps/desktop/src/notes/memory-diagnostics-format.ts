/**
 * S07 presentation helpers for the memory diagnostics panel: byte/age
 * formatting, ordinary-language summaries of reclaim-ledger episodes and
 * renderer-recovery reasons, plus the renderer-side data bundle the panel
 * renders. No React — unit-testable in isolation.
 */
import type { MemoryPressureLevel } from './cache-budget.js';
import type { EpisodeOutcome } from './reclaim-policy.js';
import type { ReclaimLedgerEntry } from './reclaim-ledger.js';
import type { ManualReclaimResult } from './reclaim-wiring.js';
import type { DesktopObservabilitySnapshot } from '../run-activity/diagnostic-metrics.js';
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract.js';

export type SampleFreshness = 'fresh' | 'stale' | 'missing';

/** Panel-grade freshness window (the sampler ticks once a minute). */
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
  /** Latest completed reclaim episode, when the ledger has any. */
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
};

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

const OUTCOME_TEXT: Record<EpisodeOutcome, string> = {
  recovered: 'memory pressure returned to normal',
  'protected-over-budget': 'only protected resources remain',
  'no-progress': 'waiting for a fresh sample',
  'sampler-unavailable': 'the native sampler stopped reporting',
  'renderer-unresponsive': 'the renderer did not respond',
};

/**
 * One ordinary-language line for the latest ledger episode, e.g.
 * "released ~48.0 MB · memory pressure returned to normal".
 */
export function describeEpisodeOutcome(episode: ReclaimLedgerEntry): string {
  const outcome = episode.outcome;
  const base = outcome === undefined ? 'episode still running' : OUTCOME_TEXT[outcome];
  if (episode.releasedBytesEstimate > 0) {
    return `released ~${formatBytes(episode.releasedBytesEstimate)} · ${base}`;
  }
  return base;
}

/** Plain-language summary of a manual-release result line. */
export function describeManualReclaimResult(result: ManualReclaimResult): string {
  if (result.reason === 'no-candidates') {
    return 'Nothing idle to release — only protected or visible resources remain.';
  }
  if (result.releasedKeys.length === 0) {
    return 'Nothing was released.';
  }
  const suffix =
    result.releasedBytes > 0 ? ` (≈${formatBytes(result.releasedBytes)})` : '';
  return `Released ${result.releasedKeys.length} resource(s)${suffix}.`;
}

/** Ordinary-language renderer-recovery blockers for the restart button. */
export function describeRecoveryReason(reason: string | undefined): string {
  switch (reason) {
    case 'run-active':
      return 'A run is in progress — restart when it finishes.';
    case 'draft-state-unavailable':
      return 'Draft state is unavailable — restart is locked to protect unsent text.';
    case 'drafts-not-durable':
      return 'Some drafts are not saved yet — restart is locked to protect them.';
    case 'cancelled-by-handler':
      return 'A view vetoed the restart to protect its state.';
    default:
      return 'Restart is currently unavailable.';
  }
}
