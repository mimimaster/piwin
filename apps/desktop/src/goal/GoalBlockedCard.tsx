/**
 * GoalBlockedCard — card displayed when a Goal signals it is blocked.
 * Outlines the problem, required decision, and actions to resolve.
 */
import { type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalBlockedCardProps = {
  reason: string;
  unblockAction?: string;
  onProvideInput?: () => void;
  onAdjustGoal?: () => void;
  onSwitchToAgent?: () => void;
};

export function GoalBlockedCard({
  reason,
  unblockAction,
  onProvideInput,
  onAdjustGoal,
  onSwitchToAgent,
}: GoalBlockedCardProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  return (
    <div className="goal-blocked-card" data-testid="goal-blocked-card">
      <div className="goal-blocked-header">
        <span className="goal-blocked-icon">⚠️</span>
        <span className="goal-blocked-title">
          {isZh ? '目标执行遇到阻碍 (Impasse)' : 'Goal Execution Blocked'}
        </span>
      </div>

      <div className="goal-blocked-body">
        <div className="goal-blocked-section">
          <div className="goal-section-label">{isZh ? '受阻原因' : 'Blocker Reason'}</div>
          <div className="goal-reason-text">{reason}</div>
        </div>

        {unblockAction ? (
          <div className="goal-blocked-section">
            <div className="goal-section-label">{isZh ? '建议解决方式' : 'Action to Unblock'}</div>
            <div className="goal-action-text">{unblockAction}</div>
          </div>
        ) : null}
      </div>

      <div className="goal-blocked-actions">
        {onProvideInput ? (
          <Button size="compact" variant="primary" onClick={onProvideInput}>
            {isZh ? '补充信息并重试' : 'Provide Info & Retry'}
          </Button>
        ) : null}

        {onAdjustGoal ? (
          <Button size="compact" variant="secondary" onClick={onAdjustGoal}>
            {isZh ? '调整目标准则' : 'Adjust Goal'}
          </Button>
        ) : null}

        {onSwitchToAgent ? (
          <Button size="compact" variant="ghost" onClick={onSwitchToAgent}>
            {isZh ? '转为人工普通模式' : 'Switch to Agent'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
