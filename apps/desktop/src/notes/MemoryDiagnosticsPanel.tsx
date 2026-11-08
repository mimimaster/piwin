/**
 * S07 compact memory diagnostics for the right-panel inspector. Polls the
 * native observability snapshot plus renderer-side counters on a refresh
 * interval and exposes two explicit actions: "Release idle resources"
 * (requestManualReclaim) and "Restart the workbench view"
 * (requestRendererRecovery). Outside Tauri the native snapshot is null and
 * the panel degrades to "native sampling unavailable".
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button, Card, StatusBadge } from '@piwin/ui-kit';
import { MemoryDiagExpandable, MemoryDiagNote, MemoryDiagRow } from './memory-diagnostics-parts.js';
import { desktopMetrics, type DesktopObservabilitySnapshot } from '../run-activity/diagnostic-metrics.js';
import { listWarmSnapshots } from '../session/session-warm-cache.js';
import { sessionRenderResources } from '../session/session-render-resources.js';
import { getMemoryObservabilitySnapshot } from './memory-observability.js';
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract.js';
import { globalMemoryGovernor } from './memory-governor.js';
import { collectReclaimCandidates } from './reclaim-candidates.js';
import { listReclaimEpisodes } from './reclaim-ledger.js';
import { isManualReclaimInFlight, requestManualReclaim } from './reclaim-wiring.js';
import {
  evaluateRendererRecoveryChecks,
  requestRendererRecovery,
  type RendererRecoveryDeps,
} from '../platform/renderer-recovery.js';
import {
  describeEpisodeOutcome,
  describeManualReclaimResult,
  describeRecoveryReason,
  formatBytes,
  governorLevelTone,
  sampleFreshness,
  type MemoryDiagnosticsPanelData,
} from './memory-diagnostics-format.js';

const DEFAULT_REFRESH_MS = 2_000;
const collectFrontendDefault = (): DesktopObservabilitySnapshot =>
  desktopMetrics.collectObservability();

export type MemoryDiagnosticsPanelProps = {
  /** Poll cadence; 0 disables the timer (still collects once on mount). */
  refreshMs?: number;
  /** Native snapshot reader — inject a fake in tests. Default Tauri invoke. */
  getNativeSnapshot?: () => Promise<NativeMemoryObservabilitySnapshot | null>;
  /** Renderer-side counters — inject a fake in tests. */
  collectFrontend?: () => DesktopObservabilitySnapshot;
  /** Extra deps merged into the recovery action (e.g. a stub `relaunch`). */
  recoveryDeps?: RendererRecoveryDeps;
};

export function MemoryDiagnosticsPanel(props: MemoryDiagnosticsPanelProps): ReactElement {
  const refreshMs = props.refreshMs ?? DEFAULT_REFRESH_MS;
  const [data, setData] = useState<MemoryDiagnosticsPanelData | null>(null);
  const [reclaimBusy, setReclaimBusy] = useState(false);
  const [reclaimResult, setReclaimResult] = useState<string | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<string | null>(null);
  const [episodeDetailOpen, setEpisodeDetailOpen] = useState(false);
  const [recoveryDetailOpen, setRecoveryDetailOpen] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    const getNative = props.getNativeSnapshot ?? getMemoryObservabilitySnapshot;
    const collectFrontend = props.collectFrontend ?? collectFrontendDefault;
    const [native, frontend] = await Promise.all([
      getNative().catch(() => null),
      Promise.resolve().then(collectFrontend).catch(() => null),
    ]);
    if (!mountedRef.current || frontend === null) return;
    const episodes = listReclaimEpisodes();
    setData({
      native,
      frontend,
      level: globalMemoryGovernor.getLevel(),
      episode: episodes[episodes.length - 1],
      presentations: sessionRenderResources.count(),
      visible: sessionRenderResources.visibleCount(),
      restoring: sessionRenderResources.restoringCount(),
      warmSnapshots: listWarmSnapshots().length,
      eligibleCandidates: collectReclaimCandidates().filter((candidate) =>
        Number.isFinite(candidate.protectionScore),
      ).length,
    });
  }, [props.getNativeSnapshot, props.collectFrontend]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = refreshMs > 0 ? setInterval(() => void refresh(), refreshMs) : null;
    return () => {
      mountedRef.current = false;
      if (timer !== null) clearInterval(timer);
    };
  }, [refresh, refreshMs]);

  // Re-evaluated on every data tick: checks reflect live run/draft state.
  const recoveryChecks = useMemo(
    () => evaluateRendererRecoveryChecks(props.recoveryDeps),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the poll
    [data],
  );
  const recoveryBlocker = recoveryChecks.find((check) => !check.ok);
  const manualBusy = reclaimBusy || isManualReclaimInFlight();

  const onReleaseIdle = useCallback((): void => {
    setReclaimBusy(true);
    setReclaimResult(null);
    void requestManualReclaim()
      .then((result) => {
        if (mountedRef.current) setReclaimResult(describeManualReclaimResult(result));
      })
      .catch(() => {
        if (mountedRef.current) setReclaimResult('Release failed.');
      })
      .finally(() => {
        if (mountedRef.current) setReclaimBusy(false);
        void refresh();
      });
  }, [refresh]);

  const onRestart = useCallback((): void => {
    const result = requestRendererRecovery(props.recoveryDeps);
    if (!result.allowed && mountedRef.current) {
      setRecoveryResult(describeRecoveryReason(result.reason));
    }
    // allowed: the relaunch is already running (or ran the injected stub).
  }, [props.recoveryDeps]);

  const sample = data?.native?.samples[data.native.samples.length - 1];
  const caches = Object.entries(data?.frontend.cacheEstimates ?? {}).filter(
    ([, estimate]) => estimate.entries > 0 || estimate.bytes > 0,
  );
  const episode = data?.episode;

  return (
    <div className="memory-diagnostics" data-testid="memory-diagnostics-panel">
      <Card testId="memory-diag-footprint" padding="sm">
        <MemoryDiagRow label="Footprint">
          {data === null
            ? '…'
            : data.native === null
              ? 'native sampling unavailable'
              : formatBytes(sample?.aggregateFootprintBytes ?? sample?.bytes)}
        </MemoryDiagRow>
        <MemoryDiagRow label="Sampling">
          {data === null || data.native === null
            ? '—'
            : sampleFreshness(sample?.timestampMs, Date.now())}
        </MemoryDiagRow>
        <MemoryDiagRow label="Governor level">
          <StatusBadge
            tone={data === null ? 'neutral' : governorLevelTone(data.level)}
            label={data?.level ?? '—'}
            testId="memory-diag-level"
          />
        </MemoryDiagRow>
      </Card>

      <Card testId="memory-diag-residency" padding="sm">
        <MemoryDiagRow label="Presentations">{data?.presentations ?? '—'}</MemoryDiagRow>
        <MemoryDiagRow label="Visible">{data?.visible ?? '—'}</MemoryDiagRow>
        <MemoryDiagRow label="Restoring">{data?.restoring ?? '—'}</MemoryDiagRow>
        <MemoryDiagRow label="Warm transcripts">{data?.warmSnapshots ?? '—'}</MemoryDiagRow>
        <MemoryDiagNote>Visible and restoring sessions are protected from release.</MemoryDiagNote>
      </Card>

      <Card testId="memory-diag-caches" padding="sm">
        {caches.length === 0 ? (
          <MemoryDiagNote>{data === null ? '…' : 'No cache entries retained.'}</MemoryDiagNote>
        ) : (
          caches.map(([name, estimate]) => (
            <MemoryDiagRow key={name} label={name}>
              {estimate.entries} · {formatBytes(estimate.bytes)}
            </MemoryDiagRow>
          ))
        )}
      </Card>

      <Card testId="memory-diag-last-action" padding="sm">
        {episode === undefined ? (
          <MemoryDiagNote>{data === null ? '…' : 'No reclaim episodes recorded.'}</MemoryDiagNote>
        ) : (
          <>
            <div data-testid="memory-diag-episode-summary">
              {describeEpisodeOutcome(episode)}
            </div>
            <MemoryDiagExpandable
              label="Technical detail"
              open={episodeDetailOpen}
              onToggle={() => setEpisodeDetailOpen((open) => !open)}
              testId="memory-diag-episode-detail"
            >
              outcome={episode.outcome ?? 'running'} · eligible={episode.eligibleCount ?? '—'} ·
              blocked={episode.blockedCount ?? '—'} · protected={episode.protectedCount ?? '—'}
              <br />
              started={new Date(episode.startedAtMs).toISOString()}
              {episode.endedAtMs !== undefined
                ? ` · ended=${new Date(episode.endedAtMs).toISOString()}`
                : ''}
              <br />
              before={formatBytes(episode.beforeBytes)} · after={formatBytes(episode.afterBytes)} ·
              sample={episode.lastSampleQuality ?? '—'}
            </MemoryDiagExpandable>
          </>
        )}
      </Card>

      <Card testId="memory-diag-actions" padding="sm">
        <div className="memory-diag-buttons">
          <Button
            variant="secondary"
            size="compact"
            data-testid="memory-diag-release-btn"
            disabled={data === null || manualBusy || data.eligibleCandidates === 0}
            onClick={onReleaseIdle}
          >
            Release idle resources
          </Button>
          <Button
            variant="secondary"
            size="compact"
            data-testid="memory-diag-restart-btn"
            disabled={data === null || recoveryBlocker !== undefined}
            onClick={onRestart}
          >
            Restart the workbench view
          </Button>
        </div>
        {data !== null && data.eligibleCandidates === 0 ? (
          <MemoryDiagNote>Nothing idle to release.</MemoryDiagNote>
        ) : null}
        {recoveryBlocker !== undefined ? (
          <MemoryDiagNote testId="memory-diag-restart-blocked">
            {describeRecoveryReason(recoveryBlocker.reason)}
          </MemoryDiagNote>
        ) : null}
        {reclaimResult !== null ? (
          <MemoryDiagNote muted={false} testId="memory-diag-reclaim-result">{reclaimResult}</MemoryDiagNote>
        ) : null}
        {recoveryResult !== null ? (
          <MemoryDiagNote muted={false} testId="memory-diag-recovery-result">{recoveryResult}</MemoryDiagNote>
        ) : null}
        <MemoryDiagExpandable
          label="Restart checks"
          open={recoveryDetailOpen}
          onToggle={() => setRecoveryDetailOpen((open) => !open)}
          testId="memory-diag-recovery-detail"
        >
          {recoveryChecks.map((check) => (
            <div key={check.id}>
              {check.ok ? '✓' : '✗'} {check.id}
              {check.reason !== undefined ? ` — ${check.reason}` : ''}
            </div>
          ))}
        </MemoryDiagExpandable>
      </Card>
    </div>
  );
}
