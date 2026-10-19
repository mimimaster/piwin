/**
 * The status bar under the composer card, three sections: Pi extension status
 * │ this turn (elapsed · first token · speed) │ resources (context bar ·
 * turns · tokens · cache · cost). Container queries hide lower-priority items as the
 * pane narrows; the context bar always stays and opens the usage popover.
 * An inert empty slot stays hidden in single-pane mode; split panes reserve its
 * height so usage loading or extension updates cannot shift the input baseline.
 */
import { Fragment, useEffect, useState, type ReactElement } from 'react';
import {
  buildComposerStatusBar,
  type ComposerStatsLineInput,
  type ComposerStatusItem,
} from './composer-stats-line-model';
import type { ContextRingViewModel } from './context-telemetry-selector.js';
import { ContextUsageRing } from './context-usage-ring';

/** Seconds since the turn started, ticking once a second while it runs. */
function useRunningElapsed(isRunning: boolean): number | undefined {
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) {
      setStartedAt(undefined);
      return;
    }
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);
  return startedAt === undefined ? undefined : Math.max(0, now - startedAt);
}

function StatusItems(props: { items: ComposerStatusItem[] }): ReactElement {
  return (
    <>
      {props.items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? (
            <span className={`composer-stats-separator priority-${item.priority}`} aria-hidden>
              ·
            </span>
          ) : null}
          <span
            className={`composer-stats-item priority-${item.priority}${item.tone ? ` tone-${item.tone}` : ''}${item.running ? ' is-running' : ''}`}
            title={item.title}
            data-testid={`composer-stats-${item.key}`}
          >
            {item.running ? <span className="composer-stats-pulse-dot" aria-hidden /> : null}
            {item.label ? <span className="composer-stats-label">{item.label}</span> : null}
            <span className="composer-stats-value">{item.text}</span>
          </span>
        </Fragment>
      ))}
    </>
  );
}

export type ComposerStatsLineProps = Omit<ComposerStatsLineInput, 'runningElapsedMs'> & {
  contextView?: ContextRingViewModel | undefined;
  isRunning?: boolean | undefined;
  onOpenModelSettings?: (() => void) | undefined;
};

export function ComposerStatsLine(props: ComposerStatsLineProps): ReactElement {
  const runningElapsedMs = useRunningElapsed(props.isRunning === true);
  const bar = buildComposerStatusBar({ ...props, runningElapsedMs });
  const context = props.contextView?.visible ? props.contextView : undefined;
  if (bar.extensions.length === 0 && bar.turn.length === 0 && bar.resources.length === 0 && !context) {
    return <div className="composer-stats-line is-empty" aria-hidden="true" />;
  }

  return (
    <div className="composer-stats-line" role="status" data-testid="composer-stats-line">
      <div className="composer-stats-extensions" data-testid="composer-stats-extensions">
        {bar.extensions.map((segment) => (
          <span
            key={segment.key}
            className="composer-stats-item is-extension"
            data-status-key={segment.key}
            title={segment.text}
          >
            {segment.working ? <span className="composer-stats-pulse-dot" aria-hidden /> : null}
            {segment.text}
          </span>
        ))}
      </div>
      {bar.turn.length > 0 ? (
        <div className="composer-stats-turn" data-testid="composer-stats-turn">
          <StatusItems items={bar.turn} />
        </div>
      ) : null}
      {bar.resources.length > 0 || context ? (
        <div className="composer-stats-resources" data-testid="composer-stats-resources">
          {context ? (
            <ContextUsageRing
              view={context}
              variant="bar"
              {...(props.onOpenModelSettings ? { onOpenModelSettings: props.onOpenModelSettings } : {})}
            />
          ) : null}
          {context && bar.resources.length > 0 ? (
            <span className={`composer-stats-separator priority-${bar.resources[0]?.priority ?? 3}`} aria-hidden>
              ·
            </span>
          ) : null}
          <StatusItems items={bar.resources} />
        </div>
      ) : null}
    </div>
  );
}
