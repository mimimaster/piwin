/**
 * Scope bindings (Global / Current Project / Current Session) and live effective preview.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Select } from '@piwin/ui-kit';
import {
  createDefaultSystemPromptsConfig,
  formatError,
  readBuiltinSystemPromptValue,
  resolveActiveSystemPromptSelection,
  SYSTEM_PROMPT_BUILTIN_ID,
  SYSTEM_PROMPT_INHERIT_ID,
  type PiwinConfig,
  type SessionSummary,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';

function sourceLabel(
  kind: ReturnType<typeof resolveActiveSystemPromptSelection>['sourceKind'],
  presetName: string | undefined,
  isZh: boolean,
): string {
  switch (kind) {
    case 'session-preset':
      return isZh ? `当前会话预设：${presetName ?? ''}` : `Session preset: ${presetName ?? ''}`;
    case 'session-builtin':
      return isZh ? '当前会话强制使用系统默认' : 'Session forced built-in default';
    case 'project-preset':
      return isZh ? `当前项目预设：${presetName ?? ''}` : `Project preset: ${presetName ?? ''}`;
    case 'project-builtin':
      return isZh ? '当前项目强制使用系统默认' : 'Project forced built-in default';
    case 'global-preset':
      return isZh ? `全局默认预设：${presetName ?? ''}` : `Global preset: ${presetName ?? ''}`;
    case 'builtin':
      return isZh ? '系统默认提示词' : 'System built-in default';
  }
}

export function SystemPromptsScopeCard(): ReactElement {
  const { config, projectPath, activeSessionId, request, hostClient, saveConfig, setError, setInfo } =
    useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [sessionPresetId, setSessionPresetId] = useState<string>(SYSTEM_PROMPT_INHERIT_ID);
  const [savingSession, setSavingSession] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!activeSessionId) {
      setSessionPresetId(SYSTEM_PROMPT_INHERIT_ID);
      return;
    }
    let cancelled = false;
    void request({ type: 'session/list', allScopes: true, maxItems: 200 })
      .then((response) => {
        if (cancelled || !response.success) return;
        const sessions = (response.data as { sessions?: SessionSummary[] } | undefined)?.sessions ?? [];
        const current = sessions.find((item) => item.id === activeSessionId);
        setSessionPresetId(current?.systemPromptPresetId ?? SYSTEM_PROMPT_INHERIT_ID);
      })
      .catch(() => {
        // Best-effort restore; keep inherit when session list is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, request]);

  const systemPrompts = config?.systemPrompts ?? createDefaultSystemPromptsConfig();
  const presets = systemPrompts.presets;
  const globalSelection = systemPrompts.defaultPresetId ?? SYSTEM_PROMPT_BUILTIN_ID;
  const projectSelection =
    projectPath ? (systemPrompts.projectPresetIds?.[projectPath] ?? SYSTEM_PROMPT_INHERIT_ID) : SYSTEM_PROMPT_INHERIT_ID;

  const effective = useMemo(() => {
    const resolved = resolveActiveSystemPromptSelection({
      config,
      projectPath,
      sessionPresetId: activeSessionId ? sessionPresetId : undefined,
    });
    const agentBase = readBuiltinSystemPromptValue(config, 'agent.default').effectiveContent;
    const chatBase = readBuiltinSystemPromptValue(config, 'conversation.chat').effectiveContent;
    const baseText = projectPath ? agentBase : chatBase;
    const previewText =
      resolved.preset?.mode === 'replace'
        ? resolved.preset.content
        : resolved.preset?.mode === 'append'
          ? `${baseText}\n\n${resolved.preset.content}`
          : baseText;
    return {
      resolved,
      previewText,
      sourceText: sourceLabel(resolved.sourceKind, resolved.preset?.name, isZh),
    };
  }, [activeSessionId, config, isZh, projectPath, sessionPresetId]);

  async function updateGlobalDefault(nextId: string): Promise<void> {
    if (!config) return;
    const { defaultPresetId: _prev, ...rest } = systemPrompts;
    const nextConfig: PiwinConfig = {
      ...config,
      systemPrompts:
        nextId === SYSTEM_PROMPT_BUILTIN_ID ? rest : { ...rest, defaultPresetId: nextId },
    };
    const ok = await saveConfig(nextConfig, { quiet: true });
    if (ok) {
      setInfo(
        isZh ? '已更新全局默认系统提示词，下一轮对话生效。' : 'Global default saved. Applies on next turn.',
        'success',
      );
    }
  }

  async function updateProjectDefault(nextId: string): Promise<void> {
    if (!config || !projectPath) return;
    const nextProjects = { ...(systemPrompts.projectPresetIds ?? {}) };
    if (nextId === SYSTEM_PROMPT_INHERIT_ID) {
      delete nextProjects[projectPath];
    } else {
      nextProjects[projectPath] = nextId;
    }
    const { projectPresetIds: _prev, ...rest } = systemPrompts;
    const nextConfig: PiwinConfig = {
      ...config,
      systemPrompts:
        Object.keys(nextProjects).length > 0
          ? { ...rest, projectPresetIds: nextProjects }
          : rest,
    };
    const ok = await saveConfig(nextConfig, { quiet: true });
    if (ok) {
      setInfo(
        isZh ? '已更新当前项目系统提示词，下一轮对话生效。' : 'Project prompt updated. Applies on next turn.',
        'success',
      );
    }
  }

  async function updateSessionPreset(nextId: string): Promise<void> {
    if (!activeSessionId || !hostClient?.request) return;
    setSavingSession(true);
    try {
      const response = await hostClient.request({
        type: 'session/set-composer-profile',
        sessionId: activeSessionId,
        systemPromptPresetId: nextId,
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      setSessionPresetId(nextId);
      setInfo(
        isZh ? '已切换当前会话系统提示词，下一轮对话生效。' : 'Session prompt updated. Applies on next turn.',
        'success',
      );
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSavingSession(false);
    }
  }

  function handleCopyPreview(): void {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(effective.previewText);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  }

  const presetOptions = presets.map((preset) => ({
    value: preset.id,
    label: `${preset.name} (${preset.mode === 'replace' ? (isZh ? '替换' : 'Replace') : isZh ? '追加' : 'Append'})`,
  }));

  return (
    <section className="settings-section settings-section-card" data-testid="system-prompts-scope-card">
      <PageTitle
        title={isZh ? '系统提示词' : 'System Prompts'}
        description={
          isZh
            ? '管理自定义系统提示词预设，查看或调整各模块内置提示词。优先级：当前会话 > 当前项目 > 全局默认 > 系统内置。'
            : 'Manage custom system prompt presets and inspect or customize built-in module prompts. Priority: Session > Project > Global > Built-in.'
        }
      />

      <FieldRow
        label={isZh ? '全局默认' : 'Global default'}
        description={isZh ? '所有新会话与未单独指定的项目默认使用。' : 'Used by default across sessions unless overridden.'}
        testId="system-prompts-global-row"
      >
        <Select
          value={globalSelection}
          testId="system-prompts-global-select"
          onChange={(event) => void updateGlobalDefault(event.currentTarget.value)}
          data={[
            { value: SYSTEM_PROMPT_BUILTIN_ID, label: isZh ? '系统内置默认' : 'Built-in default' },
            ...presetOptions,
          ]}
        />
      </FieldRow>

      {projectPath ? (
        <FieldRow
          label={isZh ? '当前项目' : 'Current project'}
          description={projectPath}
          testId="system-prompts-project-row"
        >
          <Select
            value={projectSelection}
            testId="system-prompts-project-select"
            onChange={(event) => void updateProjectDefault(event.currentTarget.value)}
            data={[
              { value: SYSTEM_PROMPT_INHERIT_ID, label: isZh ? '跟随全局默认' : 'Inherit global default' },
              { value: SYSTEM_PROMPT_BUILTIN_ID, label: isZh ? '仅使用系统默认' : 'Built-in default only' },
              ...presetOptions,
            ]}
          />
        </FieldRow>
      ) : null}

      {activeSessionId && hostClient?.request ? (
        <FieldRow
          label={isZh ? '当前会话' : 'Current session'}
          description={isZh ? '仅影响当前打开的会话，切换后下一轮对话自动生效。' : 'Applies only to the active session on the next turn.'}
          testId="system-prompts-session-row"
        >
          <Select
            disabled={savingSession}
            value={sessionPresetId}
            testId="system-prompts-session-select"
            onChange={(event) => void updateSessionPreset(event.currentTarget.value)}
            data={[
              { value: SYSTEM_PROMPT_INHERIT_ID, label: isZh ? '跟随项目 / 全局默认' : 'Inherit project / global' },
              { value: SYSTEM_PROMPT_BUILTIN_ID, label: isZh ? '仅使用系统默认' : 'Built-in default only' },
              ...presetOptions,
            ]}
          />
        </FieldRow>
      ) : null}

      <details style={{ marginTop: 10 }} data-testid="system-prompts-effective-preview">
        <summary style={{ cursor: 'pointer', fontSize: '0.88em', opacity: 0.78 }}>
          {isZh
            ? `查看当前实际生效提示词（${effective.sourceText}）`
            : `View effective prompt (${effective.sourceText})`}
        </summary>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button size="compact" variant="ghost" onClick={handleCopyPreview}>
            {copied ? (isZh ? '已复制' : 'Copied') : isZh ? '复制全文' : 'Copy'}
          </Button>
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '0.82em',
            opacity: 0.8,
            maxHeight: '260px',
            overflow: 'auto',
            padding: '10px',
            background: 'var(--piwin-surface-2, rgba(0,0,0,0.03))',
            borderRadius: '6px',
            marginTop: '6px',
          }}
        >
          {effective.previewText}
        </pre>
      </details>
    </section>
  );
}
