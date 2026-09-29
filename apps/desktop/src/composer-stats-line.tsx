/**
 * One centered line under the composer card: session stats first, then Pi
 * extension status (ADR 0080). Renders nothing when there is nothing to say,
 * so an empty session keeps the composer flush.
 */
import type { ReactElement } from 'react';
import { IconActivity, IconChartBar } from './shell-icons';
import {
  buildComposerStatsSegments,
  type ComposerStatsLineInput,
} from './composer-stats-line-model';

export function ComposerStatsLine(props: ComposerStatsLineInput): ReactElement | null {
  const segments = buildComposerStatsSegments(props);
  if (segments.length === 0) return null;
  return (
    <div className="composer-stats-line" role="status" data-testid="composer-stats-line">
      {segments.map((segment) => {
        if (segment.kind === 'extension') {
          return (
            <span
              key={`ext:${segment.key}`}
              className={`composer-stats-item is-extension${segment.working ? ' is-working' : ''}`}
              data-status-key={segment.key}
            >
              {segment.text}
            </span>
          );
        }
        const Icon = segment.kind === 'activity' ? IconActivity : IconChartBar;
        return (
          <span
            key={segment.kind}
            className="composer-stats-item"
            title={segment.title}
            data-testid={`composer-stats-${segment.kind}`}
          >
            <Icon width={12} height={12} aria-hidden />
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}
