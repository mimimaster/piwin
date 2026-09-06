/**
 * Compact parent-transcript subagent launcher (PSR D5).
 *
 * Observation only — the card expands the inline read-only session panel in
 * place; it never spawns, merges, or navigates the workspace. Status reflects
 * the persisted transcript card (`activity.state`); live work is surfaced by
 * the Working dock / ticker driven by the shared activity model.
 */
import type { ReactElement } from 'react';
import type { SubagentActivityView } from '@piwin/contracts';
import type { ActiveSubagentStatus, SubagentInspectorSelection } from './subagent-activity-model';
import { subagentCardAnchorId, subagentStatusToRunKind } from './subagent-activity-model';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';
import { IconChevronRight } from './shell-icons.js';
import { useDesktopLocale } from './desktop-locale-context';
import {
  behaviorTextClass,
  getBehaviorActivitySpec,
  resolveSubagentBatchBehaviorId,
} from './behavior-activity.js';
import { useSubagentInspectorToggle } from './subagent-inspector-context';
import { SubagentInlineSession } from './subagent-inline-session';

export type SubagentActivityCardProps = {
  activity: SubagentActivityView;
  /** Toggles the inline child-session panel anchored to this card. */
  onInspect?: (selection: SubagentInspectorSelection) => void;
  /** Whether the inline session panel is currently expanded below the card. */
  expanded?: boolean;
};

const STATE_LABEL: Record<SubagentActivityView['state'], string> = {
  started: 'Started',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  merged: 'Merged',
};

/** Transcript card state → shared activity status (merged is complete). */
const ACTIVITY_STATUS_MAP: Record<SubagentActivityView['state'], ActiveSubagentStatus> = {
  started: 'running',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  merged: 'completed',
};

function toInspectorSelection(activity: SubagentActivityView): SubagentInspectorSelection {
  return {
    childSessionId: activity.childSessionId,
    displayName: activity.displayName,
    taskSummary: activity.taskSummary,
    anchorId: subagentCardAnchorId(activity.childSessionId),
  };
}

export function SubagentActivityCard(props: SubagentActivityCardProps): ReactElement {
  const { activity, onInspect } = props;
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const activityStatus = ACTIVITY_STATUS_MAP[activity.state];
  const statusKind = subagentStatusToRunKind(activityStatus);
  const activityId = resolveSubagentBatchBehaviorId(activity.state);
  const activitySpec = getBehaviorActivitySpec(activityId);
  const isRunning = activityStatus === 'running';

  return (
    <button
      type="button"
      className="card line az subagent-activity-card"
      data-testid="subagent-activity-card"
      data-state={activity.state}
      data-activity-id={activityId}
      data-activity-animation={activitySpec.animation}
      data-tool-status={isRunning ? 'running' : 'done'}
      data-child-session-id={activity.childSessionId}
      data-expanded={props.expanded === true}
      onClick={() => onInspect?.(toInspectorSelection(activity))}
      disabled={onInspect === undefined}
      aria-expanded={props.expanded === true}
      title={activity.taskSummary}
    >
      <span className="subagent-activity-header">
        <span className="subagent-activity-title">
          <ActivitySvgIcon kind={statusKind} className="subagent-status-icon" />
          <strong className={`subagent-activity-name ${behaviorTextClass(activityId, isRunning)}`}>
            {activity.displayName}
          </strong>
        </span>
        <span className={`subagent-activity-state state-${activity.state}`}>
          {isChinese
            ? {
                started: '已开始',
                running: '运行中',
                completed: '已完成',
                failed: '失败',
                cancelled: '已取消',
                merged: '已合并',
              }[activity.state]
            : STATE_LABEL[activity.state]}
        </span>
      </span>
      <span className="subagent-activity-body">
        <span className="subagent-activity-task">{activity.taskSummary}</span>
        {activity.worktreePath ? (
          <span className="subagent-activity-worktree" title={activity.worktreePath}>
            {isChinese ? '工作树：' : 'Worktree: '} <code>{activity.worktreePath}</code>
          </span>
        ) : null}
      </span>
      <IconChevronRight className="subagent-activity-inspect-hint" width={14} height={14} />
    </button>
  );
}

/**
 * Transcript slot for one persisted subagent card: the card is the accordion
 * header and the inline session panel expands directly beneath it when this
 * card's anchor owns the current inspector selection.
 */
export function SubagentActivitySlot(props: SubagentActivityCardProps): ReactElement {
  const toggle = useSubagentInspectorToggle();
  const expanded =
    props.onInspect !== undefined &&
    toggle?.selection?.anchorId === subagentCardAnchorId(props.activity.childSessionId);
  return (
    <div className="subagent-embed subagent-embed-card" data-expanded={expanded}>
      <SubagentActivityCard {...props} expanded={expanded} />
      {expanded ? <SubagentInlineSession /> : null}
    </div>
  );
}
