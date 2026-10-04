/**
 * One muted row under the composer card: Pi extension status on the left,
 * session stats (turns · steps · tok/s · tokens · cache) on the right (ADR 0080).
 * An inert empty slot stays hidden in single-pane mode; split panes reserve its
 * height so usage loading or extension updates cannot shift the input baseline.
 */
import { Fragment, type ReactElement } from 'react';
import {
  buildComposerStatsSegments,
  type ComposerStatsLineInput,
  type ComposerStatsSegment,
} from './composer-stats-line-model';

export function ComposerStatsLine(props: ComposerStatsLineInput): ReactElement {
  const segments = buildComposerStatsSegments(props);
  if (segments.length === 0) {
    return <div className="composer-stats-line is-empty" aria-hidden="true" />;
  }

  const extensionSegments = segments.filter(
    (segment): segment is Extract<ComposerStatsSegment, { kind: 'extension' }> =>
      segment.kind === 'extension',
  );
  const metricSegments = segments.filter(
    (segment): segment is Extract<ComposerStatsSegment, { kind: 'activity' | 'tokens' }> =>
      segment.kind !== 'extension',
  );

  return (
    <div className="composer-stats-line" role="status" data-testid="composer-stats-line">
      {extensionSegments.length > 0 ? (
        <div className="composer-stats-extensions" data-testid="composer-stats-extensions">
          {extensionSegments.map((segment) => (
            <span
              key={segment.key}
              className="composer-stats-item is-extension"
              data-status-key={segment.key}
              title={segment.text}
            >
              {segment.working ? (
                <span className="composer-stats-pulse-dot" aria-hidden />
              ) : null}
              {segment.text}
            </span>
          ))}
        </div>
      ) : null}

      {metricSegments.length > 0 ? (
        <div className="composer-stats-metrics" data-testid="composer-stats-metrics">
          {metricSegments.map((segment, index) => (
            <Fragment key={segment.kind}>
              {index > 0 ? (
                <span className="composer-stats-separator" aria-hidden>
                  ·
                </span>
              ) : null}
              <span
                className="composer-stats-item"
                title={`${segment.text}\n${segment.title}`}
                data-testid={`composer-stats-${segment.kind}`}
              >
                {segment.text}
              </span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
