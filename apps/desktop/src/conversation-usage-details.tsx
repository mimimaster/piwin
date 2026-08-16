import type { ReactElement } from 'react';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import {
  buildConversationUsageDetailRows,
  conversationUsageEstimatedLabel,
  isHostEstimatedUsage,
  type ConversationUsageLocale,
} from './conversation-usage-copy.js';

export type ConversationUsageDetailsProps = {
  usage: ContextUsageSnapshot | null;
  used: number;
  limit: number;
  locale?: ConversationUsageLocale;
};

export function ConversationUsageDetails(
  props: ConversationUsageDetailsProps,
): ReactElement {
  const locale = props.locale ?? 'en';
  const rows = buildConversationUsageDetailRows({
    usage: props.usage,
    used: props.used,
    limit: props.limit,
    locale,
  });
  const estimated = isHostEstimatedUsage(props.usage);

  return (
    <div data-testid="conversation-usage-details">
      {estimated ? (
        <p className="muted" data-testid="conversation-usage-estimated">
          {conversationUsageEstimatedLabel(locale)}
        </p>
      ) : null}
      <ul className="context-usage-rows">
        {rows.map((row) => (
          <li key={row.id} data-testid={`conversation-usage-row-${row.id}`}>
            <span className="context-usage-row-label">{row.label}</span>
            <span className="context-usage-row-value muted">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
