/**
 * Settings → System → Automation: enable toggles, cron list/run, hooks list/edit.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AutomationConfig,
  CronJob,
  HookDefinition,
  HostResponse,
  PiwinConfig,
} from '@piwin/contracts';
import { createDefaultAutomationConfig } from '@piwin/contracts';
import { Button, Field, FieldCheckbox, Notice, EmptyState, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type AutomationPanelProps = {
  projectPath: string | null;
  request: (command: {
    type:
      | 'config/get'
      | 'config/set'
      | 'cron/list'
      | 'cron/upsert'
      | 'cron/delete'
      | 'cron/run'
      | 'hooks/list'
      | 'hooks/set';
    config?: PiwinConfig;
    job?: CronJob;
    jobId?: string;
    hooks?: HookDefinition[];
  }) => Promise<HostResponse>;
  variant?: 'inline' | 'modal';
};

function newCronId(): string {
  return `cron-${Date.now().toString(36)}`;
}

export function AutomationPanel(props: AutomationPanelProps) {
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [hooks, setHooks] = useState<HookDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cronName, setCronName] = useState('');
  const [cronSchedule, setCronSchedule] = useState('every:1m');
  const [cronPrompt, setCronPrompt] = useState('');
  const [hookEvent, setHookEvent] = useState<HookDefinition['event']>('turn_end');
  const [hookCommand, setHookCommand] = useState('echo');
  const [hookArgs, setHookArgs] = useState('piwin-hook');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cfgRes = await props.request({ type: 'config/get' });
    if (!cfgRes.success) {
      setError(cfgRes.error);
      setLoading(false);
      return;
    }
    const cfgData = cfgRes.data as { config: PiwinConfig };
    setConfig(cfgData.config);

    const cronRes = await props.request({ type: 'cron/list' });
    if (cronRes.success) {
      const data = cronRes.data as { jobs?: CronJob[] };
      setJobs(data.jobs ?? []);
    }

    const hooksRes = await props.request({ type: 'hooks/list' });
    if (hooksRes.success) {
      const data = hooksRes.data as { hooks?: HookDefinition[] };
      setHooks(data.hooks ?? []);
    }
    setLoading(false);
  }, [props]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function saveAutomation(nextAuto: AutomationConfig): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    const next: PiwinConfig = { ...config, automation: nextAuto };
    const response = await props.request({ type: 'config/set', config: next });
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setConfig(next);
    setInfo(isChinese ? '自动化设置已保存。' : 'Automation settings saved.');
  }

  async function handleAddCron(): Promise<void> {
    setError(null);
    setInfo(null);
    const name = cronName.trim() || (isChinese ? '未命名' : 'untitled');
    const promptText = cronPrompt.trim();
    if (!promptText) {
      setError(isChinese ? '必须填写提示文本。' : 'Prompt text is required.');
      return;
    }
    const now = new Date().toISOString();
    const job: CronJob = {
      id: newCronId(),
      name,
      enabled: true,
      schedule: cronSchedule.trim() || 'every:1m',
      type: 'prompt',
      promptText,
      createdAt: now,
      updatedAt: now,
      ...(props.projectPath ? { projectPath: props.projectPath } : {}),
    };
    const response = await props.request({ type: 'cron/upsert', job });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setCronName('');
    setCronPrompt('');
    setInfo(isChinese ? `已保存 Cron 任务 ${job.id}` : `Cron job ${job.id} saved`);
    await loadAll();
  }

  async function handleRunCron(jobId: string): Promise<void> {
    setError(null);
    const response = await props.request({ type: 'cron/run', jobId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { ok?: boolean; message?: string };
    setInfo(
      data.ok
        ? isChinese
          ? `已运行 ${jobId}：${data.message ?? 'ok'}`
          : `Ran ${jobId}: ${data.message ?? 'ok'}`
        : isChinese
          ? `失败：${data.message}`
          : `Failed: ${data.message}`,
    );
    await loadAll();
  }

  async function handleDeleteCron(jobId: string): Promise<void> {
    const response = await props.request({ type: 'cron/delete', jobId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadAll();
  }

  async function handleAddHook(): Promise<void> {
    const command = hookCommand.trim();
    if (!command) {
      setError(isChinese ? '必须填写 Hook 命令。' : 'Hook command required.');
      return;
    }
    const nextHooks: HookDefinition[] = [
      ...hooks,
      {
        id: `hook-${Date.now().toString(36)}`,
        enabled: true,
        event: hookEvent,
        action: {
          type: 'shell',
          command,
          args: hookArgs
            .split(/\s+/)
            .map((item) => item.trim())
            .filter(Boolean),
        },
      },
    ];
    const response = await props.request({ type: 'hooks/set', hooks: nextHooks });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? 'Hooks 已保存。' : 'Hooks saved.');
    await loadAll();
  }

  async function handleRemoveHook(hookId: string): Promise<void> {
    const nextHooks = hooks.filter((hook) => hook.id !== hookId);
    const response = await props.request({ type: 'hooks/set', hooks: nextHooks });
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadAll();
  }

  const automation = config?.automation ?? createDefaultAutomationConfig();
  const enabled = automation.enabled === true;

  return (
    <div
      className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}
      data-testid="automation-panel"
    >
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>{isChinese ? '自动化' : 'Automation'}</h3>
        <p className="muted">
          {isChinese ? (
            <>本地 Cron（提示任务）和<strong>仅后事件 Hooks</strong>（不包含 PreToolUse 策略）。默认关闭，请显式启用。</>
          ) : (
            <>Local cron (prompt jobs) and <strong>post-event hooks only</strong> (no PreToolUse policy). Disabled by default — enable explicitly.</>
          )}
        </p>
        <Notice tone="info" testId="automation-host-banner" title={isChinese ? '需要 Host' : 'Host required'}>
          {isChinese ? 'Cron 和 Hooks 仅在桌面 Host 进程运行时执行，没有后台守护进程。' : 'Cron and hooks run only while the desktop host process is up — there is no background daemon.'}
        </Notice>
        <Notice tone="warning" testId="automation-todo-banner" title={isChinese ? '测试版' : 'Beta'}>
          {isChinese ? '会话 Todo 工具仍属实验性功能：IPC 存储已就绪，但模型工具与执行清单尚未完全接通。' : 'Session Todo tool is experimental: IPC store exists; model tool + Execution checklist are not fully wired.'}
        </Notice>
        {loading ? <div className="panel-loading"><Spinner label={isChinese ? '正在加载自动化' : 'Loading automation'} /><span className="muted">{common.loading}</span></div> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <div className="settings-section">
          <h4>{isChinese ? '主开关' : 'Master switches'}</h4>
          <FieldCheckbox
            label={isChinese ? '启用自动化' : 'Enable automation'}
            description={isChinese ? '主开关。默认关闭，请显式启用。' : 'Master switch. Disabled by default — enable explicitly.'}
            checked={enabled}
            disabled={saving || !config}
            testId="automation-enabled"
            onCheckedChange={(checked) =>
              void saveAutomation({
                ...automation,
                enabled: checked,
              })
            }
          />
          <FieldCheckbox
            label={isChinese ? '启用 Cron' : 'Cron enabled'}
            description={isChinese ? '在桌面 Host 进程运行时执行提示任务' : 'Prompt jobs while the desktop host process is running'}
            checked={automation.cronEnabled !== false}
            disabled={saving || !config || !enabled}
            testId="automation-cron-enabled"
            onCheckedChange={(checked) =>
              void saveAutomation({
                ...automation,
                enabled: true,
                cronEnabled: checked,
              })
            }
          />
          <FieldCheckbox
            label={isChinese ? '启用 Hooks' : 'Hooks enabled'}
            description={isChinese ? '仅后事件 Hooks（不是 PreToolUse 权限门）' : 'Post-event hooks only (not a PreToolUse permission gate)'}
            checked={automation.hooksEnabled !== false}
            disabled={saving || !config || !enabled}
            testId="automation-hooks-enabled"
            onCheckedChange={(checked) =>
              void saveAutomation({
                ...automation,
                enabled: true,
                hooksEnabled: checked,
              })
            }
          />
        </div>

        <div className="settings-section">
          <h4>{isChinese ? 'Cron 任务（提示）' : 'Cron jobs (prompt)'}</h4>
          <p className="muted">
            {isChinese ? <>计划：<code>every:30s</code>、<code>every:1m</code>、<code>@hourly</code>、<code>@daily</code>。使用“运行”可立即触发。</> : <>Schedules: <code>every:30s</code>, <code>every:1m</code>, <code>@hourly</code>, <code>@daily</code>. Use Run to fire immediately.</>}
          </p>
          {!props.projectPath ? (
            <p className="muted">{isChinese ? '请打开项目，以便新提示任务绑定 projectPath。' : 'Open a project so new prompt jobs bind a projectPath.'}</p>
          ) : null}
          <Field label={isChinese ? '名称' : 'Name'} required>
            <input
              data-testid="cron-name-input"
              value={cronName}
              onChange={(event) => setCronName(event.target.value)}
              placeholder={isChinese ? '夜间检查' : 'nightly review'}
            />
          </Field>
          <Field label={isChinese ? '计划' : 'Schedule'} description="every:30s, every:1m, @hourly, @daily">
            <input
              data-testid="cron-schedule-input"
              value={cronSchedule}
              onChange={(event) => setCronSchedule(event.target.value)}
            />
          </Field>
          <Field label={isChinese ? '提示' : 'Prompt'} required>
            <textarea
              rows={2}
              data-testid="cron-prompt-input"
              value={cronPrompt}
              onChange={(event) => setCronPrompt(event.target.value)}
              placeholder={isChinese ? '总结 Git 状态和待处理问题' : 'Summarize git status and open issues'}
            />
          </Field>
          <Button
            variant="primary"
            data-testid="cron-add-btn"
            disabled={!enabled}
            onClick={() => void handleAddCron()}
          >
            {isChinese ? '添加 Cron 任务' : 'Add cron job'}
          </Button>
          <ul className="ext-list" data-testid="cron-job-list">
            {jobs.length === 0 ? (
              <li><EmptyState title={isChinese ? '暂无 Cron 任务' : 'No cron jobs'} description={isChinese ? '在上方添加提示任务。计划运行期间 Host 必须保持运行。' : 'Add a prompt job above. Host must stay running for schedules.'} testId="cron-empty" /></li>
            ) : (
              jobs.map((job) => (
                <li key={job.id} className="ext-list-item" data-testid="cron-job-item">
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{job.name}</strong>
                      <span className="pill">{job.schedule}</span>
                      <span className="pill">{job.enabled ? (isChinese ? '开启' : 'on') : (isChinese ? '关闭' : 'off')}</span>
                      {job.lastStatus ? <span className="pill">{job.lastStatus}</span> : null}
                    </div>
                    <div className="muted ext-desc">{job.promptText ?? job.type}</div>
                    {job.lastError ? <Notice tone="error">{job.lastError}</Notice> : null}
                  </div>
                  <div className="settings-inline-actions">
                    <Button
                      data-testid="cron-run-btn"
                      onClick={() => void handleRunCron(job.id)}
                    >
                      {isChinese ? '运行' : 'Run'}
                    </Button>
                    <Button onClick={() => void handleDeleteCron(job.id)}>
                      {common.delete}
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="settings-section">
          <h4>{isChinese ? 'Hooks' : 'Hooks'}</h4>
          <p className="muted" data-testid="hooks-post-event-note">
            {isChinese ? '仅后事件（agent/turn/tool end）。不是 PreToolUse 权限门。' : 'Post-event only (agent/turn/tool end). Not a PreToolUse permission gate.'}
          </p>
          <p className="muted">
            {isChinese ? <>Shell Hooks 会接收 <code>PIWIN_SESSION_ID</code>、<code>PIWIN_PROJECT_PATH</code>、<code>PIWIN_EVENT_JSON</code>。启用自动化后，Host 将激活匹配的 Hooks。</> : <>Shell hooks receive <code>PIWIN_SESSION_ID</code>, <code>PIWIN_PROJECT_PATH</code>, <code>PIWIN_EVENT_JSON</code>. Host arms matching hooks when automation is enabled.</>}
          </p>
          <Field label={isChinese ? '事件' : 'Event'}>
            <select
              data-testid="hook-event-select"
              value={hookEvent}
              onChange={(event) => setHookEvent(event.target.value as HookDefinition['event'])}
            >
              <option value="agent_start">agent_start</option>
              <option value="agent_end">agent_end</option>
              <option value="turn_start">turn_start</option>
              <option value="turn_end">turn_end</option>
              <option value="tool_execution_end">tool_execution_end</option>
            </select>
          </Field>
          <Field label={isChinese ? '命令' : 'Command'} required>
            <input
              data-testid="hook-command-input"
              value={hookCommand}
              onChange={(event) => setHookCommand(event.target.value)}
            />
          </Field>
          <Field label={isChinese ? '参数' : 'Args'} description={isChinese ? '以空格分隔' : 'Space-separated'}>
            <input
              data-testid="hook-args-input"
              value={hookArgs}
              onChange={(event) => setHookArgs(event.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            data-testid="hook-add-btn"
            disabled={!enabled}
            onClick={() => void handleAddHook()}
          >
            {isChinese ? '添加 Hook' : 'Add hook'}
          </Button>
          <ul className="ext-list" data-testid="hook-list">
            {hooks.length === 0 ? (
              <li className="muted">{isChinese ? '暂无 Hooks' : 'No hooks'}</li>
            ) : (
              hooks.map((hook) => (
                <li key={hook.id} className="ext-list-item" data-testid="hook-item">
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{hook.event}</strong>
                      <span className="pill">{hook.action.type}</span>
                      <span className="pill">{hook.enabled ? (isChinese ? '开启' : 'on') : (isChinese ? '关闭' : 'off')}</span>
                    </div>
                    <div className="muted ext-desc">
                      {hook.action.type === 'shell'
                        ? `${hook.action.command} ${(hook.action.args ?? []).join(' ')}`
                        : hook.action.url}
                    </div>
                  </div>
                  <Button onClick={() => void handleRemoveHook(hook.id)}>
                    {common.remove}
                  </Button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
