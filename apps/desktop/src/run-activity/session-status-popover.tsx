/**
 * Session status popover — the titlebar's flat activity surface.
 *
 * One icon button sits left of the right-panel toggle. Opening it shows a
 * single-layer list with no title chrome: plan progress, running subagents
 * and terminal jobs (the rows that used to float above the composer), the
 * working-tree change count, and this session's artifacts. Every row keeps
 * the action it had before: focus the subagent card or Tasks tab, view job
 * logs in the terminal, open Review for the diff.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { IconButton, Popover } from '@piwin/ui-kit';
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
import { deriveComposerActivityModel, EMPTY_SUBAGENT_ORCHESTRATION_VIEW } from '../composer/composer-activity-model.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { IconClose } from '../tool-cards/shell-icons';
import { isOrchestrationExecutionActive } from '../agents/subagent-activity-model.js';
import type {
  SubagentOrchestrationItem,
  SubagentOrchestrationView,
} from '../agents/subagent-orchestration-view.js';
import type { RightPanelTab } from '../right-panel/right-panel-sections';

export type SessionStatusArtifact = {
  id: string;
  title: string;
  /** Short provenance tag, already localized ("画布", "交付报告", "写入"). */
  tag?: string | undefined;
  icon?: ReactElement | undefined;
  onOpen?: (() => void) | undefined;
};

export type SessionStatusPopoverProps = {
  locale?: DesktopLocale | undefined;
  plan?: SessionPlan | null | undefined;
  orchestrationView?: SubagentOrchestrationView | undefined;
  jobs?: readonly JobRecord[] | undefined;
  diffStat?: { additions: number; deletions: number } | null | undefined;
  artifacts?: readonly SessionStatusArtifact[] | undefined;
  onOpenTool: (tab: RightPanelTab) => void;
  onViewJobLogs?: ((jobId: string) => void) | undefined;
  onStopJob?: ((jobId: string) => void) | undefined;
  onCancelSubagentBatch?: ((runId: string) => void) | undefined;
  /** Stop-all for batches; falls back to one cancel per run. */
  onCancelSubagentBatches?: ((runIds: readonly string[]) => void) | undefined;
  isSubagentStopping?: ((runId: string) => boolean) | undefined;
};

function statusCopy(zh: boolean) {
  return {
    trigger: zh ? '会话状态' : 'Session status',
    progress: zh ? '进度' : 'Progress',
    running: zh ? '运行' : 'Running',
    changes: zh ? '变更' : 'Changes',
    artifacts: zh ? '产物' : 'Artifacts',
    stopAll: zh ? '全部停止' : 'Stop all',
    stop: zh ? '停止' : 'Stop',
    stopping: zh ? '停止中…' : 'Stopping…',
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

const EMPTY_ORCHESTRATION = EMPTY_SUBAGENT_ORCHESTRATION_VIEW;

export function SessionStatusPopover(props: SessionStatusPopoverProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const zh = (props.locale ?? contextLocale) === 'zh-CN';
  const copy = statusCopy(zh);
  const [open, setOpen] = useState(false);

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

  const plan = props.plan ?? null;
  const planDone = plan === null ? 0 : plan.steps.filter((step) => step.status === 'done').length;
  const planActive = plan?.steps.some((step) => step.status === 'active') === true;
  const hasDiff = props.diffStat != null && (props.diffStat.additions > 0 || props.diffStat.deletions > 0);
  const artifacts = props.artifacts ?? [];
  const hasAnyContent =
    plan !== null || activityModel.items.length > 0 || activityModel.jobs.length > 0 || props.diffStat != null || artifacts.length > 0;

  const canStopAll =
    activityModel.stopRunIds.length > 0 || activityModel.stopJobIds.length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      label={copy.trigger}
      testId="session-status-popover"
      contentClassName="session-status-popover"
      trigger={
        <IconButton
          className="session-status-btn ib"
          data-testid="session-status-btn"
          label={copy.trigger}
          title={copy.trigger}
          aria-expanded={open}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <circle cx="5" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.5 5H3.2M6.8 5H14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="11" cy="11" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.5 11H9.2M12.8 11H14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {activityModel.visible || planActive ? (
            <span
              className="session-status-live-dot"
              data-testid="session-status-live-dot"
              aria-hidden="true"
            />
          ) : null}
        </IconButton>
      }
    >
      <div className="session-status" data-testid="session-status" role="list">
        {!hasAnyContent ? (
          <div className="session-status-empty" data-testid="session-status-empty">
            {copy.empty}
          </div>
        ) : null}

        {plan !== null ? (
          <div className="session-status-group" data-testid="session-status-progress">
            <div className="session-status-label">
              <span>{copy.progress}</span>
              <span className="session-status-label-meta">
                {planDone}/{plan.steps.length}
              </span>
            </div>
            <ul className="session-status-list">
              {plan.steps.map((step) => {
                const icon = planStepIcon(step.status);
                return (
                  <li key={step.id} className="session-status-row" role="listitem">
                    <span className={`session-status-step ${icon.className}`} aria-hidden="true">
                      {step.status === 'active' ? <i className="session-status-dot is-running" /> : icon.glyph}
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
          </div>
        ) : null}

        {activityModel.items.length > 0 || activityModel.jobs.length > 0 ? (
          <div className="session-status-group" data-testid="session-status-running">
            <div className="session-status-label">
              <span>{copy.running}</span>
              {canStopAll ? (
                <button
                  type="button"
                  className="session-status-stop-all"
                  data-testid="session-status-stop-all"
                  onClick={() => {
                    applyComposerStopAll({
                      runIds: activityModel.stopRunIds,
                      jobIds: activityModel.stopJobIds,
                      cancelBatch: props.onCancelSubagentBatch ?? (() => {}),
                      ...(props.onCancelSubagentBatches
                        ? { cancelBatches: props.onCancelSubagentBatches }
                        : {}),
                      stopJob: props.onStopJob ?? (() => {}),
                    });
                    setOpen(false);
                  }}
                >
                  {copy.stopAll}
                </button>
              ) : null}
            </div>
            <ul className="session-status-list">
              {activityModel.items.map((item) => {
                const runId = item.runId;
                const stoppable =
                  runId !== undefined && isOrchestrationExecutionActive(item.executionStatus);
                const stopping = runId !== undefined && props.isSubagentStopping?.(runId) === true;
                return (
                  <li key={item.anchorId} className="session-status-row" role="listitem">
                    <button
                      type="button"
                      className="session-status-row-main"
                      data-testid="session-status-subagent-row"
                      onClick={() => {
                        focusComposerSubagentItem(item, () => props.onOpenTool('tasks'));
                        setOpen(false);
                      }}
                    >
                      <i className={`session-status-dot ${subagentDotClass(item)}`} aria-hidden="true" />
                      <span className="session-status-row-title">{item.title}</span>
                      <span className="session-status-row-meta">{item.activity}</span>
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
              {activityModel.jobs.map((job) => {
                const meta = jobRowMeta(job);
                return (
                  <li key={job.jobId} className="session-status-row" role="listitem">
                    <button
                      type="button"
                      className="session-status-row-main"
                      data-testid="session-status-job-row"
                      onClick={() => {
                        props.onViewJobLogs?.(job.jobId);
                        setOpen(false);
                      }}
                    >
                      <i className={`session-status-dot ${jobStatusDotClass(job.status)}`} aria-hidden="true" />
                      <span className="session-status-row-title">{jobDisplayLabel(job)}</span>
                      {meta ? <span className="session-status-row-meta">{meta}</span> : null}
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

        {props.diffStat != null ? (
          <div className="session-status-group" data-testid="session-status-changes">
            <button
              type="button"
              className="session-status-row is-interactive"
              data-testid="session-status-changes-row"
              role="listitem"
              onClick={() => {
                props.onOpenTool('review');
                setOpen(false);
              }}
            >
              <span className="session-status-row-title">{copy.changes}</span>
              {hasDiff ? (
                <span className="session-status-diff" data-testid="session-status-diff">
                  {props.diffStat.additions > 0 ? (
                    <span className="is-add">+{props.diffStat.additions}</span>
                  ) : null}
                  {props.diffStat.deletions > 0 ? (
                    <span className="is-del">−{props.diffStat.deletions}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          </div>
        ) : null}

        {artifacts.length > 0 ? (
          <div className="session-status-group" data-testid="session-status-artifacts">
            <div className="session-status-label">
              <span>{copy.artifacts}</span>
            </div>
            <ul className="session-status-list">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="session-status-row" role="listitem">
                  {artifact.onOpen ? (
                    <button
                      type="button"
                      className="session-status-row-main"
                      data-testid={`session-status-artifact-${artifact.id}`}
                      onClick={() => {
                        artifact.onOpen?.();
                        setOpen(false);
                      }}
                    >
                      {artifact.icon ? (
                        <span className="session-status-row-icon" aria-hidden="true">
                          {artifact.icon}
                        </span>
                      ) : null}
                      <span className="session-status-row-title">{artifact.title}</span>
                      {artifact.tag ? (
                        <span className="session-status-row-meta">{artifact.tag}</span>
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
                      {artifact.tag ? (
                        <span className="session-status-row-meta">{artifact.tag}</span>
                      ) : null}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
