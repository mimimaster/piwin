/**
 * Compact parent-transcript subagent launcher (PSR D5).
 *
 * Observation only — the card opens the read-only session inspector; it never
 * spawns, merges, or navigates the workspace. Status reflects the persisted
 * transcript card (`activity.state`); live work is surfaced by the Working
 * dock / ticker driven by the shared activity model.
 */
import type { ReactElement } from 'react';
import type { SubagentActivityView } from '@piwin/contracts';
import type { ActiveSubagentStatus, SubagentInspectorSelection } from './subagent-activity-model';
import { subagentStatusToRunKind } from './subagent-activity-model';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';
import { IconChevronRight } from './shell-icons.js';
import { useDesktopLocale } from './desktop-locale-context';
import {
  behaviorTextClass,
  getBehaviorActivitySpec,
  resolveSubagentBatchBehaviorId,
} from './behavior-activity.js';

export type SubagentActivityCardProps = {
  activity: SubagentActivityView;
  /** Opens the read-only child-session inspector for this child. */
  onInspect?: (selection: SubagentInspectorSelection) => void;
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
      className="subagent-activity-card"
      data-testid="subagent-activity-card"
      data-state={activity.state}
      data-activity-id={activityId}
      data-activity-animation={activitySpec.animation}
      data-tool-status={isRunning ? 'running' : 'done'}
      data-child-session-id={activity.childSessionId}
      onClick={() => onInspect?.(toInspectorSelection(activity))}
      disabled={onInspect === undefined}
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
                started: '已启动',
                running: '工作中',
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
