/**
 * Settings → Agent → System Prompts page.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Skeleton } from '@piwin/ui-kit';
import {
  SYSTEM_PROMPT_BUILTIN_ID,
  SYSTEM_PROMPT_INHERIT_ID,
  type BuiltinSystemPromptSlotId,
  type ProjectListData,
  type ProjectRecord,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { projectLabel } from '../../sidebar/project-display-name';
import { useSettings } from '../settings-context';
import { BuiltinPromptsPanel } from '../system-prompts/BuiltinPromptsPanel';
import { CustomPresetsPanel } from '../system-prompts/CustomPresetsPanel';
import { ProjectDirectoryPickerDialog } from '../system-prompts/ProjectDirectoryPickerDialog';
import {
  PromptPreviewModal,
  type PromptPreviewPayload,
} from '../system-prompts/PromptPreviewModal';
import { SystemPromptsScopeCard } from '../system-prompts/SystemPromptsScopeCard';
import {
  applyPresetScopeConfig,
  applyProjectPresetBinding,
  buildSystemPromptProjectOptions,
  type PresetActivationScope,
} from '../system-prompts/system-prompt-projects';
import {
  consumeSystemPromptFocus,
  type SystemPromptsTab,
} from '../system-prompts/system-prompts-focus';

export function SystemPromptsPage(): ReactElement {
  const { config, projectPath, hostClient, saveConfig, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [tab, setTab] = useState<SystemPromptsTab>('presets');
  const [focusedSlotId, setFocusedSlotId] = useState<BuiltinSystemPromptSlotId | undefined>(
    undefined,
  );
  const [previewPayload, setPreviewPayload] = useState<PromptPreviewPayload | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectRecord[]>([]);
  const [extraProjectPaths, setExtraProjectPaths] = useState<string[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(projectPath);
  const [projectPickerCallback, setProjectPickerCallback] = useState<{
    onPicked: (dirPath: string) => void;
  } | null>(null);
  const prevWorkspacePathRef = useRef<string | null>(projectPath);

  useEffect(() => {
    const focus = consumeSystemPromptFocus();
    if (!focus) return;
    setTab(focus.tab);
    if (focus.slotId) {
      setFocusedSlotId(focus.slotId);
    }
  }, []);

  useEffect(() => {
    if (prevWorkspacePathRef.current !== projectPath) {
      prevWorkspacePathRef.current = projectPath;
      setSelectedProjectPath(projectPath);
    }
  }, [projectPath]);

  useEffect(() => {
    const requestHost = hostClient?.request;
    if (!requestHost || hostClient?.supportsCommand?.('project/list') === false) {
      return;
    }
    let cancelled = false;
    void requestHost({ type: 'project/list' })
      .then((response) => {
        if (cancelled || !response.success) return;
        const data = response.data as ProjectListData | undefined;
        setRecentProjects(data?.projects ?? []);
      })
      .catch(() => {
        // Best-effort project discovery; fall back to current workspace and configured bindings.
      });
    return () => {
      cancelled = true;
    };
  }, [hostClient]);

  const isRemote = hostClient?.getTransport?.() === 'remote';
  const canBrowseProjectDir =
    !isRemote &&
    Boolean(hostClient?.request) &&
    (hostClient?.supportsCommand?.('host/list-dir') ?? true);

  const projectOptions = useMemo(
    () =>
      buildSystemPromptProjectOptions({
        currentProjectPath: projectPath,
        recentProjects,
        projectPresetIds: config?.systemPrompts?.projectPresetIds,
        extraProjectPaths,
      }),
    [config?.systemPrompts?.projectPresetIds, extraProjectPaths, projectPath, recentProjects],
  );

  const effectiveSelectedProjectPath =
    selectedProjectPath && projectOptions.some((item) => item.path === selectedProjectPath)
      ? selectedProjectPath
      : (projectOptions[0]?.path ?? null);

  async function handleApplyPresetScope(
    presetId: string,
    presetName: string,
    input: { scope: PresetActivationScope; projectPaths?: readonly string[] },
  ): Promise<void> {
    if (!config) return;
    const nextConfig = applyPresetScopeConfig(config, presetId, input);
    const ok = await saveConfig(nextConfig, { quiet: true });
    if (!ok) return;

    if (input.scope === 'global') {
      setInfo(
        isZh ? `已将「${presetName}」设为全局默认。` : `"${presetName}" is now global default.`,
        'success',
      );
      return;
    }
    if (input.scope === 'projects') {
      const count = input.projectPaths?.length ?? 0;
      setInfo(
        count > 0
          ? isZh
            ? `已更新「${presetName}」的生效项目（${count} 个）。`
            : `Updated target projects for "${presetName}" (${count}).`
          : isZh
            ? `已取消「${presetName}」的生效项目。`
            : `Cleared target projects for "${presetName}".`,
        'success',
      );
      return;
    }
    setInfo(
      isZh ? `已停用「${presetName}」。` : `Deactivated "${presetName}".`,
      'info',
    );
  }

  async function handleToggleProjectBuiltin(
    targetPath: string,
    forceBuiltin: boolean,
  ): Promise<void> {
    if (!config) return;
    const nextPresetId = forceBuiltin ? SYSTEM_PROMPT_BUILTIN_ID : SYSTEM_PROMPT_INHERIT_ID;
    const nextConfig = applyProjectPresetBinding(config, targetPath, nextPresetId);
    const ok = await saveConfig(nextConfig, { quiet: true });
    if (!ok) return;
    const label = projectLabel(targetPath, recentProjects);
    setInfo(
      forceBuiltin
        ? isZh
          ? `项目「${label}」已改为使用系统默认。`
          : `"${label}" now uses the built-in default.`
        : isZh
          ? `项目「${label}」已恢复跟随全局默认。`
          : `"${label}" now inherits the global default.`,
      'success',
    );
  }

  if (!config) {
    return (
      <Skeleton
        label={isZh ? '正在加载系统提示词…' : 'Loading system prompts…'}
        rows={[48, 120, 140]}
      />
    );
  }

  return (
    <div className="settings-card sysprompt-page" data-testid="settings-system-prompts">
      <SystemPromptsScopeCard
        tab={tab}
        projectOptions={projectOptions}
        selectedProjectPath={effectiveSelectedProjectPath}
        onTabChange={setTab}
        onOpenPreview={setPreviewPayload}
        onSelectProjectPath={setSelectedProjectPath}
        onToggleProjectBuiltin={(targetPath, forceBuiltin) => {
          void handleToggleProjectBuiltin(targetPath, forceBuiltin);
        }}
      />

      {tab === 'presets' ? (
        <CustomPresetsPanel
          projectOptions={projectOptions}
          selectedProjectPath={effectiveSelectedProjectPath}
          canBrowseProjectDir={canBrowseProjectDir}
          onOpenPreview={setPreviewPayload}
          onApplyPresetScope={handleApplyPresetScope}
          onRequestBrowseProjectDir={(onPicked) => setProjectPickerCallback({ onPicked })}
        />
      ) : (
        <BuiltinPromptsPanel
          initialSlotId={focusedSlotId}
          onConsumeInitialSlot={() => setFocusedSlotId(undefined)}
          onOpenPreview={setPreviewPayload}
        />
      )}

      <ProjectDirectoryPickerDialog
        open={projectPickerCallback !== null}
        {...(effectiveSelectedProjectPath ? { initialPath: effectiveSelectedProjectPath } : {})}
        onOpenChange={(open) => {
          if (!open) setProjectPickerCallback(null);
        }}
        onSelectDirectory={(pickedPath) => {
          const callback = projectPickerCallback?.onPicked;
          setExtraProjectPaths((prev) => (prev.includes(pickedPath) ? prev : [...prev, pickedPath]));
          setSelectedProjectPath(pickedPath);
          setProjectPickerCallback(null);
          callback?.(pickedPath);
        }}
      />

      <PromptPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
        onNotice={(message, tone) => setInfo(message, tone)}
        onError={(message) => setError(message)}
      />
    </div>
  );
}
