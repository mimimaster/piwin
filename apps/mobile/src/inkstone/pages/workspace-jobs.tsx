import { useEffect, useRef, useState, type ReactElement } from 'react';
import { isJobTerminal, type HostPush, type JobLogChunk, type JobRecord } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Dot, FullButton, ScreenHeading } from '../inkstone-ui.js';
import { isObject, useHostQuery } from '../host/use-host-query.js';

const JOBS_COMMAND = { type: 'job/list' } as const;
const LOG_PAGE_BYTES = 48 * 1024;
const MAX_LOG_CHARS = 120_000;

/**
 * Workspace › 终端: the Host's managed processes, read-only. Remote PTY is
 * deliberately not offered (ADR 0013 / 0037); the phone reads logs through
 * `job/logs`, follows `job/log` pushes and can stop a running job.
 */
export function WorkspaceJobs({
  client,
  sessionId,
  onToast,
}: {
  client: HostClient | undefined;
  sessionId: string | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const jobs = useHostQuery(client, JOBS_COMMAND, readJobs);
  const [openJobId, setOpenJobId] = useState<string | undefined>();
  const [onlySession, setOnlySession] = useState(true);

  useEffect(() => {
    if (client === undefined) return undefined;
    return client.subscribePush((push: HostPush) => {
      if (push.type === 'job/started' || push.type === 'job/exited' || push.type === 'job/updated') {
        jobs.reload();
      }
    });
  }, [client, jobs.reload]);

  if (jobs.state.kind !== 'ready') {
    return (
      <p className={jobs.state.kind === 'error' ? 'error-text' : 'muted'}>
        {jobs.state.kind === 'error'
          ? jobs.state.message
          : jobs.state.kind === 'unsupported'
            ? '当前 Host 未开放进程列表。'
            : '正在读取 Host 进程…'}
      </p>
    );
  }
  const all = [...jobs.state.data].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const visible = onlySession && sessionId !== undefined ? all.filter((job) => job.ownerSessionId === sessionId) : all;
  const running = visible.filter((job) => !isJobTerminal(job.status)).length;

  return (
    <>
      <ScreenHeading title="Host 进程" subtitle={`${visible.length} 个 · ${running} 个运行中`} />
      <div className="chip-row">
        <button className="chip" type="button" aria-pressed={onlySession} onClick={() => setOnlySession(true)}>
          本会话
        </button>
        <button className="chip" type="button" aria-pressed={!onlySession} onClick={() => setOnlySession(false)}>
          全部
        </button>
      </div>
      {visible.length === 0 ? <p className="muted">这里还没有 Host 进程。Agent 运行命令后会出现在这里。</p> : null}
      <div className="job-list">
        {visible.slice(0, 40).map((job) => (
          <JobRow
            key={job.jobId}
            job={job}
            client={client}
            open={openJobId === job.jobId}
            onToggle={() => setOpenJobId(openJobId === job.jobId ? undefined : job.jobId)}
            onToast={onToast}
          />
        ))}
      </div>
      <p className="quote-note">这是只读快照：交互式终端只在桌面端。停止会结束 Host 上的进程。</p>
    </>
  );
}

function JobRow({
  job,
  client,
  open,
  onToggle,
  onToast,
}: {
  job: JobRecord;
  client: HostClient | undefined;
  open: boolean;
  onToggle: () => void;
  onToast: (message: string) => void;
}): ReactElement {
  const live = !isJobTerminal(job.status);
  const commandLine = job.argv.length >= 2 && job.argv[0] === '-c' ? job.argv[1] ?? job.command : [job.command, ...job.argv].join(' ');
  return (
    <div className="job-row">
      <button className="job-head" type="button" aria-expanded={open} onClick={onToggle}>
        <Dot status={live ? 'running' : job.status === 'exited' && (job.exitCode ?? 0) === 0 ? 'done' : 'failed'} />
        <code>{commandLine}</code>
        <span className="job-meta">{live ? '运行中' : job.exitCode !== undefined && job.exitCode !== null ? `退出 ${job.exitCode}` : statusLabel(job)}</span>
      </button>
      {open ? <JobLog job={job} client={client} onToast={onToast} /> : null}
    </div>
  );
}

function JobLog({
  job,
  client,
  onToast,
}: {
  job: JobRecord;
  client: HostClient | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const cursorRef = useRef(0);
  const live = !isJobTerminal(job.status);

  useEffect(() => {
    if (client === undefined) return undefined;
    let cancelled = false;
    cursorRef.current = 0;
    setText('');
    client
      .request({ type: 'job/logs', input: { jobId: job.jobId, afterCursor: 0, maxBytes: LOG_PAGE_BYTES } })
      .then((response) => {
        if (cancelled) return;
        const chunks = response.success ? readChunks(response.data) : undefined;
        if (chunks === undefined) {
          setError(response.success ? '无法识别的日志。' : response.error);
          return;
        }
        cursorRef.current = chunks.nextCursor;
        setText(appendLog('', chunks.chunks));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '读取日志失败。');
      });
    const unsubscribe = client.subscribePush((push: HostPush) => {
      if (push.type !== 'job/log' || push.chunk.jobId !== job.jobId || push.chunk.cursor <= cursorRef.current) return;
      cursorRef.current = push.chunk.cursor;
      setText((current) => appendLog(current, [push.chunk]));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, job.jobId]);

  const stop = (): void => {
    if (client === undefined) return;
    client
      .request({ type: 'job/stop', jobId: job.jobId, reason: 'user-stop' })
      .then((response) => onToast(response.success ? '已请求停止进程' : response.error))
      .catch((reason: unknown) => onToast(reason instanceof Error ? reason.message : '停止失败'));
  };

  return (
    <div className="job-log">
      <div className="job-facts">
        <span>{job.cwd}</span>
        <span>{job.startedAt.slice(11, 19)} 开始</span>
      </div>
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      <pre>
        {text.length > 0
          ? text
          : live
            ? '等待输出…'
            : job.latestLogCursor > 0
              ? 'Host 已不再保留这次的输出。对话里对应的工具行仍有结果快照。'
              : '没有输出。'}
      </pre>
      {live ? (
        <FullButton variant="secondary" onClick={stop}>
          停止进程
        </FullButton>
      ) : null}
    </div>
  );
}

function appendLog(current: string, chunks: readonly JobLogChunk[]): string {
  const next = current + chunks.map((chunk) => chunk.text).join('');
  return next.length > MAX_LOG_CHARS ? `…\n${next.slice(next.length - MAX_LOG_CHARS)}` : next;
}

function statusLabel(job: JobRecord): string {
  switch (job.status) {
    case 'cancelled':
      return '已停止';
    case 'failed':
      return '失败';
    case 'interrupted':
      return '中断';
    default:
      return '已结束';
  }
}

function readJobs(data: unknown): JobRecord[] | undefined {
  if (!isObject(data) || !Array.isArray(data.jobs)) return undefined;
  return data.jobs.filter(
    (job): job is JobRecord => isObject(job) && typeof job.jobId === 'string' && typeof job.status === 'string',
  );
}

function readChunks(data: unknown): { chunks: JobLogChunk[]; nextCursor: number } | undefined {
  if (!isObject(data) || !Array.isArray(data.chunks) || typeof data.nextCursor !== 'number') return undefined;
  return {
    chunks: data.chunks.filter((chunk): chunk is JobLogChunk => isObject(chunk) && typeof chunk.text === 'string'),
    nextCursor: data.nextCursor,
  };
}
