/**
 * Terminal tab switcher: interactive zsh plus one chip per live job so
 * process_start / nohup work is reachable without a second scheduler.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import type { JobRecord } from '@piwin/contracts';
import {
  jobDisplayLabel,
  jobPortFromArgs,
  jobStatusDotClass,
} from './active-jobs-strip';
import { composerActivityCopy } from './composer-activity-copy.js';
import type { ComposerActivityLocale } from './composer-activity-model.js';
import { useDesktopLocale } from './desktop-locale-context';
import { IconClose } from './shell-icons';

export type TerminalJobMonitorProps = {
  jobs: readonly JobRecord[];
  selectedJobId: string | null;
  logsById: Record<string, string>;
  onSelectJob: (jobId: string) => void;
  onSelectPty: () => void;
  onStopJob: (jobId: string) => void;
  children: ReactNode;
  locale?: ComposerActivityLocale | undefined;
};

function jobChipMeta(job: JobRecord): string | null {
  const port = jobPortFromArgs(job);
  if (job.status === 'ready' && port !== null) {
    return `:${port}`;
  }
  return null;
}

export function TerminalJobMonitor(props: TerminalJobMonitorProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const locale = props.locale ?? contextLocale;
  const copy = composerActivityCopy(locale);
  const logRef = useRef<HTMLPreElement | null>(null);
  const selectedJob =
    props.selectedJobId === null
      ? undefined
      : props.jobs.find((job) => job.jobId === props.selectedJobId);
  const selectedJobId = props.selectedJobId;
  const showingJob = selectedJobId !== null;
  const showSwitcher = props.jobs.length > 0 || showingJob;
  const logText = selectedJobId !== null ? (props.logsById[selectedJobId] ?? '') : '';

  useEffect(() => {
    const node = logRef.current;
    if (!showingJob || node === null) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [showingJob, logText]);

  return (
    <div className="terminal-job-monitor" data-testid="terminal-job-monitor">
      {showSwitcher ? (
        <div className="terminal-job-switcher" data-testid="terminal-job-switcher" role="tablist">
          <button
            type="button"
            className={
              showingJob ? 'terminal-job-chip' : 'terminal-job-chip is-selected'
            }
            data-testid="terminal-job-zsh"
            aria-selected={!showingJob}
            role="tab"
            onClick={props.onSelectPty}
          >
            <span className="terminal-job-chip-label">{copy.zsh}</span>
          </button>
          {props.jobs.map((job) => {
            const meta = jobChipMeta(job);
            const selected = job.jobId === selectedJobId;
            return (
              <button
                key={job.jobId}
                type="button"
                className={selected ? 'terminal-job-chip is-selected' : 'terminal-job-chip'}
                data-testid="terminal-job-chip"
                data-job-id={job.jobId}
                aria-selected={selected}
                role="tab"
                onClick={() => props.onSelectJob(job.jobId)}
              >
                <i
                  className={`composer-active-job-dot ${jobStatusDotClass(job.status)}`}
                  aria-hidden
                />
                <span className="terminal-job-chip-label">{jobDisplayLabel(job)}</span>
                {meta ? <span className="terminal-job-chip-meta">{meta}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className="terminal-job-pty"
        data-testid="terminal-job-pty"
        hidden={showingJob}
      >
        {props.children}
      </div>
      {selectedJobId !== null ? (
        <div className="terminal-job-log-pane" data-testid="terminal-job-log-pane">
          <div className="terminal-job-log-toolbar">
            <span className="terminal-job-log-title">
              {selectedJob ? jobDisplayLabel(selectedJob) : selectedJobId}
            </span>
            <button
              type="button"
              className="terminal-job-log-stop"
              data-testid="terminal-job-log-stop"
              aria-label={copy.stop}
              title={copy.stop}
              onClick={() => {
                props.onStopJob(selectedJobId);
              }}
            >
              <IconClose width={11} height={11} />
            </button>
          </div>
          <pre
            ref={logRef}
            className="terminal-job-log"
            data-testid="terminal-job-log"
          >
            {logText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
