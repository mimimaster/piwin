/**
 * Phone composer: context usage as the small ring in the toolbar instead of a
 * status row under the card. The counters the row would show (this turn, the
 * session totals) move into the ring's popover, so nothing is lost and the
 * transcript keeps that line.
 */
import type { ReactElement } from 'react';
import { ContextUsageRing } from '../context/context-usage-ring';
import {
  buildComposerStatusBar,
  type ComposerStatusItem,
  type ComposerStatusItemKey,
} from './composer-stats-line-model';
import { useRunningElapsed, type ComposerStatsLineProps } from './composer-stats-line';

const ROW_LABELS: Record<'zh' | 'en', Record<ComposerStatusItemKey, string>> = {
  zh: {
    elapsed: '用时',
    ttft: '首字',
    tps: '生成速度',
    turns: '轮数',
    tokens: '累计 tokens',
    cache: '缓存命中',
    cost: '估算费用',
  },
  en: {
    elapsed: 'Time',
    ttft: 'First token',
    tps: 'Speed',
    turns: 'Turns',
    tokens: 'Session tokens',
    cache: 'Cache hit',
    cost: 'Est. cost',
  },
};

export function ComposerSessionStats(props: {
  items: readonly ComposerStatusItem[];
  zh: boolean;
}): ReactElement {
  const labels = props.zh ? ROW_LABELS.zh : ROW_LABELS.en;
  return (
    <section className="context-usage-request composer-session-stats" data-testid="composer-session-stats">
      <p className="context-usage-request-title">{props.zh ? '本会话' : 'This session'}</p>
      <ul className="context-usage-rows">
        {props.items.map((item) => (
          <li key={item.key} data-row={`session-${item.key}`} title={item.title}>
            <span className="context-usage-row-label">
              {item.key === 'elapsed' && item.label ? item.label : labels[item.key]}
            </span>
            <span className={`context-usage-row-value${item.tone ? ` tone-${item.tone}` : ''}`}>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ComposerToolbarContext(props: ComposerStatsLineProps): ReactElement | null {
  const runningElapsedMs = useRunningElapsed(props.isRunning === true);
  const view = props.contextView;
  if (!view?.visible) return null;
  const bar = buildComposerStatusBar({ ...props, runningElapsedMs });
  const items = [...bar.turn, ...bar.resources];
  return (
    <ContextUsageRing
      view={view}
      variant="ring"
      {...(props.onOpenModelSettings ? { onOpenModelSettings: props.onOpenModelSettings } : {})}
      details={
        items.length > 0 ? <ComposerSessionStats items={items} zh={props.locale === 'zh-CN'} /> : null
      }
    />
  );
}
