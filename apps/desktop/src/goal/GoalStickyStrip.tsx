/**
 * GoalStickyStrip — the standing answer to "what is the Goal loop doing?".
 *
 * Everything shown here is derived from the transcript by
 * `deriveGoalSessionView`; the strip itself owns no state and invents no
 * status. Pause / Resume are deliberately absent: the Host has no goal-level
 * pause semantics, and buttons wired to nothing are worse than no buttons.
 * Abort (the run-level cancel) and Exit (leave the mode) are the real actions.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button, Popover } from '@piwin/ui-kit';
import type { ChatMessageUi } from '../chat-ui-types';
import { useDesktopLocale } from '../desktop-locale-context';
import { GoalTimeline, jumpToGoalTimelineEvent } from './GoalTimeline';
import { listGoalEvents, type GoalPhase, type GoalSessionView } from './goal-session-model';

export type GoalStickyStripProps = {
  view: GoalSessionView;
  /** Transcript used to build the round-pill timeline. */
  messages: readonly ChatMessageUi[];
  /** Cancel the underlying run. Hidden once the goal has settled. */
  onAbort?: () => void;
  /** Leave Goal mode and return to Agent. */
  onExit?: () => void;
};

function phaseLabel(phase: GoalPhase, isZh: boolean): string {
  switch (phase) {
    case 'running':
      return isZh ? '目标执行中' : 'Goal running';
    case 'waiting':
      return isZh ? '等待外部条件' : 'Goal waiting';
    case 'blocked':
      return isZh ? '目标受阻' : 'Goal blocked';
    case 'completed':
      return isZh ? '目标已达成' : 'Goal completed';
    default:
      return isZh ? '目标模式' : 'Goal mode';
  }
}

export function GoalStickyStrip({
  view,
  messages,
  onAbort,
  onExit,
}: GoalStickyStripProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const blockedReason = view.latest?.phase === 'blocked' ? view.latest.reason : null;
  const settled = view.phase === 'completed';
  const [timelineOpen, setTimelineOpen] = useState(false);
  const events = useMemo(
    () => listGoalEvents(messages, view.objectiveIndex),
    [messages, view.objectiveIndex],
  );
  const roundLabel = isZh ? `第 ${view.roundCount} 轮` : `Turn ${view.roundCount}`;

  return (
    <div
      className={`goal-sticky-strip goal-status-${view.phase}`}
      data-testid="goal-sticky-strip"
      data-status={view.phase}
    >
      <div className="goal-strip-main">
        <div className="goal-strip-badge">
          <span className={`goal-status-dot dot-${view.phase}`} aria-hidden />
          <span className="goal-status-text">{phaseLabel(view.phase, isZh)}</span>
          {view.roundCount > 0 ? (
            events.length > 0 ? (
              <Popover
                open={timelineOpen}
                onOpenChange={setTimelineOpen}
                side="bottom"
                align="start"
                label={isZh ? 'Goal 时间线' : 'Goal timeline'}
                testId="goal-timeline-popover"
                contentClassName="goal-timeline-popover"
                trigger={
                  <button
                    type="button"
                    className="goal-turn-pill"
                    data-testid="goal-round-pill"
                    aria-haspopup="dialog"
                    aria-expanded={timelineOpen}
                    title={isZh ? '查看本轮时间线' : 'Open the Goal timeline'}
                  >
                    {roundLabel}
                  </button>
                }
              >
                <GoalTimeline
                  events={events}
                  locale={locale}
                  onJump={(event) => {
                    jumpToGoalTimelineEvent(event);
                    setTimelineOpen(false);
                  }}
                />
              </Popover>
            ) : (
              <span className="goal-turn-pill" data-testid="goal-round-pill">
                {roundLabel}
              </span>
            )
          ) : null}
        </div>

        {view.objective ? (
          <div className="goal-strip-title" title={view.objective} data-testid="goal-objective">
            <span className="goal-title-text">{view.objective}</span>
          </div>
        ) : null}

        {blockedReason ? (
          <div className="goal-strip-blocker" title={blockedReason}>
            {blockedReason}
          </div>
        ) : null}
      </div>

      <div className="goal-strip-actions">
        {onAbort && !settled ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={onAbort}
            data-testid="goal-abort-btn"
            aria-label={isZh ? '终止当前运行' : 'Abort the current run'}
          >
            {isZh ? '终止' : 'Abort'}
          </Button>
        ) : null}

        {onExit ? (
          <Button
            size="compact"
            variant="secondary"
            onClick={onExit}
            data-testid="goal-exit-btn"
            aria-label={isZh ? '退出 Goal 模式' : 'Leave Goal mode'}
          >
            {isZh ? '退出 Goal' : 'Leave Goal'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
