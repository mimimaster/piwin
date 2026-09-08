import type { ReactElement } from 'react';
import type {
  SessionSummary,
  SubagentInvocation,
  SubagentInvocationActivity,
} from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import { normalizeExecutionStatus } from './subagent-activity-model';
import {
  getBehaviorActivitySpec,
  type BehaviorActivityId,
} from './behavior-activity.js';
import type { ModelOption } from './model-options';
import { SubagentIdentityChips } from './subagent-identity-chip';
import { IconChevronDown, IconCheck, IconClose } from './shell-icons';

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

const ROLE_CHAR_MAP: Record<string, string> = {
  reviewer: '审',
  review: '审',
  scout: '探',
  research: '探',
  search: '搜',
  tester: '测',
  test: '测',
  coder: '编',
  code: '编',
  engineer: '工',
  developer: '发',
  architect: '构',
  planner: '划',
  plan: '计',
  writer: '文',
  docs: '档',
  critic: '评',
  debugger: '调',
  fixer: '修',
  optimizer: '优',
  analyst: '析',
};

export function resolveSubagentSealChar(
  role?: string,
  title?: string,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): string {
  const cleanRole = role?.trim().toLowerCase();
  if (cleanRole && cleanRole in ROLE_CHAR_MAP) {
    return ROLE_CHAR_MAP[cleanRole]!;
  }
  const roleChinese = role?.match(/[\u4e00-\u9fa5]/);
  if (roleChinese?.[0]) return roleChinese[0];

  const titleChinese = title?.match(/[\u4e00-\u9fa5]/);
  if (titleChinese?.[0]) return titleChinese[0];

  if (cleanRole && cleanRole.length > 0) {
    return cleanRole[0]!.toUpperCase();
  }
  if (title && title.trim().length > 0) {
    return title.trim()[0]!.toUpperCase();
  }

  return locale === 'zh-CN' ? '子' : 'S';
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
  const sealChar = resolveSubagentSealChar(role, title, props.locale);

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
      className="subagent-invocation-block subagent-seal-card"
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
      <span
        className={`subagent-seal subagent-seal-${status}`}
        data-status={status}
        data-testid="subagent-seal"
        aria-hidden="true"
      >
        {sealChar}
      </span>
      <span className="subagent-invocation-copy">
        <span className="subagent-invocation-heading">
          <span className="subagent-invocation-title">{title}</span>
          {status === 'completed' ? (
            <span className="subagent-status-pill pill-completed">
              <IconCheck width={12} height={12} aria-hidden="true" />
              <span>{props.locale === 'zh-CN' ? '已完成' : 'Completed'}</span>
            </span>
          ) : status === 'failed' ? (
            <span className="subagent-status-pill pill-failed">
              <IconClose width={12} height={12} aria-hidden="true" />
              <span>{props.locale === 'zh-CN' ? '失败' : 'Failed'}</span>
            </span>
          ) : status === 'needs-integration' ? (
            <span className="subagent-status-pill pill-warning">
              <span>{props.locale === 'zh-CN' ? '待处理' : 'Attention'}</span>
            </span>
          ) : null}
        </span>
        <span className="subagent-invocation-activity" role="status" aria-live="polite">
          {isActive ? <span className="subagent-grind-spinner" aria-hidden="true" /> : null}
          <span className="subagent-activity-text">{latestActivity(props, status)}</span>
        </span>
        <span className="subagent-invocation-tags">
          <SubagentIdentityChips
            locale={props.locale}
            showModelPlaceholder
            {...(role ? { role } : {})}
            {...(profileId ? { profileId } : {})}
            {...(model ? { model } : {})}
            {...(props.modelOptions ? { modelOptions: props.modelOptions } : {})}
          />
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
