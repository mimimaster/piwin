import { useState, type ReactElement } from 'react';
import type { CronJob } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, IconButton, ListRow, ScreenHeading, SwitchRow, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { isObject, useHostQuery } from '../host/use-host-query.js';

const CRON_LIST = { type: 'cron/list' } as const;

type Draft = { id: string | undefined; name: string; schedule: string; promptText: string; projectPath: string };

const EMPTY_DRAFT: Draft = { id: undefined, name: '', schedule: '@daily', promptText: '', projectPath: '' };

/**
 * Host scheduled jobs (`cron/*`). The Host runs them; the phone lists, toggles,
 * runs now, deletes, and creates prompt jobs. Shell / HTTP jobs are shown but
 * only authored on the desktop.
 */
export function AutomationsPage(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const client = hostCtx?.host.client;
  const jobs = useHostQuery(client, CRON_LIST, readCronJobs);
  const [draft, setDraft] = useState<Draft | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  const toast = (message: string): void => dispatch({ type: 'toast', message });
  const run = (command: Parameters<HostClient['request']>[0], done: string): void => {
    if (client === undefined) return;
    client
      .request(command)
      .then((response) => {
        toast(response.success ? done : response.error);
        jobs.reload();
      })
      .catch((reason: unknown) => toast(reason instanceof Error ? reason.message : '操作失败'));
  };

  const save = (): void => {
    if (draft === undefined) return;
    const job = buildPromptJob(draft, jobs.state.kind === 'ready' ? jobs.state.data : []);
    if (typeof job === 'string') {
      toast(job);
      return;
    }
    run({ type: 'cron/upsert', job }, draft.id === undefined ? '已在 Host 上创建' : '已保存');
    setDraft(undefined);
  };

  return (
    <>
      <TopBar
        title="自动化"
        subtitle="Host · 定时任务"
        onBack={() => dispatch({ type: 'navigate', route: 'desk' })}
        right={<IconButton name="plus" label="新建自动化" onClick={() => setDraft({ ...EMPTY_DRAFT })} />}
      />
      <div className="screen-scroll">
        <ScreenHeading title="小事，按时发生。" subtitle="任务在 Host 上按计划运行，手机上可以随时改。" />
        {draft !== undefined ? (
          <div className="automation-form">
            <label className="field">
              名称
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="field">
              计划（cron 表达式，或 @hourly / @daily / @weekly）
              <input
                value={draft.schedule}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => setDraft({ ...draft, schedule: event.target.value })}
              />
            </label>
            <label className="field">
              让 Agent 做什么
              <textarea
                rows={3}
                value={draft.promptText}
                onChange={(event) => setDraft({ ...draft, promptText: event.target.value })}
              />
            </label>
            <label className="field">
              项目
              <select value={draft.projectPath} onChange={(event) => setDraft({ ...draft, projectPath: event.target.value })}>
                <option value="">一般会话</option>
                {hostCtx.host.projects.map((project) => (
                  <option key={project.projectId} value={project.path ?? project.projectId}>
                    {project.displayName}
                  </option>
                ))}
              </select>
            </label>
            <FullButton onClick={save}>{draft.id === undefined ? '在 Host 上创建' : '保存修改'}</FullButton>
            <FullButton variant="subtle" onClick={() => setDraft(undefined)}>
              取消
            </FullButton>
          </div>
        ) : null}
        {jobs.state.kind === 'ready' ? (
          jobs.state.data.length === 0 ? (
            <p className="muted">Host 还没有定时任务。点右上角 + 新建一个。</p>
          ) : (
            jobs.state.data.map((job) => (
              <div className="automation-row" key={job.id}>
                <SwitchRow
                  title={job.name}
                  subtitle={`${job.schedule} · ${JOB_KIND[job.type]}${job.lastStatus !== undefined ? ` · 上次${LAST[job.lastStatus]}` : ''}`}
                  checked={job.enabled}
                  onToggle={() =>
                    run({ type: 'cron/upsert', job: { ...job, enabled: !job.enabled } }, job.enabled ? '已暂停' : '已启用')
                  }
                />
                {job.lastError !== undefined ? <p className="error-text">{job.lastError}</p> : null}
                <div className="automation-actions">
                  <button className="chip" type="button" onClick={() => run({ type: 'cron/run', jobId: job.id }, '已让 Host 立即运行')}>
                    立即运行
                  </button>
                  {job.type === 'prompt' ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={() =>
                        setDraft({
                          id: job.id,
                          name: job.name,
                          schedule: job.schedule,
                          promptText: job.promptText ?? '',
                          projectPath: job.projectPath ?? '',
                        })
                      }
                    >
                      编辑
                    </button>
                  ) : null}
                  {confirmDelete === job.id ? (
                    <button
                      className="chip danger"
                      type="button"
                      onClick={() => {
                        setConfirmDelete(undefined);
                        run({ type: 'cron/delete', jobId: job.id }, '已删除');
                      }}
                    >
                      确认删除
                    </button>
                  ) : (
                    <button className="chip" type="button" onClick={() => setConfirmDelete(job.id)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))
          )
        ) : (
          <p className={jobs.state.kind === 'error' ? 'error-text' : 'muted'}>
            {jobs.state.kind === 'error'
              ? jobs.state.message
              : jobs.state.kind === 'unsupported'
                ? '当前 Host 未开放定时任务。'
                : '正在读取 Host 定时任务…'}
          </p>
        )}
        <ListRow
          name="sliders"
          title="自动化开关与 Hooks"
          subtitle="在设置 › Hooks 中打开或关闭"
          onClick={() => dispatch({ type: 'settings-section', section: 'Hooks' })}
        />
      </div>
    </>
  );
}

const JOB_KIND: Record<CronJob['type'], string> = { prompt: '让 Agent 做事', bash: '命令', http: '网络请求' };
const LAST: Record<NonNullable<CronJob['lastStatus']>, string> = { ok: '成功', error: '失败', skipped: '跳过' };

/** A prompt job the Host can run; returns an error message when the draft is incomplete. */
export function buildPromptJob(draft: Draft, existing: readonly CronJob[]): CronJob | string {
  const name = draft.name.trim();
  const schedule = draft.schedule.trim();
  const promptText = draft.promptText.trim();
  if (name.length === 0) return '先起个名字';
  if (schedule.length === 0) return '填写运行计划';
  if (promptText.length === 0) return '写下要让 Agent 做的事';
  const now = new Date().toISOString();
  const previous = existing.find((job) => job.id === draft.id);
  return {
    id: previous?.id ?? `mobile-${Date.now().toString(36)}`,
    name,
    enabled: previous?.enabled ?? true,
    schedule,
    type: 'prompt',
    promptText,
    ...(draft.projectPath.length > 0 ? { projectPath: draft.projectPath } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

function readCronJobs(data: unknown): CronJob[] | undefined {
  if (!isObject(data) || !Array.isArray(data.jobs)) return undefined;
  return data.jobs.filter(
    (job): job is CronJob =>
      isObject(job) && typeof job.id === 'string' && typeof job.name === 'string' && typeof job.enabled === 'boolean',
  );
}
