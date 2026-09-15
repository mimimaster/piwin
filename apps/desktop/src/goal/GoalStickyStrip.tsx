/**
 * GoalStickyStrip — the standing answer to "what is the Goal loop doing?".
 *
 * Rendered by `ComposerDock` as a lid tab resting on the slab's top edge, so
 * the loop's status sits next to the controls that steer it instead of
 * scrolling away at the top of the transcript.
 *
 * Everything shown here is derived from the transcript by
 * `deriveGoalSessionView`; the strip itself owns no state and invents no
 * status. Pause / Resume are deliberately absent: the Host has no goal-level
 * pause semantics, and buttons wired to nothing are worse than no buttons.
 * Abort (the run-level cancel) and Exit (leave the mode) are the real actions.
 *
 * Motion (styles/goal.css): the lid rises out from behind the slab on mount;
 * running lights a lamp with an ink-bloom halo and a sheen along the lid's top
 * hairline; the phase label re-inks when the phase changes; the round pill
 * ticks when a new round starts; completion stamps a check.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { ChatMessageUi } from '../chat-ui-types';
import { useDesktopLocale } from '../desktop-locale-context';
import { IconCheck, IconClose } from '../shell-icons';
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

function PhaseMark({ phase }: { phase: GoalPhase }): ReactElement {
  if (phase === 'completed') {
    return (
      <span className="goal-dock-mark is-completed" aria-hidden>
        <IconCheck width={12} height={12} />
      </span>
    );
  }
  return <span className={`goal-dock-mark is-${phase}`} aria-hidden />;
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
  const pillTitle = isZh ? '查看 Goal 时间线' : 'Open the Goal timeline';

  return (
    <div
      className={`goal-dock goal-status-${view.phase}`}
      data-testid="goal-sticky-strip"
      data-status={view.phase}
      role="status"
      aria-live="polite"
    >
      <div className="goal-dock-lead">
        <PhaseMark key={`mark-${view.phase}`} phase={view.phase} />
        <span key={`label-${view.phase}`} className="goal-dock-phase">
          {phaseLabel(view.phase, isZh)}
        </span>
        {view.roundCount > 0 ? (
          events.length > 0 ? (
            <Popover
              open={timelineOpen}
              onOpenChange={setTimelineOpen}
              side="top"
              align="start"
              label={isZh ? 'Goal 时间线' : 'Goal timeline'}
              testId="goal-timeline-popover"
              contentClassName="goal-timeline-popover"
              trigger={
                <button
                  key={`round-${view.roundCount}`}
                  type="button"
                  className="goal-dock-round"
                  data-testid="goal-round-pill"
                  aria-haspopup="dialog"
                  aria-expanded={timelineOpen}
                  title={pillTitle}
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
            <span
              key={`round-${view.roundCount}`}
              className="goal-dock-round"
              data-testid="goal-round-pill"
            >
              {roundLabel}
            </span>
          )
        ) : null}
      </div>

      <div className="goal-dock-body">
        {view.objective ? (
          <span className="goal-dock-objective" title={view.objective} data-testid="goal-objective">
            {view.objective}
          </span>
        ) : null}
        {blockedReason ? (
          <span className="goal-dock-blocker" title={blockedReason}>
            {blockedReason}
          </span>
        ) : null}
      </div>

      <div className="goal-dock-actions">
        {onAbort && !settled ? (
          <button
            type="button"
            className="goal-dock-action"
            onClick={onAbort}
            data-testid="goal-abort-btn"
            aria-label={isZh ? '终止当前运行' : 'Abort the current run'}
          >
            {isZh ? '终止' : 'Abort'}
          </button>
        ) : null}
        {onExit ? (
          <button
            type="button"
            className="goal-dock-action is-exit"
            onClick={onExit}
            data-testid="goal-exit-btn"
            aria-label={isZh ? '退出 Goal 模式' : 'Leave Goal mode'}
            title={isZh ? '退出 Goal，回到 Agent' : 'Leave Goal and return to Agent'}
          >
            {isZh ? '退出' : 'Leave'}
            <IconClose width={11} height={11} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
