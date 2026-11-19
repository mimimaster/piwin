/**
 * Unified top bar for System Prompts: tab switcher on the left, compact scope
 * selectors (Global / Project / Session) + effective preview button on the right.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, IconEye, SegmentedControl } from '@piwin/ui-kit';
import {
  createDefaultSystemPromptsConfig,
  formatError,
  formatSystemPromptFileStack,
  readBuiltinSystemPromptValue,
  resolveActiveSystemPromptSelection,
  SYSTEM_PROMPT_BUILTIN_ID,
  SYSTEM_PROMPT_INHERIT_ID,
  type PiwinConfig,
  type SessionSummary,
  type SystemPromptFileReadItem,
  type SystemPromptFilesReadData,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { promptFileDisplayName, promptFileExtensionLabel } from './prompt-file-actions';
import type { PromptPreviewLayer, PromptPreviewPayload } from './PromptPreviewModal';
import type { SystemPromptsTab } from './system-prompts-focus';

function sourceLabel(
  kind: ReturnType<typeof resolveActiveSystemPromptSelection>['sourceKind'],
  presetName: string | undefined,
  isZh: boolean,
): string {
  switch (kind) {
    case 'session-preset':
      return isZh ? `当前会话 · ${presetName ?? ''}` : `Session · ${presetName ?? ''}`;
    case 'session-builtin':
      return isZh ? '当前会话 · 系统默认' : 'Session · Built-in';
    case 'project-preset':
      return isZh ? `当前项目 · ${presetName ?? ''}` : `Project · ${presetName ?? ''}`;
    case 'project-builtin':
      return isZh ? '当前项目 · 系统默认' : 'Project · Built-in';
    case 'global-preset':
      return isZh ? `全局默认 · ${presetName ?? ''}` : `Global · ${presetName ?? ''}`;
    case 'builtin':
      return isZh ? '系统内置默认' : 'Built-in default';
  }
}

export function SystemPromptsScopeCard(props: {
  tab: SystemPromptsTab;
  onTabChange: (tab: SystemPromptsTab) => void;
  onOpenPreview: (payload: PromptPreviewPayload) => void;
}): ReactElement {
  const { config, projectPath, activeSessionId, request, hostClient, saveConfig, setError, setInfo } =
    useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [sessionPresetId, setSessionPresetId] = useState<string>(SYSTEM_PROMPT_INHERIT_ID);
  const [savingSession, setSavingSession] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

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
        // Keep inherit when session list is unavailable.
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
    const baseText = readBuiltinSystemPromptValue(
      config,
      projectPath ? 'agent.default' : 'conversation.chat',
    ).effectiveContent;
    return {
      resolved,
      baseText,
      sourceText: sourceLabel(resolved.sourceKind, resolved.preset?.name, isZh),
    };
  }, [activeSessionId, config, isZh, projectPath, sessionPresetId]);

  async function handleOpenEffectivePreview(): Promise<void> {
    const preset = effective.resolved.preset;
    if (!preset) {
      props.onOpenPreview({
        title: isZh ? '当前生效系统提示词' : 'Effective System Prompt',
        badge: effective.sourceText,
        badgeTone: 'neutral',
        layers: [
          {
            id: 'builtin',
            label: isZh ? '系统默认' : 'Built-in',
            content: effective.baseText,
          },
        ],
      });
      return;
    }

    setLoadingPreview(true);
    try {
      const readByPath = new Map<string, SystemPromptFileReadItem>();
      if (hostClient?.request && preset.filePaths.length > 0) {
        const isRemote = hostClient.getTransport?.() === 'remote';
        const response = await hostClient.request({
          type: 'system-prompts/read-files',
          paths: preset.filePaths,
          ...(!isRemote && projectPath ? { projectPath } : {}),
        });
        if (response.success) {
          const data = response.data as SystemPromptFilesReadData | undefined;
          for (const item of data?.files ?? []) {
            readByPath.set(item.path, item);
          }
        }
      }

      const validContents: string[] = [];
      const fileLayers: PromptPreviewLayer[] = preset.filePaths.map((filePath, index) => {
        const item = readByPath.get(filePath);
        const fileName = item?.fileName ?? promptFileDisplayName(filePath);
        const missing = item ? !item.exists : false;
        if (!missing && item?.content.trim()) {
          validContents.push(item.content);
        }
        return {
          id: `file-${index}`,
          label: `${String(index + 1).padStart(2, '0')} @${fileName}`,
          badge: promptFileExtensionLabel(filePath),
          filePath: item?.resolvedPath ?? filePath,
          content: item?.content ?? '',
          missing,
          ...(item?.error ? { error: item.error } : {}),
          ...(item?.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
        };
      });

      const stackedText = formatSystemPromptFileStack(validContents);
      const isReplace = preset.mode === 'replace' && stackedText.length > 0;
      const combinedText = isReplace
        ? stackedText
        : stackedText.length > 0
          ? `${effective.baseText}\n\n${stackedText}`
          : effective.baseText;

      const layers: PromptPreviewLayer[] = [
        {
          id: 'effective',
          label: isZh ? '完整合成' : 'Combined',
          content: combinedText,
        },
        ...(!isReplace
          ? [
              {
                id: 'base',
                label: isZh ? '内置基底' : 'Built-in base',
                content: effective.baseText,
              },
            ]
          : []),
        ...fileLayers,
      ];

      props.onOpenPreview({
        title: effective.sourceText,
        badge:
          preset.mode === 'replace'
            ? isZh
              ? '替换'
              : 'Replace'
            : isZh
              ? '追加'
              : 'Append',
        badgeTone: 'running',
        layers,
      });
    } catch (error) {
      setError(formatError(error));
    } finally {
      setLoadingPreview(false);
    }
  }

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
      setInfo(isZh ? '已更新全局默认方案。' : 'Global default updated.', 'success');
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
      setInfo(isZh ? '已更新项目方案。' : 'Project prompt updated.', 'success');
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
      setInfo(isZh ? '已切换会话方案。' : 'Session prompt updated.', 'success');
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSavingSession(false);
    }
  }

  return (
    <div className="sysprompt-topbar" data-testid="system-prompts-scope-card">
      <SegmentedControl
        value={props.tab}
        size="xs"
        testId="system-prompts-tab-control"
        onChange={(nextTab) => props.onTabChange(nextTab === 'builtins' ? 'builtins' : 'presets')}
        data={[
          { value: 'presets', label: isZh ? '预设方案' : 'Presets' },
          { value: 'builtins', label: isZh ? '内置提示词' : 'Built-ins' },
        ]}
      />

      <div className="sysprompt-scope-bar">
        <label
          className="sysprompt-scope-pill"
          title={isZh ? '全局默认系统提示词' : 'Global default prompt'}
        >
          <span className="sysprompt-scope-key">{isZh ? '全局' : 'Global'}</span>
          <select
            className="sysprompt-scope-select"
            value={globalSelection}
            data-testid="system-prompts-global-select"
            aria-label={isZh ? '全局默认' : 'Global default'}
            onChange={(event) => void updateGlobalDefault(event.currentTarget.value)}
          >
            <option value={SYSTEM_PROMPT_BUILTIN_ID}>
              {isZh ? '系统默认' : 'Built-in'}
            </option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        {projectPath ? (
          <label className="sysprompt-scope-pill" title={projectPath}>
            <span className="sysprompt-scope-key">{isZh ? '项目' : 'Project'}</span>
            <select
              className="sysprompt-scope-select"
              value={projectSelection}
              data-testid="system-prompts-project-select"
              aria-label={isZh ? '当前项目' : 'Current project'}
              onChange={(event) => void updateProjectDefault(event.currentTarget.value)}
            >
              <option value={SYSTEM_PROMPT_INHERIT_ID}>
                {isZh ? '跟随全局' : 'Inherit'}
              </option>
              <option value={SYSTEM_PROMPT_BUILTIN_ID}>
                {isZh ? '系统默认' : 'Built-in'}
              </option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {activeSessionId && hostClient?.request ? (
          <label
            className="sysprompt-scope-pill"
            title={isZh ? '仅对当前打开的会话生效' : 'Applies to active session only'}
          >
            <span className="sysprompt-scope-key">{isZh ? '会话' : 'Session'}</span>
            <select
              className="sysprompt-scope-select"
              disabled={savingSession}
              value={sessionPresetId}
              data-testid="system-prompts-session-select"
              aria-label={isZh ? '当前会话' : 'Current session'}
              onChange={(event) => void updateSessionPreset(event.currentTarget.value)}
            >
              <option value={SYSTEM_PROMPT_INHERIT_ID}>
                {isZh ? '跟随上级' : 'Inherit'}
              </option>
              <option value={SYSTEM_PROMPT_BUILTIN_ID}>
                {isZh ? '系统默认' : 'Built-in'}
              </option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Button
          size="compact"
          variant="secondary"
          disabled={loadingPreview}
          onClick={() => void handleOpenEffectivePreview()}
          title={effective.sourceText}
          data-testid="system-prompts-effective-preview-btn"
        >
          <IconEye size={13} />
          <span>
            {loadingPreview
              ? isZh
                ? '读取中…'
                : 'Loading…'
              : isZh
                ? '生效预览'
                : 'Effective'}
          </span>
        </Button>
      </div>
    </div>
  );
}
