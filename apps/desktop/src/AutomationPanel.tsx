import { useCallback, useEffect, useState } from 'react';
import type {
  AutomationConfig,
  CronJob,
  HookDefinition,
  HostResponse,
  PiwinConfig,
} from '@piwin/contracts';
import { Button, Collapse, Notice, Spinner, Switch, IconButton } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import { FieldRow } from './settings/field-row';

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
    setError(null);
    const next: PiwinConfig = { ...config, automation: nextAuto };
    const response = await props.request({ type: 'config/set', config: next });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setConfig(next);
    setInfo(isChinese ? '自动化设置已保存。' : 'Automation settings saved.');
  }

  async function handleDeleteJob(jobId: string) {
    setError(null);
    const response = await props.request({ type: 'cron/delete', jobId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    void loadAll();
  }

  async function handleRunJob(jobId: string) {
    setInfo(isChinese ? '正在手动触发任务...' : 'Triggering job...');
    const response = await props.request({ type: 'cron/run', jobId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? '任务已触发。' : 'Job triggered.');
  }

  const enabled = config?.automation?.enabled === true;

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        {props.variant !== 'inline' ? (
          <PageTitle
            title={isChinese ? '自动化与脚本' : 'Automation & Hooks'}
            description={isChinese ? '配置定时任务与事件钩子以自动化您的工作流。' : 'Configure scheduled jobs and event hooks to automate your workflow.'}
          />
        ) : null}

        <div className="settings-section">
          <FieldRow
            label={isChinese ? '启用自动化' : 'Enable Automation'}
            description={isChinese ? '开启 Cron 调度与事件钩子。' : 'Enable Cron scheduling and event hooks.'}
          >
            <Switch
              checked={enabled}
              onCheckedChange={(checked) =>
                void saveAutomation({ ...config?.automation, enabled: checked } as any)
              }
              aria-label={isChinese ? '启用自动化' : 'Enable Automation'}
            />
          </FieldRow>
        </div>

        <Collapse expanded={enabled} className="settings-collapsible">
          <div className="settings-section">
            <PageTitle
              title={isChinese ? '定时任务 (Cron)' : 'Scheduled Jobs (Cron)'}
            />
            <ul className="ext-list">
              {jobs.length === 0 ? (
                <li className="muted" style={{ textAlign: 'center', padding: '24px' }}>{isChinese ? '暂无定时任务' : 'No scheduled jobs'}</li>
              ) : (
                jobs.map((job) => (
                  <li key={job.id} className="ext-list-item">
                    <div className="ext-list-main">
                      <div className="ext-list-title">
                        <strong>{job.name}</strong>
                        <span className="pill">{job.schedule}</span>
                      </div>
                      <div className="muted ext-desc">{job.promptText}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Button size="compact" variant="ghost" onClick={() => void handleRunJob(job.id)}>{isChinese ? '运行' : 'Run'}</Button>
                      <IconButton
                        label={common.delete}
                        onClick={() => void handleDeleteJob(job.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3 4h10M6 4V2.75h4V4M5 6.25v5.5M8 6.25v5.5M11 6.25v5.5M4 4l.5 9h7l.5-9" />
                        </svg>
                      </IconButton>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="settings-section">
            <PageTitle
              title={isChinese ? '事件钩子 (Hooks)' : 'Event Hooks'}
              description={isChinese ? '在特定事件发生时执行本地命令。' : 'Execute local commands when specific events occur.'}
            />
            <ul className="ext-list">
              {hooks.length === 0 ? (
                <li className="muted" style={{ textAlign: 'center', padding: '24px' }}>{isChinese ? '暂无钩子' : 'No hooks configured'}</li>
              ) : (
                hooks.map((hook, idx) => (
                  <li key={idx} className="ext-list-item">
                    <div className="ext-list-main">
                      <div className="ext-list-title">
                        <strong>{hook.event}</strong>
                      </div>
                      <div className="muted ext-desc"><code>{hook.action.type === 'shell' ? `${hook.action.command} ${hook.action.args?.join(' ') ?? ''}` : hook.action.url}</code></div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </Collapse>

        {loading && <div style={{ textAlign: 'center', padding: '20px' }}><Spinner /></div>}
        {(error || info) ? (
          <div className="ui-feedback-host" aria-live="polite">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {info ? <Notice tone="info">{info}</Notice> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
