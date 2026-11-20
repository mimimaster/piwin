/**
 * Settings → Agent → System Prompts page.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Skeleton } from '@piwin/ui-kit';
import {
  SYSTEM_PROMPT_INHERIT_ID,
  type BuiltinSystemPromptSlotId,
  type ProjectListData,
  type ProjectRecord,
  type SystemPromptPreset,
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
  applyProjectPresetBinding,
  buildSystemPromptProjectOptions,
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
  const [projectPickerTarget, setProjectPickerTarget] = useState<
    null | { kind: 'scope' } | { kind: 'bind-preset'; preset: SystemPromptPreset }
  >(null);
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

  async function handleUpdateProjectPreset(
    targetPath: string,
    nextPresetId: string,
    customSuccessMessage?: string,
  ): Promise<void> {
    if (!config) return;
    const nextConfig = applyProjectPresetBinding(config, targetPath, nextPresetId);
    const ok = await saveConfig(nextConfig, { quiet: true });
    if (ok) {
      const label = projectLabel(targetPath, recentProjects);
      setInfo(
        customSuccessMessage ??
          (isZh ? `已更新项目「${label}」的提示词方案。` : `Updated prompt for "${label}".`),
        'success',
      );
    }
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
        canBrowseProjectDir={canBrowseProjectDir}
        onTabChange={setTab}
        onOpenPreview={setPreviewPayload}
        onSelectProjectPath={setSelectedProjectPath}
        onBrowseProjectDir={() => setProjectPickerTarget({ kind: 'scope' })}
        onUpdateProjectPreset={(targetPath, nextPresetId) => {
          void handleUpdateProjectPreset(targetPath, nextPresetId);
        }}
      />

      {tab === 'presets' ? (
        <CustomPresetsPanel
          projectOptions={projectOptions}
          selectedProjectPath={effectiveSelectedProjectPath}
          canBrowseProjectDir={canBrowseProjectDir}
          onOpenPreview={setPreviewPayload}
          onFocusProject={setSelectedProjectPath}
          onBindProjectToPreset={(targetPath, preset) => {
            setSelectedProjectPath(targetPath);
            const label = projectLabel(targetPath, recentProjects);
            void handleUpdateProjectPreset(
              targetPath,
              preset.id,
              isZh
                ? `已将「${preset.name}」设为项目「${label}」的提示词方案。`
                : `Bound "${preset.name}" to "${label}".`,
            );
          }}
          onUnbindProject={(targetPath) => {
            const label = projectLabel(targetPath, recentProjects);
            void handleUpdateProjectPreset(
              targetPath,
              SYSTEM_PROMPT_INHERIT_ID,
              isZh
                ? `已恢复项目「${label}」跟随全局默认。`
                : `Reset "${label}" to inherit global default.`,
            );
          }}
          onBrowseProjectForPreset={(preset) =>
            setProjectPickerTarget({ kind: 'bind-preset', preset })
          }
        />
      ) : (
        <BuiltinPromptsPanel
          initialSlotId={focusedSlotId}
          onConsumeInitialSlot={() => setFocusedSlotId(undefined)}
          onOpenPreview={setPreviewPayload}
        />
      )}

      <ProjectDirectoryPickerDialog
        open={projectPickerTarget !== null}
        {...(effectiveSelectedProjectPath ? { initialPath: effectiveSelectedProjectPath } : {})}
        onOpenChange={(open) => {
          if (!open) setProjectPickerTarget(null);
        }}
        onSelectDirectory={(pickedPath) => {
          const target = projectPickerTarget;
          setExtraProjectPaths((prev) => (prev.includes(pickedPath) ? prev : [...prev, pickedPath]));
          setSelectedProjectPath(pickedPath);
          setProjectPickerTarget(null);
          if (target?.kind === 'bind-preset') {
            const label = projectLabel(pickedPath, recentProjects);
            void handleUpdateProjectPreset(
              pickedPath,
              target.preset.id,
              isZh
                ? `已将「${target.preset.name}」设为项目「${label}」的提示词方案。`
                : `Bound "${target.preset.name}" to "${label}".`,
            );
          }
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
