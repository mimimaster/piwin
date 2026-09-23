/**
 * Settings → Hooks. Surfaces Pi extension intercepts (`pi.on`) plus
 * user-configured post-event hooks, the way other coding agents expose them.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  AutomationConfig,
  ExtensionSummary,
  HookDefinition,
  HookEventName,
  PiwinConfig,
} from '@piwin/contracts';
import { Button, IconButton, Notice, Select, Spinner, Switch, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import {
  hooksArmedEffectMessage,
  hooksSavedEffectMessage,
} from '../../settings-effect-copy.js';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';
import {
  USER_HOOK_EVENTS,
  createUserHook,
  formatHookAction,
  isHooksArmed,
  removeHook,
  replaceHook,
} from './hooks-page-model';

function eventLabel(event: string, isChinese: boolean): string {
  switch (event) {
    case 'agent_start':
      return isChinese ? '会话开始' : 'Agent start';
    case 'agent_end':
      return isChinese ? '会话结束' : 'Agent end';
    case 'turn_start':
      return isChinese ? '一轮问答开始' : 'Turn start';
    case 'turn_end':
      return isChinese ? '一轮问答结束' : 'Turn end';
    case 'tool_execution_end':
      return isChinese ? '工具执行后' : 'After tool';
    case 'tool_call':
      return isChinese ? '工具调用（可拦截）' : 'Tool call (can block)';
    case 'session_start':
      return isChinese ? '会话启动' : 'Session start';
    default:
      return event;
  }
}

export function HooksPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const settings = useSettings();
  const {
    config,
    saveConfig,
    projectPath,
    requestAutomation,
    requestExtensions,
    selectSection,
  } = settings;
  const hooksAvailable = settingsHostSupportsCommand(settings, 'hooks/list');

  const [hooks, setHooks] = useState<HookDefinition[]>([]);
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [draftEvent, setDraftEvent] = useState<HookEventName>('turn_end');
  const [draftActionType, setDraftActionType] = useState<'shell' | 'http'>('shell');
  const [draftCommand, setDraftCommand] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const hooksRes = await requestAutomation({ type: 'hooks/list' });
    if (hooksRes.success) {
      const data = hooksRes.data as { hooks?: HookDefinition[] };
      setHooks(data.hooks ?? []);
    } else {
      setError(hooksRes.error);
    }
    const listCommand: { type: 'extensions/list'; projectPath?: string } = {
      type: 'extensions/list',
    };
    if (projectPath) {
      listCommand.projectPath = projectPath;
    }
    const extRes = await requestExtensions(listCommand);
    if (extRes.success) {
      const data = extRes.data as { extensions?: ExtensionSummary[] };
      setExtensions(data.extensions ?? []);
    }
    setLoading(false);
  }, [projectPath, requestAutomation, requestExtensions]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const armed = isHooksArmed(config?.automation);
  const intercepts = extensions.filter(
    (extension) => (extension.hookEvents ?? []).length > 0,
  );
  const visionEnabled = config?.visionDelegation?.enabled === true;

  async function persistHooks(next: HookDefinition[]): Promise<boolean> {
    setSaving(true);
    setError(null);
    setInfo(null);
    const response = await requestAutomation({ type: 'hooks/set', hooks: next });
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return false;
    }
    setHooks(next);
    setInfo(hooksSavedEffectMessage(locale, armed));
    return true;
  }

  async function armHooks(checked: boolean): Promise<void> {
    if (!config) return;
    setError(null);
    setInfo(null);
    const previous = config.automation;
    const automation: AutomationConfig = { hooksEnabled: checked };
    if (checked || previous?.enabled === true) {
      automation.enabled = true;
    } else if (previous?.enabled === false) {
      automation.enabled = false;
    }
    if (previous?.cronEnabled !== undefined) {
      automation.cronEnabled = previous.cronEnabled;
    }
    const next: PiwinConfig = { ...config, automation };
    const ok = await saveConfig(next);
    if (ok) {
      setInfo(hooksArmedEffectMessage(locale, checked));
    }
  }

  async function handleAdd(): Promise<void> {
    const created = createUserHook({
      event: draftEvent,
      actionType: draftActionType,
      commandOrUrl: draftCommand,
    });
    if (!created) {
      setError(isChinese ? '请填写命令或 URL。' : 'Enter a command or URL.');
      return;
    }
    const ok = await persistHooks([...hooks, created]);
    if (ok) {
      setDraftCommand('');
    }
  }

  if (!hooksAvailable) {
    return (
      <div className="settings-card" data-testid="settings-hooks">
        <p className="muted">
          {isChinese
            ? '当前 Host 没有开放 Hooks 命令。'
            : 'This Host does not advertise Hooks commands.'}
        </p>
      </div>
    );
  }

  return (
    <div className="settings-card" data-testid="settings-hooks">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? (
        <Notice tone="info" testId="settings-hooks-info">
          {info}
        </Notice>
      ) : null}

      <div className="settings-section settings-section-card">
        <FieldRow
          label={isChinese ? '启用事件钩子' : 'Enable event hooks'}
          description={
            isChinese
              ? '启用后，下方配置的 Shell / HTTP 钩子才会在所选时机执行，例如一轮问答开始或结束。扩展拦截不受此开关控制。'
              : 'When enabled, the shell and HTTP hooks configured below will run at the selected moments, such as the start or end of a conversation turn. Extension intercepts are not controlled by this switch.'
          }
        >
          <Switch
            checked={armed}
            onCheckedChange={(checked) => void armHooks(checked)}
            aria-label={isChinese ? '启用事件钩子' : 'Enable event hooks'}
            testId="hooks-arm-switch"
          />
        </FieldRow>
        {!armed && hooks.length > 0 ? (
          <Notice tone="warning">
            {isChinese
              ? '钩子配置已保存，但事件钩子尚未启用，因此不会在选定时机执行。'
              : 'Hook configuration has been saved, but event hooks are not enabled, so they will not run at the selected moments.'}
          </Notice>
        ) : null}
      </div>

      <div className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '扩展拦截' : 'Extension intercepts'}
          description={
            isChinese
              ? '已安装扩展中检测到的事件钩子（仅作展示，不会主动执行扩展代码）。'
              : 'pi.on events detected in installed extension source. Modules are not executed.'
          }
        />
        <ul className="ext-list">
          {intercepts.length === 0 ? (
            <li className="muted" style={{ textAlign: 'center', padding: '24px' }}>
              {isChinese ? '已安装扩展没有注册 Hook。' : 'No installed extension registers a hook.'}
            </li>
          ) : (
            intercepts.map((extension) => (
              <li key={extension.id} className="ext-list-item" data-testid={`hook-ext-${extension.id}`}>
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{extension.name}</strong>
                    {(extension.hookEvents ?? []).map((event) => (
                      <span key={event} className="pill">
                        {event}
                      </span>
                    ))}
                    <span className="pill">{extension.enabled ? (isChinese ? '开' : 'On') : isChinese ? '关' : 'Off'}</span>
                  </div>
                  <div className="muted ext-desc">{extension.description}</div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '相关拦截' : 'Related intercepts'}
          description={
            isChinese
              ? '当主模型不支持视觉能力时，视觉委托将在发送提示前自动调用视觉模型生成图片描述。'
              : 'When the primary model cannot see pixels, vision delegation describes images before the prompt is sent.'
          }
        />
        <ul className="ext-list">
          <li className="ext-list-item" data-testid="hook-related-vision">
            <div className="ext-list-main">
              <div className="ext-list-title">
                <strong>{isChinese ? '视觉委托' : 'Vision delegation'}</strong>
                <span className="pill">{visionEnabled ? (isChinese ? '开' : 'On') : isChinese ? '关' : 'Off'}</span>
              </div>
              <div className="muted ext-desc">
                {isChinese ? '在提示准备阶段自动转换图片附件' : 'Prompt-prep intercept for image attachments'}
              </div>
            </div>
            <Button size="compact" variant="ghost" onClick={() => selectSection('models')}>
              {isChinese ? '去模型配置' : 'Open Models'}
            </Button>
          </li>
        </ul>
      </div>

      <div className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '事件钩子' : 'Event hooks'}
          description={
            isChinese
              ? '在一轮问答结束后运行本地命令或发送 HTTP 请求。这些钩子不会拦截工具，也不能替代权限规则。'
              : 'Run a local command or HTTP request after a conversation turn. These never block tools and are not a permission policy.'
          }
        />
        <div
          className="settings-section"
          data-testid="hooks-add-form"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          <Select
            value={draftEvent}
            onChange={(event) => setDraftEvent(event.currentTarget.value as HookEventName)}
            data={USER_HOOK_EVENTS.map((event) => ({
              value: event,
              label: `${eventLabel(event, isChinese)} · ${event}`,
            }))}
            aria-label={isChinese ? '钩子事件' : 'Hook event'}
          />
          <Select
            value={draftActionType}
            onChange={(event) => setDraftActionType(event.currentTarget.value as 'shell' | 'http')}
            data={[
              { value: 'shell', label: 'shell' },
              { value: 'http', label: 'http' },
            ]}
            aria-label={isChinese ? '钩子动作' : 'Hook action'}
          />
          <TextInput
            value={draftCommand}
            onChange={(event) => setDraftCommand(event.currentTarget.value)}
            placeholder={draftActionType === 'http' ? 'https://…' : isChinese ? '命令，例如 echo done' : 'command, e.g. echo done'}
            aria-label={isChinese ? '钩子命令' : 'Hook command'}
            testId="hooks-add-command"
          />
          <Button size="compact" onClick={() => void handleAdd()} disabled={saving}>
            {isChinese ? '添加钩子' : 'Add hook'}
          </Button>
        </div>
        <ul className="ext-list">
          {hooks.length === 0 ? (
            <li className="muted" style={{ textAlign: 'center', padding: '24px' }}>
              {isChinese ? '还没有事件钩子' : 'No event hooks configured'}
            </li>
          ) : (
            hooks.map((hook) => (
              <li key={hook.id} className="ext-list-item" data-testid={`hook-user-${hook.id}`}>
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{eventLabel(hook.event, isChinese)}</strong>
                    <span className="pill">{hook.event}</span>
                    <span className="pill">{hook.action.type}</span>
                  </div>
                  <div className="muted ext-desc">
                    <code>{formatHookAction(hook.action)}</code>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Switch
                    checked={hook.enabled}
                    onCheckedChange={(checked) =>
                      void persistHooks(replaceHook(hooks, hook.id, { enabled: checked }))
                    }
                    aria-label={isChinese ? `启用 ${hook.id}` : `Enable ${hook.id}`}
                  />
                  <IconButton
                    label={isChinese ? '删除钩子' : 'Delete hook'}
                    onClick={() => void persistHooks(removeHook(hooks, hook.id))}
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}
