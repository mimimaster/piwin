/**
 * ActiveJobsStrip — 输入框上方的“正在控制的程序”动态条。
 *
 * 展示当前 session 中 agent 通过 `process_start` 启动且仍存活的 Job
 * （dev server / build / 后台命令）。数据由 App 层按 ownerSessionId 过滤，
 * 随 `job/started|updated|ready|exited` push 实时刷新；空闲时整条消失，
 * 不占用输入框布局高度。
 */
import { type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { JobRecord, JobStatus } from '@piwin/contracts';
import { IconClose } from './shell-icons';
import { getDesktopCopy } from './desktop-locale';

export type ActiveJobsStripProps = {
  /** 已按当前 session 过滤的活跃 Job（isJobActive）。 */
  jobs: readonly JobRecord[];
  /** 停止一个受控程序（`job/stop`）。 */
  onStop: (jobId: string) => void;
  /** 打开右侧 Terminal 面板并加载该 Job 的日志（`job/logs`）。 */
  onViewLogs: (jobId: string) => void;
  locale?: 'zh-CN' | 'en';
};

/** 状态点样式类：starting 脉冲灰 / running 脉冲蓝 / ready 常亮绿 / stopping 半透明。 */
export function jobStatusDotClass(status: JobStatus): string {
  switch (status) {
    case 'starting':
      return 'is-starting';
    case 'running':
      return 'is-running';
    case 'ready':
      return 'is-ready';
    case 'stopping':
      return 'is-stopping';
    default:
      return 'is-running';
  }
}

/**
 * Chip 主文本：优先 `label`（模型/用户起的名字，如 "dev server"），
 * 缺省回退为可读命令（`argv[0]` 基名，如 "vite"）。
 */
export function jobDisplayLabel(job: JobRecord): string {
  if (job.label && job.label.trim().length > 0) {
    return job.label.trim();
  }
  const executable = job.argv[0] ?? job.command;
  if (!executable) {
    return job.kind;
  }
  return executable.split('/').pop() ?? executable;
}

/**
 * 从 argv/label 启发式提取端口（如 `--port 5173`、`-p 8080`、`:3000`）。
 * `JobRecord` 不保存 readinessProbe，因此 UI 只能做展示性的启发式；
 * 提取不到返回 null（chip 只显示状态点 + 时长）。
 */
export function jobPortFromArgs(job: JobRecord): number | null {
  const tokens = [...job.argv, ...(job.label ? job.label.split(/\s+/) : [])];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    // Inline form: `--port=5173` / `-p=8080`.
    const inline = token.match(/^(?:--port|-p)=(\d{2,5})$/);
    if (inline && isValidJobPort(Number(inline[1]))) {
      return Number(inline[1]);
    }
    // Next-token form: `--port 5173` / `-p 8080`.
    if (token === '--port' || token === '-p') {
      const next = tokens[index + 1] ?? '';
      if (/^\d{2,5}$/.test(next) && isValidJobPort(Number(next))) {
        return Number(next);
      }
    }
    const bare = token.match(/^:(\d{2,5})$/);
    if (bare && isValidJobPort(Number(bare[1]))) {
      return Number(bare[1]);
    }
  }
  return null;
}

function isValidJobPort(port: number): boolean {
  return port >= 1024 && port <= 65535;
}

/** 运行时长展示：`45s` / `3m 12s`，与 context-bar 的格式保持一致。 */
export function formatJobElapsed(startedAt: string, now: number = Date.now()): string {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) {
    return '';
  }
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function ActiveJobsStrip(props: ActiveJobsStripProps): ReactElement | null {
  if (props.jobs.length === 0) {
    return null;
  }
  const reduced = useReducedMotion() ?? false;
  const copy = getDesktopCopy(props.locale ?? 'zh-CN').composer;
  return (
    <div className="composer-active-jobs-strip" data-testid="active-jobs-strip" role="status">
      <AnimatePresence initial={false}>
        {props.jobs.map((job) => {
          const port = jobPortFromArgs(job);
          const showPort = job.status === 'ready' && port !== null;
          const elapsed = formatJobElapsed(job.startedAt);
          const meta = showPort ? `:${port}` : elapsed;
          return (
            <motion.div
              key={job.jobId}
              className="composer-active-job"
              data-testid="active-job-chip"
              data-job-status={job.status}
              data-kind={job.kind}
              initial={reduced ? false : { opacity: 0, y: -4, scale: 0.98 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
              }
            >
              <button
                type="button"
                className="composer-active-job-main"
                title={copy.viewJobLogsTitle(jobDisplayLabel(job))}
                onClick={() => props.onViewLogs(job.jobId)}
              >
                <i
                  className={`composer-active-job-dot ${jobStatusDotClass(job.status)}`}
                  aria-hidden
                />
                <span className="composer-active-job-label">{jobDisplayLabel(job)}</span>
                {meta ? <span className="composer-active-job-meta muted">{meta}</span> : null}
              </button>
              <button
                type="button"
                className="composer-active-job-stop"
                data-testid="active-job-stop"
                aria-label={copy.stopJob}
                title={copy.stopJob}
                onClick={() => props.onStop(job.jobId)}
              >
                <IconClose width={11} height={11} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
