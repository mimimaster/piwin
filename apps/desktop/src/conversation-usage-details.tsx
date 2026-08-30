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

export function ConversationUsageDetails(
  props: ConversationUsageDetailsProps,
): ReactElement {
  const locale = props.locale ?? 'en';
  const copy = getContextUsageCopy(locale);
  const occupancyRows = buildOccupancyDetailRows({
    ...(typeof props.view.tokensUsed === 'number' ? { used: props.view.tokensUsed } : {}),
    ...(typeof props.view.tokensLimit === 'number' ? { limit: props.view.tokensLimit } : {}),
    ...(typeof props.view.tokensUsed === 'number' &&
    typeof props.view.tokensLimit === 'number' &&
    props.view.tokensLimit >= props.view.tokensUsed
      ? { remaining: props.view.tokensLimit - props.view.tokensUsed }
      : {}),
    locale,
  });
  const lastRequestRows = buildLastRequestDetailRows({
    usage: props.view.lastRequest
      ? {
          measurementId: props.view.lastRequest.messageId,
          sessionId: 'last-request',
          messageId: props.view.lastRequest.messageId,
          totalTokens: props.view.lastRequest.totalTokens ?? 0,
          recordedAt: '1970-01-01T00:00:00.000Z',
          ...(typeof props.view.lastRequest.promptTokens === 'number'
            ? { promptTokens: props.view.lastRequest.promptTokens }
            : {}),
          ...(typeof props.view.lastRequest.cacheReadTokens === 'number'
            ? { cacheReadTokens: props.view.lastRequest.cacheReadTokens }
            : {}),
          ...(typeof props.view.lastRequest.cacheWriteTokens === 'number'
            ? { cacheWriteTokens: props.view.lastRequest.cacheWriteTokens }
            : {}),
          ...(typeof props.view.lastRequest.completionTokens === 'number'
            ? { completionTokens: props.view.lastRequest.completionTokens }
            : {}),
          ...(typeof props.view.lastRequest.durationMs === 'number'
            ? { durationMs: props.view.lastRequest.durationMs }
            : {}),
        }
      : null,
    locale,
  });

  return (
    <div data-testid="conversation-usage-details">
      {props.view.capabilityMissing ? (
        <p className="muted" data-testid="conversation-usage-capability-missing">
          {copy.capabilityMissing}
        </p>
      ) : null}
      {props.view.quality === 'estimated' ? (
        <p className="muted" data-testid="conversation-usage-estimated">
          {copy.estimated}
        </p>
      ) : props.view.quality === 'measured' ? (
        <p className="muted" data-testid="conversation-usage-confirmed">
          {copy.confirmed}
        </p>
      ) : null}
      {!props.view.numericHidden ? (
        <ul className="context-usage-rows">
          {occupancyRows.map((row) => (
            <li key={row.id} data-testid={`conversation-usage-row-${row.id}`}>
              <span className="context-usage-row-label">{row.label}</span>
              <span className="context-usage-row-value muted">{row.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {lastRequestRows.length > 0 ? (
        <>
          <p className="muted">{copy.lastRequest}</p>
          <ul className="context-usage-rows" data-testid="conversation-usage-last-request">
            {lastRequestRows.map((row) => (
              <li key={row.id} data-testid={`conversation-usage-row-${row.id}`}>
                <span className="context-usage-row-label">{row.label}</span>
                <span className="context-usage-row-value muted">{row.value}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
