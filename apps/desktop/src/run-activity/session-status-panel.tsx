/**
 * Session status panel — the flat 2-layer surface shared by the titlebar
 * popover and the stage right-gutter dock.
 *
 * Layer 1 is the translucent sheet owned by the caller (popover content or
 * `.session-status-dock`); layer 2 is this flat row list:
 *   1. Headerless top group (human session title, system prompt, external plugins)
 *   2. Running (plan steps, subagents, background jobs)
 *   3. Deliverables (verified session artifacts — never workspace-write spam)
 * No nested cards, no colored badges, no Composer-duplicated metrics, no
 * input-reference list.
 */
import { useMemo, type ReactElement } from 'react';
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import {
  formatJobElapsed,
  jobDisplayLabel,
  jobPortFromArgs,
  jobStatusDotClass,
} from './active-jobs-strip';
import {
  applyComposerStopAll,
  focusComposerSubagentItem,
} from '../composer/composer-activity-actions.js';
import {
  deriveComposerActivityModel,
  EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
} from '../composer/composer-activity-model.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { IconClose } from '../tool-cards/shell-icons';
import { isOrchestrationExecutionActive } from '../agents/subagent-activity-model.js';
import type {
  SubagentOrchestrationItem,
  SubagentOrchestrationView,
} from '../agents/subagent-orchestration-view.js';
import type { RightPanelTab } from '../right-panel/right-panel-sections';
import {
  deriveSessionStatusInsights,
  type SessionStatusInsights,
  type SessionStatusRuntimeInfo,
} from './session-status-model.js';
import { SessionStatusTopGroup } from './session-status-sections';

export type { SessionStatusRuntimeInfo } from './session-status-model.js';

export type SessionStatusArtifact = {
  id: string;
  title: string;
  /** Quiet provenance/path detail rendered as muted text (画布, 报告, path). */
  meta?: string | undefined;
  icon?: ReactElement | undefined;
  onOpen?: (() => void) | undefined;
};

export type SessionStatusPanelProps = {
  locale?: DesktopLocale | undefined;
  plan?: SessionPlan | null | undefined;
  orchestrationView?: SubagentOrchestrationView | undefined;
  jobs?: readonly JobRecord[] | undefined;
  artifacts?: readonly SessionStatusArtifact[] | undefined;
  runtimeInfo?: SessionStatusRuntimeInfo | undefined;
  onOpenTool: (tab: RightPanelTab) => void;
  onViewJobLogs?: ((jobId: string) => void) | undefined;
  onStopJob?: ((jobId: string) => void) | undefined;
  onCancelSubagentBatch?: ((runId: string) => void) | undefined;
  /** Stop-all for batches; falls back to one cancel per run. */
  onCancelSubagentBatches?: ((runIds: readonly string[]) => void) | undefined;
  isSubagentStopping?: ((runId: string) => boolean) | undefined;
  /** Runs after a row navigates — the popover closes itself, the dock stays. */
  onNavigate?: (() => void) | undefined;
};

export function sessionStatusCopy(zh: boolean) {
  return {
    trigger: zh ? '会话状态' : 'Session status',
    progress: zh ? '进度' : 'Progress',
    running: zh ? '运行中' : 'Running',
    deliverables: zh ? '交付物' : 'Deliverables',
    stopAll: zh ? '全部停止' : 'Stop all',
    stop: zh ? '停止' : 'Stop',
    stopping: zh ? '停止中…' : 'Stopping…',
    close: zh ? '关闭' : 'Close',
    empty: zh ? '暂无会话活动' : 'No session activity',
  };
}

function planStepIcon(status: string): { glyph: string; className: string } {
  switch (status) {
    case 'done':
      return { glyph: '✓', className: 'is-done' };
    case 'active':
      return { glyph: '', className: 'is-active' };
    case 'skipped':
      return { glyph: '–', className: 'is-skipped' };
    default:
      return { glyph: '', className: 'is-pending' };
  }
}

function jobRowMeta(job: JobRecord): string {
  const port = jobPortFromArgs(job);
  if (job.status === 'ready' && port !== null) {
    return `:${port}`;
  }
  return formatJobElapsed(job.startedAt);
}

function subagentDotClass(item: SubagentOrchestrationItem): string {
  if (isOrchestrationExecutionActive(item.executionStatus)) {
    return 'is-running';
  }
  if (item.executionStatus === 'failed') {
    return 'is-failed';
  }
  return 'is-ready';
}

/**
 * Clean human status word — never dump raw child summary markdown (`done - **...`)
 * into the narrow right-hand meta column.
 */
function subagentStatusLabel(item: SubagentOrchestrationItem, zh: boolean): string {
  switch (item.executionStatus) {
    case 'queued':
      return zh ? '排队中' : 'Queued';
    case 'starting':
      return zh ? '启动中' : 'Starting';
    case 'running':
      return zh ? '运行中' : 'Running';
    case 'failed':
      return zh ? '失败' : 'Failed';
    case 'cancelled':
      return zh ? '已停止' : 'Stopped';
    case 'completed':
      return zh ? '已完成' : 'Done';
  }
}

const MACHINE_SUBAGENT_ID_RE = /^(?:session|sess|subagent|child|inv)[-_][a-z0-9_-]{4,}$/i;

function subagentDisplayTitle(item: SubagentOrchestrationItem, zh: boolean): string {
  const raw = item.title.trim();
  if (!raw || MACHINE_SUBAGENT_ID_RE.test(raw)) {
    if (item.role === 'scout' || item.role === 'explorer') {
      return zh ? '代码调研' : 'Explore';
    }
    if (item.role === 'reviewer') {
      return zh ? '变更审查' : 'Review';
    }
    return zh ? '子代理任务' : 'Subagent';
  }
  return raw;
}

const EMPTY_ORCHESTRATION = EMPTY_SUBAGENT_ORCHESTRATION_VIEW;

/**
 * Locale + derived activity model shared by the popover (trigger capsule
 * count) and the panel (rows). One derivation keeps the trigger count and the
 * row list from disagreeing.
 */
export function useSessionStatusView(props: {
  locale?: DesktopLocale | undefined;
  plan?: SessionPlan | null | undefined;
  orchestrationView?: SubagentOrchestrationView | undefined;
  jobs?: readonly JobRecord[] | undefined;
  artifacts?: readonly SessionStatusArtifact[] | undefined;
  runtimeInfo?: SessionStatusRuntimeInfo | undefined;
}): {
  zh: boolean;
  copy: ReturnType<typeof sessionStatusCopy>;
  plan: SessionPlan | null;
  planDone: number;
  planActive: boolean;
  items: readonly SubagentOrchestrationItem[];
  jobs: readonly JobRecord[];
  canStopAll: boolean;
  stopRunIds: readonly string[];
  stopJobIds: readonly string[];
  artifacts: readonly SessionStatusArtifact[];
  insights: SessionStatusInsights;
  hasAnyContent: boolean;
  /** Subagents + jobs + live plan — the breathing-capsule counter. */
  activeProcessCount: number;
} {
  const { locale: contextLocale } = useDesktopLocale();
  const zh = (props.locale ?? contextLocale) === 'zh-CN';
  const copy = sessionStatusCopy(zh);

  const orchestration = props.orchestrationView ?? EMPTY_ORCHESTRATION;
  const activityModel = useMemo(
    () =>
      deriveComposerActivityModel({
        orchestration,
        jobs: props.jobs ?? [],
        locale: zh ? 'zh-CN' : 'en',
      }),
    [orchestration, props.jobs, zh],
  );
  const insights = useMemo(
    () => deriveSessionStatusInsights(props.runtimeInfo, zh),
    [props.runtimeInfo, zh],
  );

  const plan = props.plan ?? null;
  const planDone = plan === null ? 0 : plan.steps.filter((step) => step.status === 'done').length;
  const planActive = plan?.steps.some((step) => step.status === 'active') === true;
  const artifacts = props.artifacts ?? [];
  const hasAnyContent =
    insights.hasTopGroup ||
    plan !== null ||
    activityModel.items.length > 0 ||
    activityModel.jobs.length > 0 ||
    artifacts.length > 0;

  const activeSubagentCount = activityModel.items.filter((item) =>
    isOrchestrationExecutionActive(item.executionStatus),
  ).length;
  const activeProcessCount = activeSubagentCount + activityModel.jobs.length + (planActive ? 1 : 0);

  const canStopAll =
    activityModel.stopRunIds.length > 0 || activityModel.stopJobIds.length > 0;

  return {
    zh,
    copy,
    plan,
    planDone,
    planActive,
    items: activityModel.items,
    jobs: activityModel.jobs,
    canStopAll,
    stopRunIds: activityModel.stopRunIds,
    stopJobIds: activityModel.stopJobIds,
    artifacts,
    insights,
    hasAnyContent,
    activeProcessCount,
  };
}

export function SessionStatusPanel(props: SessionStatusPanelProps): ReactElement {
  const view = useSessionStatusView(props);
  const { copy } = view;
  const showRunning = view.plan !== null || view.items.length > 0 || view.jobs.length > 0;

  return (
    <div className="session-status" data-testid="session-status" role="list">
      {!view.hasAnyContent ? (
        <div className="session-status-empty" data-testid="session-status-empty">
          {copy.empty}
        </div>
      ) : null}

      <SessionStatusTopGroup
        session={view.insights.session}
        prompt={view.insights.prompt}
        plugins={view.insights.plugins}
        zh={view.zh}
      />

      {showRunning ? (
        <div className="session-status-group" data-testid="session-status-running">
          <div className="session-status-label">
            <span>{copy.running}</span>
            {view.canStopAll ? (
              <button
                type="button"
                className="session-status-stop-all"
                data-testid="session-status-stop-all"
                onClick={() => {
                  applyComposerStopAll({
                    runIds: view.stopRunIds,
                    jobIds: view.stopJobIds,
                    cancelBatch: props.onCancelSubagentBatch ?? (() => {}),
                    ...(props.onCancelSubagentBatches
                      ? { cancelBatches: props.onCancelSubagentBatches }
                      : {}),
                    stopJob: props.onStopJob ?? (() => {}),
                  });
                  props.onNavigate?.();
                }}
              >
                {copy.stopAll}
              </button>
            ) : null}
          </div>
          <ul className="session-status-list">
            {view.plan !== null ? (
              <li className="session-status-plan" data-testid="session-status-progress">
                <div className="session-status-plan-head">
                  <span className="session-status-plan-label">{copy.progress}</span>
                  <span className="session-status-label-meta">
                    {view.planDone}/{view.plan.steps.length}
                  </span>
                </div>
                <ul className="session-status-list">
                  {view.plan.steps.map((step) => {
                    const icon = planStepIcon(step.status);
                    return (
                      <li key={step.id} className="session-status-row" role="listitem">
                        <span className={`session-status-step ${icon.className}`} aria-hidden="true">
                          {step.status === 'active' ? (
                            <i className="session-status-dot is-running" />
                          ) : (
                            icon.glyph
                          )}
                        </span>
                        <span
                          className={`session-status-row-title${step.status === 'done' || step.status === 'skipped' ? ' is-muted' : ''}`}
                        >
                          {step.title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ) : null}
            {view.items.map((item) => {
              const runId = item.runId;
              const stoppable =
                runId !== undefined && isOrchestrationExecutionActive(item.executionStatus);
              const stopping = runId !== undefined && props.isSubagentStopping?.(runId) === true;
              const doneLike = !isOrchestrationExecutionActive(item.executionStatus) && item.executionStatus !== 'failed';
              return (
                <li key={item.anchorId} className="session-status-row" role="listitem">
                  <button
                    type="button"
                    className="session-status-row-main"
                    data-testid="session-status-subagent-row"
                    onClick={() => {
                      focusComposerSubagentItem(item, () => props.onOpenTool('tasks'));
                      props.onNavigate?.();
                    }}
                  >
                    <i className={`session-status-dot ${subagentDotClass(item)}`} aria-hidden="true" />
                    <span className={`session-status-row-title${doneLike ? ' is-muted' : ''}`}>
                      {subagentDisplayTitle(item, view.zh)}
                    </span>
                    <span className="session-status-row-meta">
                      {subagentStatusLabel(item, view.zh)}
                    </span>
                  </button>
                  {stoppable ? (
                    <button
                      type="button"
                      className="session-status-row-stop"
                      data-testid="session-status-stop-subagent"
                      aria-label={stopping ? copy.stopping : copy.stop}
                      aria-busy={stopping}
                      title={stopping ? copy.stopping : copy.stop}
                      disabled={stopping}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onCancelSubagentBatch?.(runId);
                      }}
                    >
                      <IconClose width={11} height={11} />
                    </button>
                  ) : null}
                </li>
              );
            })}
            {view.jobs.map((job) => {
              const meta = jobRowMeta(job);
              return (
                <li key={job.jobId} className="session-status-row" role="listitem">
                  <button
                    type="button"
                    className="session-status-row-main"
                    data-testid="session-status-job-row"
                    onClick={() => {
                      props.onViewJobLogs?.(job.jobId);
                      props.onNavigate?.();
                    }}
                  >
                    <i className={`session-status-dot ${jobStatusDotClass(job.status)}`} aria-hidden="true" />
                    <span className="session-status-row-title">{jobDisplayLabel(job)}</span>
                    {meta ? <span className="session-status-row-meta is-mono">{meta}</span> : null}
                  </button>
                  {props.onStopJob ? (
                    <button
                      type="button"
                      className="session-status-row-stop"
                      data-testid="session-status-stop-job"
                      aria-label={copy.stop}
                      title={copy.stop}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onStopJob?.(job.jobId);
                      }}
                    >
                      <IconClose width={11} height={11} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {view.artifacts.length > 0 ? (
        <div className="session-status-group" data-testid="session-status-artifacts">
          <div className="session-status-label">
            <span>{copy.deliverables}</span>
          </div>
          <ul className="session-status-list">
            {view.artifacts.map((artifact) => (
              <li key={artifact.id} className="session-status-row" role="listitem">
                {artifact.onOpen ? (
                  <button
                    type="button"
                    className="session-status-row-main"
                    data-testid={`session-status-artifact-${artifact.id}`}
                    onClick={() => {
                      artifact.onOpen?.();
                      props.onNavigate?.();
                    }}
                  >
                    {artifact.icon ? (
                      <span className="session-status-row-icon" aria-hidden="true">
                        {artifact.icon}
                      </span>
                    ) : null}
                    <span className="session-status-row-title">{artifact.title}</span>
                    {artifact.meta ? (
                      <span className="session-status-row-meta">{artifact.meta}</span>
                    ) : null}
                  </button>
                ) : (
                  <span className="session-status-row-static">
                    {artifact.icon ? (
                      <span className="session-status-row-icon" aria-hidden="true">
                        {artifact.icon}
                      </span>
                    ) : null}
                    <span className="session-status-row-title">{artifact.title}</span>
                    {artifact.meta ? (
                      <span className="session-status-row-meta">{artifact.meta}</span>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export type SessionStatusDockProps = SessionStatusPanelProps & {
  /** Dismisses the gutter sheet; the shell re-centers the conversation. */
  onDismiss?: (() => void) | undefined;
};

/**
 * The docked sheet: the same flat panel pinned into the stage's right gutter
 * by `.chat-stage.has-session-dock`. No backdrop-filter — the dock stays up
 * for the session's life, so it pays zero IOSurface cost.
 */
export function SessionStatusDock(props: SessionStatusDockProps): ReactElement {
  const { onDismiss, locale, ...panelProps } = props;
  const { locale: contextLocale } = useDesktopLocale();
  const zh = (locale ?? contextLocale) === 'zh-CN';
  const copy = sessionStatusCopy(zh);
  return (
    <aside className="session-status-dock" data-testid="session-status-dock">
      <button
        type="button"
        className="session-status-dock-close"
        data-testid="session-status-dock-close"
        aria-label={copy.close}
        title={copy.close}
        onClick={() => onDismiss?.()}
      >
        <IconClose width={11} height={11} />
      </button>
      <SessionStatusPanel {...panelProps} locale={locale} />
    </aside>
  );
}
