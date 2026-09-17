/**
 * Cursor-style activity pill above Composer: braille spinner, count, and a
 * popover that reaches F1 subagent cards and persistent job logs.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { JobRecord } from '@piwin/contracts';
import {
  formatJobElapsed,
  jobDisplayLabel,
  jobPortFromArgs,
  jobStatusDotClass,
} from './active-jobs-strip';
import {
  applyComposerStopAll,
  focusComposerSubagentItem,
} from './composer-activity-actions.js';
import { composerActivityCopy } from './composer-activity-copy.js';
import {
  deriveComposerActivityModel,
  EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
  type ComposerActivityLocale,
} from './composer-activity-model.js';
import { useDesktopLocale } from './desktop-locale-context';
import { IconChevronDown, IconClose } from './shell-icons';
import { isOrchestrationExecutionActive } from './subagent-activity-model.js';
import type {
  SubagentOrchestrationItem,
  SubagentOrchestrationView,
} from './subagent-orchestration-view.js';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type ComposerActivityPillProps = {
  orchestrationView?: SubagentOrchestrationView | undefined;
  jobs?: readonly JobRecord[] | undefined;
  onViewJobLogs: (jobId: string) => void;
  onStopJob: (jobId: string) => void;
  onCancelSubagentBatch: (runId: string) => void;
  /** Stop-all for batches; falls back to one onCancelSubagentBatch per run. */
  onCancelSubagentBatches?: (runIds: readonly string[]) => void;
  isSubagentStopping?: (runId: string) => boolean;
  onOpenTasks: () => void;
  locale?: ComposerActivityLocale | undefined;
};

function ComposerActivitySpinner(props: {
  spinning: boolean;
  reducedMotion: boolean;
}): ReactElement {
  const [frame, setFrame] = useState(0);
  const animate = props.spinning && !props.reducedMotion;
  useEffect(() => {
    if (!animate) {
      return;
    }
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % BRAILLE_FRAMES.length);
    }, 80);
    return () => {
      window.clearInterval(timer);
    };
  }, [animate]);

  if (!props.spinning) {
    return (
      <span className="composer-activity-pill-icon is-done" data-animated="false" aria-hidden>
        ✓
      </span>
    );
  }
  if (props.reducedMotion) {
    return (
      <span className="composer-activity-pill-icon is-static" data-animated="false" aria-hidden>
        {BRAILLE_FRAMES[0]}
      </span>
    );
  }
  return (
    <span className="composer-activity-pill-icon" data-animated="true" aria-hidden>
      {BRAILLE_FRAMES[frame]}
    </span>
  );
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

function jobRowMeta(job: JobRecord): string {
  const port = jobPortFromArgs(job);
  if (job.status === 'ready' && port !== null) {
    return `:${port}`;
  }
  return formatJobElapsed(job.startedAt);
}

function renderSubagentStop(
  item: SubagentOrchestrationItem,
  copy: { stop: string; stopping: string },
  onCancelSubagentBatch: (runId: string) => void,
  isSubagentStopping: ((runId: string) => boolean) | undefined,
): ReactElement | null {
  const runId = item.runId;
  if (runId === undefined || !isOrchestrationExecutionActive(item.executionStatus)) {
    return null;
  }
  const stopping = isSubagentStopping?.(runId) === true;
  const label = stopping ? copy.stopping : copy.stop;
  return (
    <button
      type="button"
      className="composer-activity-row-stop"
      data-testid="composer-activity-stop-subagent"
      data-stopping={stopping}
      aria-label={label}
      aria-busy={stopping}
      title={label}
      disabled={stopping}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancelSubagentBatch(runId);
      }}
    >
      <IconClose width={11} height={11} />
    </button>
  );
}

export function ComposerActivityPill(props: ComposerActivityPillProps): ReactElement | null {
  const { locale: contextLocale } = useDesktopLocale();
  const locale = props.locale ?? contextLocale;
  const [reducedMotion, setReducedMotion] = useState(readPrefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => {
      setReducedMotion(media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
    };
  }, []);
  const [open, setOpen] = useState(false);
  const copy = composerActivityCopy(locale);
  const model = useMemo(
    () =>
      deriveComposerActivityModel({
        orchestration: props.orchestrationView ?? EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
        jobs: props.jobs ?? [],
        locale,
      }),
    [props.orchestrationView, props.jobs, locale],
  );

  if (!model.visible) {
    return null;
  }

  const canStopAll = model.stopRunIds.length > 0 || model.stopJobIds.length > 0;

  return (
    <div className="composer-activity-rail" data-testid="composer-activity-rail">
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        label={copy.pillTitle}
        testId="composer-activity-popover"
        contentClassName="composer-activity-popover"
        trigger={
          <button
            type="button"
            className="composer-activity-pill"
            data-testid="composer-activity-pill"
            title={copy.pillTitle}
            aria-label={model.label}
          >
            <ComposerActivitySpinner spinning={model.spinning} reducedMotion={reducedMotion} />
            <span className="composer-activity-pill-label">{model.label}</span>
            <span className="composer-activity-pill-chevron" aria-hidden>
              <IconChevronDown width={10} height={10} />
            </span>
          </button>
        }
      >
        <div className="composer-activity-popover-head">
          <span>{copy.backgroundTasks}</span>
          {canStopAll ? (
            <button
              type="button"
              className="composer-activity-stop-all"
              data-testid="composer-activity-stop-all"
              onClick={() => {
                applyComposerStopAll({
                  runIds: model.stopRunIds,
                  jobIds: model.stopJobIds,
                  cancelBatch: props.onCancelSubagentBatch,
                  ...(props.onCancelSubagentBatches
                    ? { cancelBatches: props.onCancelSubagentBatches }
                    : {}),
                  stopJob: props.onStopJob,
                });
                setOpen(false);
              }}
            >
              {copy.stopAll}
            </button>
          ) : null}
        </div>

        {model.items.length > 0 ? (
          <div className="composer-activity-section" data-testid="composer-activity-subagents">
            <ul className="composer-activity-list">
              {model.items.map((item) => (
                <li key={item.anchorId}>
                  <div className="composer-activity-row">
                    <button
                      type="button"
                      className="composer-activity-row-main"
                      data-testid="composer-activity-subagent-row"
                      onClick={() => {
                        focusComposerSubagentItem(item, props.onOpenTasks);
                        setOpen(false);
                      }}
                    >
                      <i
                        className={`composer-active-job-dot ${subagentDotClass(item)}`}
                        aria-hidden
                      />
                      <span className="composer-activity-row-title">{item.title}</span>
                      <span className="composer-activity-row-meta">{item.activity}</span>
                    </button>
                    {renderSubagentStop(
                      item,
                      copy,
                      props.onCancelSubagentBatch,
                      props.isSubagentStopping,
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {model.jobs.length > 0 ? (
          <div className="composer-activity-section" data-testid="composer-activity-jobs">
            <div className="composer-activity-section-label">{copy.terminalJobs}</div>
            <ul className="composer-activity-list">
              {model.jobs.map((job) => {
                const meta = jobRowMeta(job);
                return (
                  <li key={job.jobId}>
                    <div className="composer-activity-row">
                      <button
                        type="button"
                        className="composer-activity-row-main"
                        data-testid="composer-activity-job-row"
                        onClick={() => {
                          props.onViewJobLogs(job.jobId);
                          setOpen(false);
                        }}
                      >
                        <i
                          className={`composer-active-job-dot ${jobStatusDotClass(job.status)}`}
                          aria-hidden
                        />
                        <span className="composer-activity-row-title">{jobDisplayLabel(job)}</span>
                        {meta ? (
                          <span className="composer-activity-row-meta">{meta}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="composer-activity-row-stop"
                        data-testid="composer-activity-stop-job"
                        aria-label={copy.stop}
                        title={copy.stop}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onStopJob(job.jobId);
                        }}
                      >
                        <IconClose width={11} height={11} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="composer-activity-popover-foot">
          <span>{copy.jumpHint}</span>
          <button
            type="button"
            className="composer-activity-popover-close"
            onClick={() => setOpen(false)}
          >
            {copy.close}
          </button>
        </div>
      </Popover>
    </div>
  );
}
