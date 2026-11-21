/**
 * Top bar for System Prompts: section tabs on top and a plain-language effective
 * status banner below showing what is currently active and letting the user
 * inspect the final compiled prompt.
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
  type SessionSummary,
  type SystemPromptFileReadItem,
  type SystemPromptFilesReadData,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { promptFileDisplayName, promptFileExtensionLabel } from './prompt-file-actions';
import type { PromptPreviewLayer, PromptPreviewPayload } from './PromptPreviewModal';
import { formatProjectOptionLabel, type SystemPromptProjectOption } from './system-prompt-projects';
import type { SystemPromptsTab } from './system-prompts-focus';

function sourceLabel(
  kind: ReturnType<typeof resolveActiveSystemPromptSelection>['sourceKind'],
  presetName: string | undefined,
  isZh: boolean,
  projectDisplayLabel?: string,
  isCurrentProject = true,
): string {
  const projectPrefix = isCurrentProject
    ? isZh
      ? '当前项目'
      : 'Project'
    : isZh
      ? `项目「${projectDisplayLabel ?? ''}」`
      : `Project ${projectDisplayLabel ?? ''}`;
  switch (kind) {
    case 'session-preset':
      return isZh ? `当前会话 · ${presetName ?? ''}` : `Session · ${presetName ?? ''}`;
    case 'session-builtin':
      return isZh ? '当前会话 · 系统默认' : 'Session · Built-in';
    case 'project-preset':
      return `${projectPrefix} · ${presetName ?? ''}`;
    case 'project-builtin':
      return isZh ? `${projectPrefix} · 系统默认` : `${projectPrefix} · Built-in`;
    case 'global-preset':
      return isZh ? `全局默认 · ${presetName ?? ''}` : `Global · ${presetName ?? ''}`;
    case 'builtin':
      return isZh ? '系统内置默认' : 'Built-in default';
  }
}

function scopeOriginBadge(
  kind: ReturnType<typeof resolveActiveSystemPromptSelection>['sourceKind'],
  isZh: boolean,
): string {
  switch (kind) {
    case 'session-preset':
    case 'session-builtin':
      return isZh ? '会话覆盖' : 'Session override';
    case 'project-preset':
    case 'project-builtin':
      return isZh ? '项目生效' : 'Project override';
    case 'global-preset':
      return isZh ? '全局默认' : 'Global default';
    case 'builtin':
      return isZh ? '内置默认' : 'Built-in';
  }
}

export function SystemPromptsScopeCard(props: {
  tab: SystemPromptsTab;
  projectOptions: readonly SystemPromptProjectOption[];
  selectedProjectPath: string | null;
  onTabChange: (tab: SystemPromptsTab) => void;
  onOpenPreview: (payload: PromptPreviewPayload) => void;
  onSelectProjectPath: (projectPath: string) => void;
  onToggleProjectBuiltin: (projectPath: string, forceBuiltin: boolean) => void;
}): ReactElement {
  const { config, projectPath, activeSessionId, request, hostClient, setError, setInfo } =
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
  const selectedProject = props.projectOptions.find(
    (item) => item.path === props.selectedProjectPath,
  );
  const targetProjectPath = selectedProject?.path ?? null;
  const isViewingCurrentProject = !targetProjectPath || targetProjectPath === projectPath;

  const effective = useMemo(() => {
    const resolved = resolveActiveSystemPromptSelection({
      config,
      projectPath: targetProjectPath,
      sessionPresetId: isViewingCurrentProject && activeSessionId ? sessionPresetId : undefined,
    });
    const baseText = readBuiltinSystemPromptValue(
      config,
      targetProjectPath ? 'agent.default' : 'conversation.chat',
    ).effectiveContent;
    return {
      resolved,
      baseText,
      sourceText: sourceLabel(
        resolved.sourceKind,
        resolved.preset?.name,
        isZh,
        selectedProject?.displayLabel,
        isViewingCurrentProject,
      ),
    };
  }, [
    activeSessionId,
    config,
    isViewingCurrentProject,
    isZh,
    selectedProject?.displayLabel,
    sessionPresetId,
    targetProjectPath,
  ]);

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
          ...(!isRemote && targetProjectPath ? { projectPath: targetProjectPath } : {}),
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
      setInfo(isZh ? '已切换当前会话提示词方案。' : 'Session prompt updated.', 'success');
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSavingSession(false);
    }
  }

  const activePreset = effective.resolved.preset;
  const originLabel = scopeOriginBadge(effective.resolved.sourceKind, isZh);

  return (
    <div className="sysprompt-scope-header" data-testid="system-prompts-scope-card">
      <div className="sysprompt-topbar">
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
      </div>

      <div className="sysprompt-status-banner" data-testid="system-prompts-effective-banner">
        <div className="sysprompt-status-main">
          <div className="sysprompt-status-summary">
            <span
              className={`sysprompt-status-dot ${activePreset ? 'is-active' : 'is-inactive'}`}
              aria-hidden="true"
            />
            {selectedProject ? (
              <>
                {props.projectOptions.length > 1 ? (
                  <>
                    <span className="sysprompt-status-subject">{isZh ? '项目' : 'Project'}</span>
                    <select
                      className="sysprompt-status-project-select"
                      value={selectedProject.path}
                      data-testid="system-prompts-project-target-select"
                      aria-label={isZh ? '查看生效状态的项目' : 'Project to inspect'}
                      title={selectedProject.path}
                      onChange={(event) => props.onSelectProjectPath(event.currentTarget.value)}
                    >
                      {props.projectOptions.map((option) => (
                        <option key={option.path} value={option.path}>
                          {formatProjectOptionLabel(option, isZh)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="sysprompt-status-subject" title={selectedProject.path}>
                    {isZh
                      ? `当前项目 ${selectedProject.displayLabel}`
                      : `Current project ${selectedProject.displayLabel}`}
                  </span>
                )}
                <span className="sysprompt-status-verb">
                  {isZh ? '正在使用：' : 'is using:'}
                </span>
              </>
            ) : (
              <span className="sysprompt-status-subject">
                {isZh ? '全局默认正在使用：' : 'Global default is using:'}
              </span>
            )}

            <strong className="sysprompt-status-value" data-testid="system-prompts-effective-name">
              {activePreset ? activePreset.name : isZh ? '系统默认' : 'Built-in default'}
            </strong>

            <span className="sysprompt-status-badge">{originLabel}</span>
            {activePreset ? (
              <span className="sysprompt-status-badge">
                {activePreset.mode === 'replace'
                  ? isZh
                    ? '替换'
                    : 'Replace'
                  : isZh
                    ? '追加'
                    : 'Append'}
              </span>
            ) : null}

            {selectedProject && effective.resolved.sourceKind === 'global-preset' ? (
              <button
                type="button"
                className="sysprompt-status-link"
                onClick={() => props.onToggleProjectBuiltin(selectedProject.path, true)}
                data-testid="system-prompts-project-builtin-toggle"
              >
                {isZh ? '此项目改用系统默认' : 'Use built-in for this project'}
              </button>
            ) : null}

            {selectedProject && effective.resolved.sourceKind === 'project-builtin' ? (
              <button
                type="button"
                className="sysprompt-status-link"
                onClick={() => props.onToggleProjectBuiltin(selectedProject.path, false)}
                data-testid="system-prompts-project-builtin-toggle"
              >
                {isZh ? '恢复跟随全局' : 'Inherit global default'}
              </button>
            ) : null}
          </div>

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
                  ? '查看最终提示词'
                  : 'Inspect effective'}
            </span>
          </Button>
        </div>

        {activeSessionId && hostClient?.request && isViewingCurrentProject ? (
          <div className="sysprompt-status-session">
            <span className="sysprompt-status-session-label">
              {isZh ? '当前会话临时覆盖' : 'Active session override'}
            </span>
            <select
              className="sysprompt-status-session-select"
              disabled={savingSession}
              value={sessionPresetId}
              data-testid="system-prompts-session-select"
              aria-label={isZh ? '当前会话临时覆盖' : 'Active session override'}
              onChange={(event) => void updateSessionPreset(event.currentTarget.value)}
            >
              <option value={SYSTEM_PROMPT_INHERIT_ID}>
                {isZh ? '跟随项目 / 全局' : 'Follow project / global'}
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
            <span className="sysprompt-status-session-hint">
              {isZh ? '仅影响当前打开的会话' : 'Applies only to this open session'}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
