import type { ReactElement } from 'react';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import type { RendererRecoveryCheck } from '../platform/renderer-recovery.js';
import { MemoryDiagNote, MemoryDiagRow } from './memory-diagnostics-parts.js';
import {
  describeEpisodeOutcome,
  describeVisualDegradationPolicy,
  formatBytes,
  type MemoryDiagnosticsPanelData,
} from './memory-diagnostics-format.js';
import { memoryDiagnosticsCopy } from './memory-diagnostics-copy.js';

export function MemoryDiagnosticsDetails(props: {
  data: MemoryDiagnosticsPanelData | null;
  checks: RendererRecoveryCheck[];
  locale: DesktopLocale;
}): ReactElement {
  const { data, locale } = props;
  const copy = memoryDiagnosticsCopy(locale);
  const sample = data?.native?.samples.at(-1);
  const episode = data?.episode;
  const time = sample?.timestampMs === undefined ? undefined : new Date(sample.timestampMs);
  const motionPolicy = describeVisualDegradationPolicy(data, locale);
  return (
    <div className="memory-diag-technical">
      <section>
        <h3>{copy.native}</h3>
        <MemoryDiagRow label={copy.level}>{data?.level ?? '—'}</MemoryDiagRow>
        <MemoryDiagRow label={copy.sampleId}>{sample?.sampleId ?? '—'}</MemoryDiagRow>
        <MemoryDiagRow label={copy.sampleTime}>
          {time !== undefined && Number.isFinite(time.getTime()) ? time.toISOString() : '—'}
        </MemoryDiagRow>
        <MemoryDiagRow label={copy.pending}>{data?.native?.pendingSampleId ?? '—'}</MemoryDiagRow>
        <MemoryDiagRow label={copy.stalls}>{data?.native?.stalledTicks ?? '—'}</MemoryDiagRow>
        {sample?.processes?.map((process, index) => (
          <MemoryDiagRow key={`${process.windowLabel}:${index}`} label={process.windowLabel}>
            {formatBytes(process.footprintBytes)}{process.pid === undefined ? '' : ` · PID ${process.pid}`}
          </MemoryDiagRow>
        ))}
      </section>
      {episode === undefined ? null : (
        <section data-testid="memory-diag-episode-detail">
          <h3>{copy.recent}{copy.recentEn ? ` ${copy.recentEn}` : ''}</h3>
          <MemoryDiagRow label={copy.outcome}>{episode.outcome ?? 'running'}</MemoryDiagRow>
          <MemoryDiagRow label={copy.eligible}>{episode.eligibleCount ?? '—'}</MemoryDiagRow>
          <MemoryDiagRow label={copy.protected}>{episode.protectedCount ?? '—'}</MemoryDiagRow>
          <MemoryDiagRow label={copy.blocked}>{episode.blockedCount ?? '—'}</MemoryDiagRow>
          <MemoryDiagNote>{describeEpisodeOutcome(episode, locale)}</MemoryDiagNote>
          <MemoryDiagNote>{copy.estimateHint}</MemoryDiagNote>
        </section>
      )}
      <section data-testid="memory-diag-motion-policy">
        <h3>{copy.motionSection}</h3>
        {motionPolicy.map((entry) => (
          <MemoryDiagRow
            key={entry.id}
            label={entry.label}
            testId={`memory-diag-policy-${entry.id}`}
          >
            {entry.status}
          </MemoryDiagRow>
        ))}
        <MemoryDiagNote>{copy.motionPolicyNote}</MemoryDiagNote>
      </section>
      <section data-testid="memory-diag-recovery-detail">
        <h3>{copy.checks}</h3>
        {props.checks.map((check) => (
          <MemoryDiagRow key={check.id} label={copy.checkNames[check.id]}>
            {check.ok ? '✓' : '—'}{check.reason === undefined ? '' : ` · ${check.reason}`}
          </MemoryDiagRow>
        ))}
      </section>
    </div>
  );
}
