/**
 * Context ring popover body: occupancy dial + ledger, one status line, and the
 * last request's measured token split. Renders selector output only.
 */
import type { ReactElement } from 'react';
import type { ContextRingViewModel } from './context-telemetry-selector.js';
import {
  buildLastRequestDetailRows,
  buildOccupancyDetailRows,
  getContextUsageCopy,
  type ConversationUsageLocale,
} from './conversation-usage-copy.js';

export type ConversationUsageDetailsProps = {
  view: ContextRingViewModel;
  locale?: ConversationUsageLocale;
};

export type ContextUsageTone = 'ok' | 'warn' | 'critical';

export function contextUsageTone(percentText: number | undefined): ContextUsageTone {
  const percent = percentText ?? 0;
  return percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'ok';
}

type UsageStatusState = 'measured' | 'estimated' | 'working' | 'pending';

const DIAL_RADIUS = 27;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;

/** Last-request rows that are measured parts of the total, drawn in the bar. */
const REQUEST_SEGMENT_IDS = new Set(['input', 'cache-read', 'cache-write', 'output']);

function usageStatusState(view: ContextRingViewModel): UsageStatusState {
  if (view.compacting) {
    return 'working';
  }
  if (view.offline || view.numericHidden || view.occupancySource === 'last-confirmed') {
    return 'pending';
  }
  return view.quality === 'measured' ? 'measured' : 'estimated';
}

function qualityTestId(view: ContextRingViewModel): string | undefined {
  if (view.occupancySource === 'last-confirmed') {
    return 'conversation-usage-last-confirmed';
  }
  if (view.quality === 'estimated') {
    return 'conversation-usage-estimated';
  }
  if (view.quality === 'measured') {
    return 'conversation-usage-confirmed';
  }
  return undefined;
}

function UsageDial(props: { arcRatio: number; percentText: number | undefined }): ReactElement {
  return (
    <div className="context-usage-dial">
      <svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true">
        <circle
          className="context-usage-dial-track"
          cx="32"
          cy="32"
          r={DIAL_RADIUS}
          fill="none"
          strokeWidth="4"
        />
        {props.arcRatio > 0 ? (
          <circle
            className="context-usage-dial-progress"
            cx="32"
            cy="32"
            r={DIAL_RADIUS}
            fill="none"
            strokeWidth="4"
            strokeDasharray={DIAL_CIRCUMFERENCE}
            strokeDashoffset={DIAL_CIRCUMFERENCE * (1 - props.arcRatio)}
            strokeLinecap="round"
            transform="rotate(-90 32 32)"
          />
        ) : null}
      </svg>
      <span className="context-usage-dial-value">
        {props.percentText === undefined ? (
          '—'
        ) : (
          <>
            {props.percentText}
            <small>%</small>
          </>
        )}
      </span>
    </div>
  );
}

export function ConversationUsageDetails(
  props: ConversationUsageDetailsProps,
): ReactElement {
  const { view } = props;
  const locale = props.locale ?? view.locale;
  const copy = getContextUsageCopy(locale);
  const occupancyRows = buildOccupancyDetailRows({
    ...(typeof view.tokensUsed === 'number' ? { used: view.tokensUsed } : {}),
    ...(typeof view.tokensLimit === 'number' ? { limit: view.tokensLimit } : {}),
    ...(typeof view.tokensUsed === 'number' &&
    typeof view.tokensLimit === 'number' &&
    view.tokensLimit >= view.tokensUsed
      ? { remaining: view.tokensLimit - view.tokensUsed }
      : {}),
    locale,
  });
  const request = view.lastRequest;
  const lastRequestRows = buildLastRequestDetailRows({
    usage: request
      ? {
          measurementId: request.messageId,
          sessionId: 'last-request',
          messageId: request.messageId,
          totalTokens: request.totalTokens ?? 0,
          recordedAt: '1970-01-01T00:00:00.000Z',
          ...(typeof request.promptTokens === 'number'
            ? { promptTokens: request.promptTokens }
            : {}),
          ...(typeof request.cacheReadTokens === 'number'
            ? { cacheReadTokens: request.cacheReadTokens }
            : {}),
          ...(typeof request.cacheWriteTokens === 'number'
            ? { cacheWriteTokens: request.cacheWriteTokens }
            : {}),
          ...(typeof request.completionTokens === 'number'
            ? { completionTokens: request.completionTokens }
            : {}),
          ...(typeof request.durationMs === 'number' ? { durationMs: request.durationMs } : {}),
        }
      : null,
    locale,
  });
  const requestSegments = request
    ? [
        { id: 'input', value: request.promptTokens ?? 0 },
        { id: 'cache-read', value: request.cacheReadTokens ?? 0 },
        { id: 'cache-write', value: request.cacheWriteTokens ?? 0 },
        { id: 'output', value: request.completionTokens ?? 0 },
      ].filter((segment) => segment.value > 0)
    : [];
  const { status, limitNote } = view.labels;

  return (
    <div className="context-usage-details" data-testid="conversation-usage-details">
      {view.capabilityMissing ? (
        <p className="context-usage-note" data-testid="conversation-usage-capability-missing">
          {copy.capabilityMissing}
        </p>
      ) : null}
      {!view.numericHidden ? (
        <section className={`context-usage-overview tone-${contextUsageTone(view.percentText)}`}>
          <UsageDial arcRatio={view.arcRatio} percentText={view.percentText} />
          <ul className="context-usage-rows">
            {occupancyRows.map((row) => (
              <li key={row.id} data-row={row.id} data-testid={`conversation-usage-row-${row.id}`}>
                <span className="context-usage-row-label">{row.label}</span>
                <span className="context-usage-row-value">{row.value}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {status || limitNote ? (
        <p
          className="context-usage-status"
          data-state={usageStatusState(view)}
          data-testid="context-usage-status"
        >
          <i className="context-usage-status-dot" aria-hidden="true" />
          {status ? <span data-testid={qualityTestId(view)}>{status}</span> : null}
          {limitNote ? (
            <span className="context-usage-status-note" data-testid="context-usage-limit-note">
              {limitNote}
            </span>
          ) : null}
        </p>
      ) : null}
      {view.exceedsLimit ? (
        <p className="context-usage-alert" data-testid="context-usage-exceeds">
          {view.labels.exceeds}
        </p>
      ) : null}
      {lastRequestRows.length > 0 ? (
        <section className="context-usage-request" data-testid="conversation-usage-last-request">
          <p className="context-usage-request-title">{copy.lastRequest}</p>
          {requestSegments.length > 0 ? (
            <div className="context-usage-request-bar" aria-hidden="true">
              {requestSegments.map((segment) => (
                <span key={segment.id} data-tone={segment.id} style={{ flexGrow: segment.value }} />
              ))}
            </div>
          ) : null}
          <ul className="context-usage-rows">
            {lastRequestRows.map((row) => (
              <li key={row.id} data-row={row.id} data-testid={`conversation-usage-row-${row.id}`}>
                <span className="context-usage-row-label">
                  <i
                    className="context-usage-row-swatch"
                    data-tone={REQUEST_SEGMENT_IDS.has(row.id) ? row.id : undefined}
                    aria-hidden="true"
                  />
                  {row.label}
                </span>
                <span className="context-usage-row-value">{row.value}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
