/** Concise bilingual memory report; collection and guarded actions live in the hook. */
import { useState, type ReactElement } from 'react';
import { Button, Card, StatusBadge } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { MemoryDiagnosticsDetails } from './MemoryDiagnosticsDetails.js';
import { MemoryInspectionControls } from './MemoryInspectionControls.js';
import { MemoryDiagExpandable, MemoryDiagNote, MemoryDiagRow } from './memory-diagnostics-parts.js';
import {
  describeManualReclaimResult,
  describeRecoveryReason,
  formatBytes,
  getLiveStatusAnimationCount,
} from './memory-diagnostics-format.js';
import { memoryDiagnosticsCopy } from './memory-diagnostics-copy.js';
import { createMemoryDiagnosticsReport } from './memory-diagnostics-report.js';
import { useMemoryDiagnostics, type MemoryDiagnosticsOptions } from './use-memory-diagnostics.js';

export type MemoryDiagnosticsPanelProps = MemoryDiagnosticsOptions & { locale?: DesktopLocale };

export function MemoryDiagnosticsPanel(props: MemoryDiagnosticsPanelProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const copy = memoryDiagnosticsCopy(locale);
  const state = useMemoryDiagnostics(props);
  const { data, recoveryBlocker } = state;
  const report = createMemoryDiagnosticsReport(data, locale, Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const episode = data?.episode;
  const outcome = episode?.outcome;
  const comparable =
    episode?.beforeBytes !== undefined &&
    episode.afterBytes !== undefined &&
    Number.isFinite(episode.beforeBytes) &&
    Number.isFinite(episode.afterBytes);
  const delta = comparable ? (episode?.beforeBytes ?? 0) - (episode?.afterBytes ?? 0) : undefined;
  const caches = Object.entries(data?.frontend.cacheEstimates ?? {}).filter(
    ([, estimate]) => estimate.entries > 0 || estimate.bytes > 0,
  );
  const liveMotionCount = getLiveStatusAnimationCount(data);
  const parked = data?.parked === true;

  return (
    <div className="memory-diagnostics" data-testid="memory-diagnostics-panel" data-condition={report.condition}>
      <Card className="memory-diag-overview" testId="memory-diag-footprint" padding="sm" radius="lg">
        <div className="memory-diag-overview-top">
          <span className="memory-diag-eyebrow">
            {copy.mainUsage}
            {copy.mainUsageEn ? <span className="memory-diag-en">{copy.mainUsageEn}</span> : null}
          </span>
          <StatusBadge tone={report.tone} label={report.status} testId="memory-diag-level" />
        </div>

        <div className="memory-diag-value-row">
          <div className="memory-diag-number" data-testid="memory-diag-main-bytes">
            {formatBytes(report.mainBytes)}
          </div>
          {report.aggregateBytes !== undefined && report.aggregateBytes !== report.mainBytes ? (
            <span className="memory-diag-aggregate">
              {copy.allWindows} {formatBytes(report.aggregateBytes)}
            </span>
          ) : null}
        </div>

        <div className="memory-diag-meta-grid">
          <div className="memory-diag-meta-cell">
            <span>{copy.samplingLabel}</span>
            <strong data-freshness={report.freshness}>{report.sampling}</strong>
          </div>
          <div className="memory-diag-meta-cell">
            <span>{copy.governorLabel}</span>
            <strong className={`memory-diag-gov tone-${report.governorTone}`} data-testid="memory-diag-governor">
              <i className="memory-diag-gov-dot" aria-hidden />
              {report.governorLevel}
            </strong>
          </div>
        </div>

        <p className="memory-diag-explanation" data-testid="memory-diag-explanation">
          {report.explanation}
        </p>
      </Card>

      <Card className="memory-diag-section" testId="memory-diag-residency" padding="sm" radius="lg">
        <div className="memory-diag-card-head">
          <h3>
            {copy.resources}
            {copy.resourcesEn ? <span className="memory-diag-en">{copy.resourcesEn}</span> : null}
          </h3>
          <span className="memory-diag-head-meta">{copy.presentations(data?.presentations ?? '—')}</span>
        </div>
        <dl className="memory-diag-counters">
          <div><dt>{copy.visible}</dt><dd>{data?.visible ?? '—'}</dd></div>
          <div><dt>{copy.restoring}</dt><dd>{data?.restoring ?? '—'}</dd></div>
          <div><dt>{copy.warm}</dt><dd>{data?.warmSnapshots ?? '—'}</dd></div>
        </dl>
        <div className="memory-diag-caches" data-testid="memory-diag-caches">
          <MemoryDiagRow label={copy.motionLiveLabel} testId="memory-diag-live-motion">
            {copy.motionLiveSummary(liveMotionCount, parked)}
          </MemoryDiagRow>
          {caches.length === 0 ? (
            <MemoryDiagNote>{data === null ? copy.explanation.loading : copy.noCachesCompact}</MemoryDiagNote>
          ) : (
            <>
              {caches.map(([name, estimate]) => (
                <MemoryDiagRow key={name} label={copy.cacheNames[name] ?? copy.otherCache}>
                  {copy.cacheEntries(estimate.entries)}
                  {estimate.bytes > 0 ? ` · ${formatBytes(estimate.bytes)}` : ''}
                </MemoryDiagRow>
              ))}
              <MemoryDiagNote>{copy.protectedNote}</MemoryDiagNote>
            </>
          )}
        </div>
      </Card>

      <Card className="memory-diag-section" testId="memory-diag-last-action" padding="sm" radius="lg">
        {episode === undefined ? (
          <div className="memory-diag-card-head">
            <h3>
              {copy.recent}
              {copy.recentEn ? <span className="memory-diag-en">{copy.recentEn}</span> : null}
            </h3>
            <span className="memory-diag-inline-empty" data-testid="memory-diag-episode-summary">
              {copy.noEpisode}
            </span>
          </div>
        ) : (
          <>
            <div className="memory-diag-card-head">
              <h3>
                {copy.recent}
                {copy.recentEn ? <span className="memory-diag-en">{copy.recentEn}</span> : null}
              </h3>
              <code className="memory-diag-code-tag">{outcome ?? 'running'}</code>
            </div>
            <div className="memory-diag-result" data-testid="memory-diag-episode-summary">
              {outcome === undefined ? copy.running : copy.outcomes[outcome]}
            </div>
            {comparable ? (
              <div className="memory-diag-comparison" data-testid="memory-diag-comparison">
                <span>
                  {formatBytes(episode.beforeBytes)}{' '}
                  <span className="memory-diag-comparison-arrow" aria-hidden>→</span>{' '}
                  {formatBytes(episode.afterBytes)}
                </span>
                <strong data-delta={(delta ?? 0) > 0 ? 'drop' : (delta ?? 0) < 0 ? 'rise' : 'flat'}>
                  {delta === 0
                    ? copy.unchanged
                    : `${(delta ?? 0) > 0 ? copy.measuredDrop : copy.measuredRise}${formatBytes(Math.abs(delta ?? 0))}`}
                </strong>
              </div>
            ) : outcome === undefined || outcome === 'protected-over-budget' ? null : (
              <MemoryDiagNote>{copy.noComparison}</MemoryDiagNote>
            )}
          </>
        )}
      </Card>

      <Card className="memory-diag-section" testId="memory-diag-actions" padding="sm" radius="lg">
        <div className="memory-diag-card-head">
          <h3>
            {copy.actions}
            {copy.actionsEn ? <span className="memory-diag-en">{copy.actionsEn}</span> : null}
          </h3>
        </div>
        <div className="memory-diag-action-grid">
          <Button
            variant="secondary"
            size="compact"
            data-testid="memory-diag-release-btn"
            disabled={data === null || state.manualBusy || data.eligibleCandidates === 0}
            onClick={state.onReleaseIdle}
          >
            {state.manualBusy ? copy.releasing : copy.release}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            data-testid="memory-diag-restart-btn"
            disabled={data === null || recoveryBlocker !== undefined}
            onClick={state.onRestart}
          >
            {copy.restart}
          </Button>
        </div>
        <div className="memory-diag-action-notes">
          {state.reclaimResult === null ? (
            data !== null && data.eligibleCandidates === 0 ? (
              <MemoryDiagNote>{copy.noIdle}</MemoryDiagNote>
            ) : null
          ) : (
            <MemoryDiagNote muted={false} testId="memory-diag-reclaim-result">
              {state.reclaimResult === 'failed'
                ? copy.releaseFailed
                : describeManualReclaimResult(state.reclaimResult, locale)}
            </MemoryDiagNote>
          )}
          <MemoryDiagNote testId="memory-diag-restart-blocked">
            {recoveryBlocker === undefined
              ? copy.restartHint
              : describeRecoveryReason(recoveryBlocker.reason, locale)}
          </MemoryDiagNote>
          {state.recoveryResult === null ? null : (
            <MemoryDiagNote muted={false} testId="memory-diag-recovery-result">
              {describeRecoveryReason(state.recoveryResult.reason, locale)}
            </MemoryDiagNote>
          )}
        </div>
      </Card>

      <MemoryInspectionControls locale={locale} />

      <div className="memory-diag-footer">
        <MemoryDiagExpandable
          label={copy.details}
          open={detailsOpen}
          onToggle={() => setDetailsOpen((open) => !open)}
          testId="memory-diag-technical-detail"
        >
          <MemoryDiagnosticsDetails data={data} checks={state.recoveryChecks} locale={locale} />
        </MemoryDiagExpandable>
        <p className="memory-diag-scope">{copy.scope}</p>
      </div>
    </div>
  );
}
