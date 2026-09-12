import type { ReactElement } from 'react';
import { StatusBadge, type StatusTone } from '@piwin/ui-kit';
import type {
  SessionSummary,
  SubagentControlDisplay,
  SubagentInvocation,
  SubagentInvocationActivity,
} from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import {
  isOrchestrationExecutionActive,
  resolveSubagentLifecycleAxes,
} from './subagent-activity-model';
import type { SubagentOrchestrationItem } from './subagent-orchestration-view';
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
  /** Host-derived orchestration item when the parent view has one. */
  orchestrationItem?: SubagentOrchestrationItem;
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

type LifecycleAxes = {
  executionStatus: InvocationStatus;
  summaryStatus?: string;
  integrationStatus?: string;
};

function isAsyncStartTool(tool: ToolCardUi): boolean {
  const control = tool.presentation?.subagentControl;
  if (control?.phase === 'accepted') return true;
  if (control !== undefined) return false;
  return tool.toolName === 'piwin_subagent_start';
}

function acceptedControl(tool: ToolCardUi): Extract<SubagentControlDisplay, { phase: 'accepted' }> | undefined {
  const control = tool.presentation?.subagentControl;
  return control?.phase === 'accepted' ? control : undefined;
}

function visualStatus(
  execution: LifecycleAxes['executionStatus'] | 'starting' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  integration?: string,
): InvocationStatus {
  if (execution === 'queued' || execution === 'starting' || execution === 'running') {
    return execution;
  }
  if (execution === 'failed') return 'failed';
  if (execution === 'cancelled') return 'cancelled';
  if (integration === 'pending' || integration === 'conflict') return 'needs-integration';
  return 'completed';
}

function resolveLifecycle(props: SubagentInvocationBlockProps): LifecycleAxes {
  if (props.orchestrationItem) {
    return {
      executionStatus: visualStatus(
        props.orchestrationItem.executionStatus,
        props.orchestrationItem.integrationStatus,
      ),
      ...(props.orchestrationItem.summaryStatus !== undefined
        ? { summaryStatus: props.orchestrationItem.summaryStatus }
        : {}),
      ...(props.orchestrationItem.integrationStatus !== undefined
        ? { integrationStatus: props.orchestrationItem.integrationStatus }
        : {}),
    };
  }

  if (props.invocation) {
    const axes = resolveSubagentLifecycleAxes({
      invocation: props.invocation,
      ...(props.child !== undefined ? { child: props.child } : {}),
    });
    return {
      executionStatus: visualStatus(axes.executionStatus, axes.integrationStatus),
      ...(axes.summaryStatus !== undefined ? { summaryStatus: axes.summaryStatus } : {}),
      ...(axes.integrationStatus !== undefined ? { integrationStatus: axes.integrationStatus } : {}),
    };
  }

  if (isAsyncStartTool(props.tool)) {
    if (props.tool.status === 'error') {
      return { executionStatus: 'failed' };
    }
    return { executionStatus: 'queued' };
  }

  if (props.child) {
    const axes = resolveSubagentLifecycleAxes({ child: props.child });
    return {
      executionStatus: visualStatus(axes.executionStatus, axes.integrationStatus),
      ...(axes.summaryStatus !== undefined ? { summaryStatus: axes.summaryStatus } : {}),
      ...(axes.integrationStatus !== undefined ? { integrationStatus: axes.integrationStatus } : {}),
    };
  }

  if (props.tool.status === 'error') return { executionStatus: 'failed' };
  if (props.tool.status === 'done') return { executionStatus: 'completed' };
  return { executionStatus: 'starting' };
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

function formatElapsed(startedAt: string, endedAt: string): string {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function executionBadge(
  status: InvocationStatus,
  locale: 'zh-CN' | 'en',
): { tone: StatusTone; label: string } | undefined {
  const zh = locale === 'zh-CN';
  switch (status) {
    case 'starting':
    case 'queued':
      return { tone: 'neutral', label: zh ? '排队中' : 'Queued' };
    case 'running':
      return { tone: 'running', label: zh ? '运行中' : 'Running' };
    case 'cancelled':
      return { tone: 'neutral', label: zh ? '已取消' : 'Cancelled' };
    default:
      return undefined;
  }
}

type SecondaryBadge = { tone: StatusTone; label: string; testId: string };

function secondaryBadges(
  axes: LifecycleAxes,
  locale: 'zh-CN' | 'en',
): SecondaryBadge[] {
  if (isOrchestrationExecutionActive(axes.executionStatus === 'needs-integration' ? 'completed' : axes.executionStatus)) {
    return [];
  }
  const zh = locale === 'zh-CN';
  const badges: SecondaryBadge[] = [];
  if (axes.summaryStatus === 'pending') {
    badges.push({
      tone: 'warning',
      label: zh ? '报告待收集' : 'Report pending',
      testId: 'subagent-badge-report-pending',
    });
  } else if (axes.summaryStatus === 'merged') {
    badges.push({
      tone: 'success',
      label: zh ? '已收集' : 'Collected',
      testId: 'subagent-badge-collected',
    });
  } else if (axes.summaryStatus === 'failed') {
    badges.push({
      tone: 'danger',
      label: zh ? '失败' : 'Failed',
      testId: 'subagent-badge-summary-failed',
    });
  }
  if (axes.integrationStatus === 'pending') {
    badges.push({
      tone: 'warning',
      label: zh ? '代码待处理' : 'Code pending',
      testId: 'subagent-badge-code-pending',
    });
  } else if (axes.integrationStatus === 'conflict') {
    badges.push({
      tone: 'danger',
      label: zh ? '冲突' : 'Conflict',
      testId: 'subagent-badge-conflict',
    });
  } else if (axes.integrationStatus === 'failed') {
    badges.push({
      tone: 'danger',
      label: zh ? '失败' : 'Failed',
      testId: 'subagent-badge-integration-failed',
    });
  }
  return badges;
}

function isFullySettled(axes: LifecycleAxes): boolean {
  if (axes.executionStatus === 'failed' || axes.executionStatus === 'cancelled') {
    return false;
  }
  if (axes.executionStatus !== 'completed') return false;
  return secondaryBadges(axes, 'en').length === 0;
}

export function SubagentInvocationBlock(
  props: SubagentInvocationBlockProps,
): ReactElement {
  const axes = resolveLifecycle(props);
  const status = axes.executionStatus;
  const isActive = status === 'starting' || status === 'queued' || status === 'running';
  const accepted = acceptedControl(props.tool);
  const invocationId =
    props.orchestrationItem?.invocationId ??
    props.invocation?.id ??
    accepted?.invocationId;
  const title =
    props.child?.name?.trim() ||
    props.invocation?.title?.trim() ||
    props.orchestrationItem?.title?.trim() ||
    props.tool.presentation?.summary?.trim() ||
    accepted?.task?.trim() ||
    props.invocation?.task?.trim() ||
    props.child?.task?.trim() ||
    (props.locale === 'zh-CN' ? '子代理任务' : 'Subagent task');
  const role = props.invocation?.role ?? props.child?.subagentRole ?? props.orchestrationItem?.role;
  const profileId = props.invocation?.profileId ?? props.child?.subagentProfileId;
  const model = props.invocation?.model ?? props.child?.subagentModel;
  const canInspect = props.child !== undefined && props.onInspect !== undefined;
  const expanded = props.expanded === true;
  const behaviorId = behaviorIdForStatus(status);
  const sealChar = resolveSubagentSealChar(role, title, props.locale);
  const startedAt = props.orchestrationItem?.startedAt ?? props.invocation?.createdAt;
  const endedAt = props.orchestrationItem?.updatedAt ?? props.invocation?.updatedAt;
  const elapsed =
    startedAt !== undefined && endedAt !== undefined ? formatElapsed(startedAt, endedAt) : '';
  const activeBadge = executionBadge(status, props.locale);
  const extras = secondaryBadges(axes, props.locale);
  const showCompleted = isFullySettled(axes);
  const inspectAnchor = invocationId ?? props.tool.toolCallId;

  const toggleInspector = (): void => {
    if (!props.child || !props.onInspect) return;
    props.onInspect({
      childSessionId: props.child.id,
      displayName: title,
      taskSummary: props.child.task ?? '',
      anchorId: inspectAnchor,
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
      {...(invocationId !== undefined ? { 'data-invocation-id': invocationId } : {})}
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
          {activeBadge ? (
            <StatusBadge
              tone={activeBadge.tone}
              label={activeBadge.label}
              testId="subagent-execution-badge"
            />
          ) : null}
          {showCompleted ? (
            <StatusBadge
              tone="success"
              label={props.locale === 'zh-CN' ? '已完成' : 'Completed'}
              testId="subagent-execution-badge"
            />
          ) : null}
          {status === 'failed' && extras.length === 0 ? (
            <StatusBadge
              tone="danger"
              label={props.locale === 'zh-CN' ? '失败' : 'Failed'}
              testId="subagent-execution-badge"
            />
          ) : null}
          {extras.map((badge) => (
            <StatusBadge
              key={badge.testId}
              tone={badge.tone}
              label={badge.label}
              testId={badge.testId}
            />
          ))}
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
          {elapsed ? (
            <span className="subagent-invocation-elapsed" data-testid="subagent-elapsed">
              {elapsed}
            </span>
          ) : null}
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
