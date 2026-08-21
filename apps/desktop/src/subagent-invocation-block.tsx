import type { ReactElement } from 'react';
import type {
  SessionSummary,
  SubagentInvocation,
  SubagentInvocationActivity,
} from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import { normalizeExecutionStatus } from './subagent-activity-model';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';
import {
  getBehaviorActivitySpec,
  type BehaviorActivityId,
} from './behavior-activity.js';
import type { ModelOption } from './model-options';
import { SubagentIdentityChips } from './subagent-identity-chip';
import { IconChevronDown } from './shell-icons';

export type SubagentInvocationBlockProps = {
  tool: ToolCardUi;
  invocation?: SubagentInvocation;
  child?: SessionSummary;
  stream?: SubagentStreamState;
  locale: 'zh-CN' | 'en';
  modelOptions?: readonly ModelOption[];
  /** Toggles the inline session panel anchored to this block. */
  onInspect?: (selection: SubagentInspectorSelection) => void;
  /** Whether the inline session panel is currently expanded below the block. */
  expanded?: boolean;
};

type InvocationStatus =
  | 'starting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'needs-integration'
  | 'failed'
  | 'cancelled';

function resolveStatus(props: SubagentInvocationBlockProps): InvocationStatus {
  if (props.invocation) {
    return props.invocation.status;
  }
  if (props.child) {
    return normalizeExecutionStatus(props.child);
  }
  if (props.tool.status === 'error') return 'failed';
  if (props.tool.status === 'done') return 'completed';
  return 'starting';
}

function persistedActivityLabel(
  activity: SubagentInvocationActivity,
  locale: 'zh-CN' | 'en',
): string {
  switch (activity.kind) {
    case 'queued':
      return locale === 'zh-CN' ? '等待调度' : 'Queued';
    case 'preparing':
      return locale === 'zh-CN' ? '正在准备工作区' : 'Preparing workspace';
    case 'thinking':
      return locale === 'zh-CN' ? '思考中' : 'Thinking';
    case 'responding':
      return locale === 'zh-CN' ? '正在生成回复' : 'Responding';
    case 'tool':
      return locale === 'zh-CN'
        ? `正在执行 ${activity.title ?? activity.toolName}`
        : `Running ${activity.title ?? activity.toolName}`;
    case 'permission':
      return locale === 'zh-CN'
        ? `等待权限确认：${activity.action}`
        : `Waiting for permission: ${activity.action}`;
    case 'completed':
      return activity.summary?.trim() || (locale === 'zh-CN' ? '已完成' : 'Completed');
    case 'needs-integration':
      return activity.message?.trim() ||
        (locale === 'zh-CN' ? '修改待处理' : 'Changes need attention');
    case 'failed':
      return activity.message?.trim() || (locale === 'zh-CN' ? '子任务失败' : 'Subtask failed');
    case 'cancelled':
      return locale === 'zh-CN' ? '已取消' : 'Cancelled';
  }
}

function latestActivity(
  props: SubagentInvocationBlockProps,
  status: InvocationStatus,
): string {
  if (props.stream?.permissionPrompt) {
    return props.locale === 'zh-CN' ? '等待权限确认' : 'Waiting for permission';
  }
  const runningTool = [...(props.stream?.tools ?? [])]
    .reverse()
    .find((tool) => tool.status === 'running');
  if (runningTool) {
    return props.locale === 'zh-CN'
      ? `正在执行 ${runningTool.toolName}`
      : `Running ${runningTool.toolName}`;
  }
  const text = props.stream?.text.trim();
  if (text) return text.replace(/\s+/g, ' ').slice(0, 160);
  if (props.stream?.thinking.trim()) {
    return props.locale === 'zh-CN' ? '思考中' : 'Thinking';
  }
  if (props.invocation) {
    return persistedActivityLabel(props.invocation.activity, props.locale);
  }
  if (status === 'failed') {
    return props.tool.presentation?.error?.message?.trim() ||
      (props.locale === 'zh-CN' ? '子任务失败' : 'Subtask failed');
  }
  if (status === 'cancelled') {
    return props.locale === 'zh-CN' ? '已取消' : 'Cancelled';
  }
  if (status === 'completed') {
    return props.child?.summaryPreview?.trim() ||
      (props.locale === 'zh-CN' ? '已完成' : 'Completed');
  }
  if (status === 'needs-integration') {
    return props.locale === 'zh-CN' ? '修改待处理' : 'Changes need attention';
  }
  if (status === 'queued' || status === 'starting') {
    return props.locale === 'zh-CN' ? '正在启动' : 'Starting';
  }
  return props.child?.lastPreview?.trim() ||
    props.child?.task?.trim() ||
    (props.locale === 'zh-CN' ? '工作中' : 'Working');
}

function statusKind(
  status: InvocationStatus,
): 'preparing' | 'working' | 'complete' | 'failed' | 'stopping' {
  switch (status) {
    case 'starting':
    case 'queued':
      return 'preparing';
    case 'running':
      return 'working';
    case 'completed':
      return 'complete';
    case 'needs-integration':
      return 'stopping';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'stopping';
  }
}

function behaviorIdForStatus(status: InvocationStatus): BehaviorActivityId {
  switch (status) {
    case 'starting':
    case 'queued':
      return 'subagent.task.queued';
    case 'running':
      return 'subagent.task.running';
    case 'completed':
      return 'subagent.task.complete';
    case 'needs-integration':
      return 'subagent.task.complete';
    case 'failed':
      return 'subagent.task.fail';
    case 'cancelled':
      return 'subagent.task.cancelled';
  }
}

export function SubagentInvocationBlock(
  props: SubagentInvocationBlockProps,
): ReactElement {
  const status = resolveStatus(props);
  const isActive = status === 'starting' || status === 'queued' || status === 'running';
  const title =
    props.child?.name?.trim() ||
    props.invocation?.title?.trim() ||
    props.tool.presentation?.summary?.trim() ||
    props.invocation?.task?.trim() ||
    props.child?.task?.trim() ||
    (props.locale === 'zh-CN' ? '子代理任务' : 'Subagent task');
  const role = props.invocation?.role ?? props.child?.subagentRole;
  const profileId = props.invocation?.profileId ?? props.child?.subagentProfileId;
  const model = props.invocation?.model ?? props.child?.subagentModel;
  const canInspect = props.child !== undefined && props.onInspect !== undefined;
  const expanded = props.expanded === true;
  const behaviorId = behaviorIdForStatus(status);
  const toggleInspector = (): void => {
    if (!props.child || !props.onInspect) return;
    props.onInspect({
      childSessionId: props.child.id,
      displayName: title,
      taskSummary: props.child.task ?? '',
      anchorId: props.tool.toolCallId,
    });
  };

  return (
    <button
      type="button"
      className="subagent-invocation-block"
      data-testid="subagent-invocation-block"
      data-status={status}
      data-child-session-id={props.child?.id}
      data-tool-call-id={props.tool.toolCallId}
      data-activity-id={behaviorId}
      data-activity-animation={getBehaviorActivitySpec(behaviorId).animation}
      data-tool-status={isActive ? 'running' : status === 'failed' ? 'error' : 'done'}
      data-expanded={expanded}
      disabled={!canInspect}
      onClick={toggleInspector}
      aria-expanded={expanded}
      aria-label={`${title}: ${latestActivity(props, status)}`}
    >
      <ActivitySvgIcon kind={statusKind(status)} className="subagent-invocation-icon" />
      <span className="subagent-invocation-copy">
        <span className="subagent-invocation-heading">
          <span className="subagent-invocation-title">{title}</span>
          <SubagentIdentityChips
            locale={props.locale}
            showModelPlaceholder
            {...(role ? { role } : {})}
            {...(profileId ? { profileId } : {})}
            {...(model ? { model } : {})}
            {...(props.modelOptions ? { modelOptions: props.modelOptions } : {})}
          />
        </span>
        <span className="subagent-invocation-activity" role="status" aria-live="polite">
          {latestActivity(props, status)}
        </span>
      </span>
      {canInspect ? (
        <IconChevronDown
          className="subagent-invocation-chevron"
          width={14}
          height={14}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
