import type { StatusTone } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { mainFootprintBytes } from './memory-sample-contract.js';
import { governorLevelTone, sampleFreshness, type MemoryDiagnosticsPanelData } from './memory-diagnostics-format.js';
import { memoryDiagnosticsCopy } from './memory-diagnostics-copy.js';

/** Unknown/stale readings must never look like healthy zero-byte usage. */
export function createMemoryDiagnosticsReport(
  data: MemoryDiagnosticsPanelData | null, locale: DesktopLocale, nowMs: number,
) {
  const copy = memoryDiagnosticsCopy(locale);
  const sample = data?.native?.samples.at(-1);
  const mainBytes = sample === undefined ? undefined : mainFootprintBytes(sample);
  const freshness = sampleFreshness(sample?.timestampMs, nowMs);
  const condition = data === null ? 'loading' : mainBytes === undefined ? 'unavailable'
    : freshness !== 'fresh' ? 'stale' : data.level;
  const tone: StatusTone = condition === 'normal' || condition === 'moderate' || condition === 'critical'
    ? governorLevelTone(condition) : condition === 'stale' ? 'warning' : 'neutral';
  const explanation = condition === 'moderate' || condition === 'critical'
    ? data !== null && data.eligibleCandidates > 0 ? copy.explanation.available
      : data !== null && (data.visible > 0 || data.restoring > 0) ? copy.explanation.protected
        : copy.explanation.empty
    : copy.explanation[condition];
  return {
    sample,
    mainBytes,
    aggregateBytes: sample?.aggregateFootprintBytes,
    condition,
    tone,
    governorTone: data === null ? 'neutral' : governorLevelTone(data.level),
    governorLevel: data?.level ?? '—',
    status: copy.status[condition],
    explanation,
    sampling: copy.sampling[freshness],
    freshness,
  };
}
