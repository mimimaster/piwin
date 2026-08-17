/**
 * GoalStickyStrip — sticky header strip shown when a Goal is active.
 * Shows current objective, status badge (Running / Paused / Blocked / Complete),
 * turn/step counter, and fast actions (Pause, Resume, Abort).
 */
import { type ReactElement } from 'react';
import { Button, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalStatus = 'running' | 'paused' | 'blocked' | 'completed';

export type GoalStickyStripProps = {
  goalTitle: string;
  status: GoalStatus;
  turnsCount?: number;
  blockedReason?: string;
  onPause?: () => void;
  onResume?: () => void;
  onAbort?: () => void;
  onViewDetails?: () => void;
};

export function GoalStickyStrip({
  goalTitle,
  status,
  turnsCount,
  blockedReason,
  onPause,
  onResume,
  onAbort,
  onViewDetails,
}: GoalStickyStripProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const statusLabel = {
    running: isZh ? '目标自主执行中' : 'Goal Executing',
    paused: isZh ? '目标已暂停' : 'Goal Paused',
    blocked: isZh ? '目标受阻需介入' : 'Goal Blocked',
    completed: isZh ? '目标已达成' : 'Goal Completed',
  }[status];

  return (
    <div
      className={`goal-sticky-strip goal-status-${status}`}
      data-testid="goal-sticky-strip"
      data-status={status}
    >
      <div className="goal-strip-main">
        <div className="goal-strip-badge">
          {status === 'running' ? (
            <Spinner />
          ) : (
            <span className={`goal-status-dot dot-${status}`} aria-hidden />
          )}
          <span className="goal-status-text">{statusLabel}</span>
          {typeof turnsCount === 'number' && turnsCount > 0 ? (
            <span className="goal-turn-pill" title={isZh ? `已运行 ${turnsCount} 轮` : `Turn ${turnsCount}`}>
              {isZh ? `第 ${turnsCount} 轮` : `Turn ${turnsCount}`}
            </span>
          ) : null}
        </div>

        <div className="goal-strip-title" title={goalTitle}>
          <span className="goal-icon">🎯</span>
          <span className="goal-title-text">{goalTitle}</span>
        </div>

        {status === 'blocked' && blockedReason ? (
          <div className="goal-strip-blocker" title={blockedReason}>
            ⚠️ {blockedReason}
          </div>
        ) : null}
      </div>

      <div className="goal-strip-actions">
        {onViewDetails ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={onViewDetails}
            aria-label={isZh ? '查看详情' : 'View details'}
          >
            {isZh ? '详情' : 'Details'}
          </Button>
        ) : null}

        {status === 'running' && onPause ? (
          <Button
            size="compact"
            variant="secondary"
            onClick={onPause}
            aria-label={isZh ? '暂停目标' : 'Pause Goal'}
          >
            ⏸️ {isZh ? '暂停' : 'Pause'}
          </Button>
        ) : null}

        {status === 'paused' && onResume ? (
          <Button
            size="compact"
            variant="primary"
            onClick={onResume}
            aria-label={isZh ? '继续目标' : 'Resume Goal'}
          >
            ▶️ {isZh ? '继续' : 'Resume'}
          </Button>
        ) : null}

        {onAbort && status !== 'completed' ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={onAbort}
            data-testid="goal-abort-btn"
            aria-label={isZh ? '终止目标' : 'Abort Goal'}
          >
            {isZh ? '终止' : 'Abort'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
