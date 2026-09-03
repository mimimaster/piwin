/**
 * GoalWaitCard — one quiet row for `goal_wait`.
 *
 * A wait used to render as an ordinary tool row, so a loop parked on an
 * external job looked indistinguishable from a stalled agent. In flight it
 * breathes on the shell cycle (Deck §6: every liveness mark shares one
 * animation); settled it collapses to a past-tense statement of fact.
 */
import { type ReactElement } from 'react';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalWaitCardProps = {
  reason: string;
  /** Planned wait as reported by the tool; absent means open-ended. */
  durationSeconds?: number;
  /** True while the tool call has not settled. */
  running: boolean;
  /** Owning tool call; used by the Goal timeline to jump here. */
  toolCallId?: string;
};

function formatDuration(seconds: number, isZh: boolean): string {
  if (seconds < 60) {
    return isZh ? `${seconds} 秒` : `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (remainder === 0) {
    return isZh ? `${minutes} 分` : `${minutes}m`;
  }
  return isZh ? `${minutes} 分 ${remainder} 秒` : `${minutes}m ${remainder}s`;
}

export function GoalWaitCard({
  reason,
  durationSeconds,
  running,
  toolCallId,
}: GoalWaitCardProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const duration =
    durationSeconds !== undefined && durationSeconds > 0
      ? formatDuration(durationSeconds, isZh)
      : null;

  return (
    <div
      className={`goal-wait-card${running ? ' is-running' : ''}`}
      data-testid="goal-wait-card"
      data-running={running}
      {...(toolCallId !== undefined ? { 'data-tool-call-id': toolCallId } : {})}
    >
      <span className="goal-wait-dot" aria-hidden />
      <span className="goal-wait-label">
        {running ? (isZh ? '等待中' : 'Waiting') : isZh ? '已等待' : 'Waited'}
      </span>
      <span className="goal-wait-reason" title={reason}>
        {reason}
      </span>
      {duration ? (
        <span className="goal-wait-duration" data-testid="goal-wait-duration">
          {duration}
        </span>
      ) : null}
    </div>
  );
}
