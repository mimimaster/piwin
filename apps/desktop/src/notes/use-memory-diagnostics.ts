import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopMetrics, type DesktopObservabilitySnapshot } from '../run-activity/diagnostic-metrics.js';
import { listWarmSnapshots } from '../session/session-warm-cache.js';
import { sessionRenderResources } from '../session/session-render-resources.js';
import {
  evaluateRendererRecoveryChecks, requestRendererRecovery,
  type RendererRecoveryDeps, type RendererRecoveryResult,
} from '../platform/renderer-recovery.js';
import { collectReclaimCandidates } from './reclaim-candidates.js';
import { listReclaimEpisodes } from './reclaim-ledger.js';
import { getMemoryObservabilitySnapshot } from './memory-observability.js';
import { globalMemoryGovernor } from './memory-governor.js';
import { globalReclaimCoordinator, isManualReclaimInFlight, requestManualReclaim,
  type ManualReclaimResult } from './reclaim-wiring.js';
import type { NativeMemoryObservabilitySnapshot } from './memory-sample-contract.js';
import type { MemoryDiagnosticsPanelData } from './memory-diagnostics-format.js';

export type MemoryDiagnosticsOptions = {
  /** Zero collects once without polling. */
  refreshMs?: number;
  getNativeSnapshot?: () => Promise<NativeMemoryObservabilitySnapshot | null>;
  collectFrontend?: () => DesktopObservabilitySnapshot;
  recoveryDeps?: RendererRecoveryDeps;
};

const collectFrontendDefault = (): DesktopObservabilitySnapshot => desktopMetrics.collectObservability();

/** Keep collection and guarded actions independent of report layout and language. */
export function useMemoryDiagnostics(options: MemoryDiagnosticsOptions) {
  const [data, setData] = useState<MemoryDiagnosticsPanelData | null>(null);
  const [reclaimBusy, setReclaimBusy] = useState(false);
  const [reclaimResult, setReclaimResult] = useState<ManualReclaimResult | 'failed' | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<RendererRecoveryResult | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async (): Promise<void> => {
    const [native, frontend] = await Promise.all([
      (options.getNativeSnapshot ?? getMemoryObservabilitySnapshot)().catch(() => null),
      Promise.resolve().then(options.collectFrontend ?? collectFrontendDefault).catch(() => null),
    ]);
    if (!mounted.current || frontend === null) return;
    setData({ native, frontend, level: globalMemoryGovernor.getLevel(),
      episode: globalReclaimCoordinator.getCurrentEpisode() ?? listReclaimEpisodes().at(-1),
      presentations: sessionRenderResources.count(), visible: sessionRenderResources.visibleCount(),
      restoring: sessionRenderResources.restoringCount(), warmSnapshots: listWarmSnapshots().length,
      eligibleCandidates: collectReclaimCandidates().filter((item) => Number.isFinite(item.protectionScore)).length,
    });
  }, [options.getNativeSnapshot, options.collectFrontend]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = options.refreshMs ?? 2_000;
    const timer = interval > 0 ? setInterval(() => { void refresh(); }, interval) : null;
    return () => {
      mounted.current = false;
      if (timer !== null) clearInterval(timer);
    };
  }, [refresh, options.refreshMs]);

  const recoveryChecks = evaluateRendererRecoveryChecks(options.recoveryDeps);
  const onReleaseIdle = useCallback((): void => {
    setReclaimBusy(true);
    setReclaimResult(null);
    void requestManualReclaim().then((result) => {
      if (mounted.current) setReclaimResult(result);
    }).catch((error: unknown) => {
      console.warn('[memory-diagnostics] manual release failed:', error);
      if (mounted.current) setReclaimResult('failed');
    }).finally(() => {
      if (mounted.current) setReclaimBusy(false);
      void refresh();
    });
  }, [refresh]);
  const onRestart = useCallback((): void => {
    const result = requestRendererRecovery(options.recoveryDeps);
    if (!result.allowed && mounted.current) setRecoveryResult(result);
  }, [options.recoveryDeps]);

  return { data, recoveryChecks, recoveryBlocker: recoveryChecks.find((check) => !check.ok),
    manualBusy: reclaimBusy || isManualReclaimInFlight(), reclaimResult, recoveryResult,
    onReleaseIdle, onRestart };
}
