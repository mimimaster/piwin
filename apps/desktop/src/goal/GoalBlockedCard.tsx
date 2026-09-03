/**
 * GoalBlockedCard — shown when the model stops and asks for a decision
 * (`goal_blocked`).
 *
 * Both actions are real: one puts the caret back in the composer so the user
 * can answer, the other leaves Goal for ordinary Agent work. There is no
 * "adjust goal" action because the product has no such operation — editing the
 * objective is just writing the next prompt.
 */
import { type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconWarn } from '../shell-icons';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalBlockedCardProps = {
  reason: string;
  unblockAction?: string;
  onProvideInput?: () => void;
  onSwitchToAgent?: () => void;
  /** Owning tool call; used by the Goal timeline to jump here. */
  toolCallId?: string;
};

export function GoalBlockedCard({
  reason,
  unblockAction,
  onProvideInput,
  onSwitchToAgent,
  toolCallId,
}: GoalBlockedCardProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  return (
    <div
      className="goal-blocked-card"
      data-testid="goal-blocked-card"
      {...(toolCallId !== undefined ? { 'data-tool-call-id': toolCallId } : {})}
    >
      <div className="goal-blocked-header">
        <IconWarn className="goal-blocked-icon" />
        <span className="goal-blocked-title">
          {isZh ? '目标执行受阻' : 'Goal is blocked'}
        </span>
      </div>

      <div className="goal-blocked-body">
        <div className="goal-blocked-section">
          <p className="goal-section-label">{isZh ? '受阻原因' : 'Reason'}</p>
          <p className="goal-reason-text">{reason}</p>
        </div>

        {unblockAction ? (
          <div className="goal-blocked-section">
            <p className="goal-section-label">{isZh ? '需要你的决定' : 'Needs from you'}</p>
            <p className="goal-action-text" data-testid="goal-unblock-action">
              {unblockAction}
            </p>
          </div>
        ) : null}
      </div>

      {onProvideInput || onSwitchToAgent ? (
        <div className="goal-blocked-actions">
          {onProvideInput ? (
            <Button
              size="compact"
              variant="primary"
              onClick={onProvideInput}
              data-testid="goal-provide-input-btn"
            >
              {isZh ? '回复并继续' : 'Answer and continue'}
            </Button>
          ) : null}

          {onSwitchToAgent ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={onSwitchToAgent}
              data-testid="goal-switch-to-agent-btn"
            >
              {isZh ? '退出 Goal' : 'Leave Goal'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
