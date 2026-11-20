/**
 * Unified custom preset workbench: preset tabs, single-line controls, and `@` file stack.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Button,
  IconEye,
  IconPlus,
  IconTrash,
  SegmentedControl,
  TextInput,
} from '@piwin/ui-kit';
import {
  createDefaultSystemPromptsConfig,
  formatSystemPromptFileStack,
  normalizeSystemPromptFileStack,
  slugifySystemPromptPresetId,
  type PiwinConfig,
  type SystemPromptFileCandidate,
  type SystemPromptFileReadItem,
  type SystemPromptFilesListData,
  type SystemPromptFilesReadData,
  type SystemPromptMode,
  type SystemPromptPreset,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { PresetProjectBindingsBar } from './PresetProjectBindingsBar';
import { PromptFileStackEditor } from './PromptFileStackEditor';
import { promptFileDisplayName, promptFileExtensionLabel } from './prompt-file-actions';
import type { PromptPreviewLayer, PromptPreviewPayload } from './PromptPreviewModal';
import type { SystemPromptProjectOption } from './system-prompt-projects';

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function CustomPresetsPanel(props: {
  projectOptions: readonly SystemPromptProjectOption[];
  selectedProjectPath: string | null;
  canBrowseProjectDir: boolean;
  onOpenPreview: (payload: PromptPreviewPayload) => void;
  onFocusProject: (projectPath: string) => void;
  onBindProjectToPreset: (projectPath: string, preset: SystemPromptPreset) => void;
  onUnbindProject: (projectPath: string) => void;
  onBrowseProjectForPreset: (preset: SystemPromptPreset) => void;
}): ReactElement {
  const { config, projectPath, hostClient, saveConfig, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const systemPrompts = config?.systemPrompts ?? createDefaultSystemPromptsConfig();
  const presets = systemPrompts.presets;
  const isRemote = hostClient?.getTransport?.() === 'remote';
  const hostRequest = hostClient?.request;
  const effectiveProjectPath = props.selectedProjectPath ?? projectPath;

  const [selectedId, setSelectedId] = useState<string>('__new__');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SystemPromptMode>('append');
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<SystemPromptFileCandidate[]>([]);
  const [systemPromptsDir, setSystemPromptsDir] = useState<string | undefined>(undefined);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [readItemsByPath, setReadItemsByPath] = useState<ReadonlyMap<string, SystemPromptFileReadItem>>(
    () => new Map(),
  );
  const initializedRef = useRef(false);
  const lastSyncedPresetRef = useRef<{
    id: string;
    name: string;
    mode: SystemPromptMode;
    filePaths: readonly string[];
  } | null>(null);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      const first = presets[0];
      if (first) {
        setSelectedId(first.id);
        setName(first.name);
        setMode(first.mode);
        setFilePaths(first.filePaths);
        lastSyncedPresetRef.current = {
          id: first.id,
          name: first.name,
          mode: first.mode,
          filePaths: first.filePaths,
        };
      }
      return;
    }
    if (selectedId === '__new__') {
      lastSyncedPresetRef.current = null;
      return;
    }
    const existing = presets.find((item) => item.id === selectedId);
    if (!existing) {
      return;
    }
    const last = lastSyncedPresetRef.current;
    const presetChanged =
      !last ||
      last.id !== existing.id ||
      last.name !== existing.name ||
      last.mode !== existing.mode ||
      !sameStringArray(last.filePaths, existing.filePaths);
    if (presetChanged) {
      setName(existing.name);
      setMode(existing.mode);
      setFilePaths(existing.filePaths);
      lastSyncedPresetRef.current = {
        id: existing.id,
        name: existing.name,
        mode: existing.mode,
        filePaths: existing.filePaths,
      };
    }
  }, [presets, selectedId]);

  const refreshCandidates = useCallback(async () => {
    if (!hostRequest) return;
    setLoadingCandidates(true);
    try {
      const response = await hostRequest({
        type: 'system-prompts/list-files',
        ...(!isRemote && effectiveProjectPath ? { projectPath: effectiveProjectPath } : {}),
      });
      if (!response.success) return;
      const data = response.data as SystemPromptFilesListData | undefined;
      if (data) {
        setSystemPromptsDir(data.systemPromptsDir);
        setCandidates(data.files ?? []);
      }
    } catch {
      // Best-effort discovery.
    } finally {
      setLoadingCandidates(false);
    }
  }, [effectiveProjectPath, hostRequest, isRemote]);

  useEffect(() => {
    void refreshCandidates();
  }, [refreshCandidates]);

  const refreshStackContents = useCallback(
    async (paths: readonly string[]): Promise<ReadonlyMap<string, SystemPromptFileReadItem>> => {
      if (!hostRequest || paths.length === 0) {
        const empty = new Map<string, SystemPromptFileReadItem>();
        setReadItemsByPath(empty);
        return empty;
      }
      try {
        const response = await hostRequest({
          type: 'system-prompts/read-files',
          paths: [...paths],
          ...(!isRemote && effectiveProjectPath ? { projectPath: effectiveProjectPath } : {}),
        });
        if (!response.success) return readItemsByPath;
        const data = response.data as SystemPromptFilesReadData | undefined;
        const map = new Map<string, SystemPromptFileReadItem>();
        for (const item of data?.files ?? []) {
          map.set(item.path, item);
        }
        setReadItemsByPath(map);
        return map;
      } catch {
        return readItemsByPath;
      }
    },
    [effectiveProjectPath, hostRequest, isRemote, readItemsByPath],
  );

  useEffect(() => {
    void refreshStackContents(filePaths);
    // Re-read whenever the file stack changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProjectPath, filePaths, hostRequest, isRemote]);

  const activePreset =
    selectedId === '__new__' ? undefined : presets.find((item) => item.id === selectedId);
  const normalizedPaths = useMemo(() => normalizeSystemPromptFileStack(filePaths), [filePaths]);
  const isDirty = activePreset
    ? activePreset.name !== name.trim() ||
      activePreset.mode !== mode ||
      !sameStringArray(activePreset.filePaths, normalizedPaths)
    : name.trim().length > 0 || normalizedPaths.length > 0;
  const canSave = name.trim().length > 0 && normalizedPaths.length > 0 && isDirty && !saving;

  function startNewPreset(): void {
    lastSyncedPresetRef.current = null;
    setSelectedId('__new__');
    setName('');
    setMode('append');
    setFilePaths([]);
  }

  function selectPreset(id: string): void {
    if (id === '__new__') {
      startNewPreset();
      return;
    }
    const found = presets.find((item) => item.id === id);
    if (!found) return;
    lastSyncedPresetRef.current = {
      id: found.id,
      name: found.name,
      mode: found.mode,
      filePaths: found.filePaths,
    };
    setSelectedId(found.id);
    setName(found.name);
    setMode(found.mode);
    setFilePaths(found.filePaths);
  }

  async function openSingleFilePreview(filePath: string): Promise<void> {
    const latestMap = await refreshStackContents([filePath]);
    const item = latestMap.get(filePath);
    const fileName = item?.fileName ?? promptFileDisplayName(filePath);
    props.onOpenPreview({
      title: `@${fileName}`,
      badge: promptFileExtensionLabel(filePath),
      badgeTone: item && !item.exists ? 'warning' : 'neutral',
      layers: [
        {
          id: 'file',
          label: `@${fileName}`,
          filePath: item?.resolvedPath ?? filePath,
          content: item?.content ?? '',
          missing: item ? !item.exists : false,
          ...(item?.error ? { error: item.error } : {}),
          ...(item?.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
        },
      ],
    });
  }

  async function openCombinedStackPreview(): Promise<void> {
    if (normalizedPaths.length === 0) return;
    const latestMap = await refreshStackContents(normalizedPaths);
    const validContents: string[] = [];
    const fileLayers: PromptPreviewLayer[] = normalizedPaths.map((filePath, index) => {
      const item = latestMap.get(filePath);
      const fileName = item?.fileName ?? promptFileDisplayName(filePath);
      const missing = item ? !item.exists : false;
      if (!missing && item?.content.trim()) {
        validContents.push(item.content);
      }
      return {
        id: `layer-${index}`,
        label: `${String(index + 1).padStart(2, '0')} @${fileName}`,
        badge: promptFileExtensionLabel(filePath),
        filePath: item?.resolvedPath ?? filePath,
        content: item?.content ?? '',
        missing,
        ...(item?.error ? { error: item.error } : {}),
        ...(item?.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
      };
    });

    const combinedText = formatSystemPromptFileStack(validContents);
    const titleName = name.trim() || (isZh ? '未命名方案' : 'Untitled preset');
    props.onOpenPreview({
      title: titleName,
      badge: mode === 'replace' ? (isZh ? '替换' : 'Replace') : isZh ? '追加' : 'Append',
      badgeTone: 'running',
      layers: [
        {
          id: 'combined',
          label: isZh ? '完整合成' : 'Combined',
          content: combinedText,
        },
        ...fileLayers,
      ],
    });
  }

  async function handleSave(): Promise<void> {
    if (!config) return;
    const trimmedName = name.trim();
    if (!trimmedName || normalizedPaths.length === 0) {
      setError(
        isZh
          ? '请填写方案名称并至少添加一个 .md 或 .txt 文件。'
          : 'Enter a preset name and add at least one .md or .txt file.',
      );
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const targetId = activePreset
        ? activePreset.id
        : slugifySystemPromptPresetId(
            trimmedName,
            presets.map((item) => item.id),
          );
      const nextPreset: SystemPromptPreset = {
        id: targetId,
        name: trimmedName,
        mode,
        filePaths: normalizedPaths,
        updatedAt: now,
      };
      const nextPresets = activePreset
        ? presets.map((item) => (item.id === targetId ? nextPreset : item))
        : [...presets, nextPreset];
      const nextConfig: PiwinConfig = {
        ...config,
        systemPrompts: {
          ...systemPrompts,
          presets: nextPresets,
        },
      };
      const ok = await saveConfig(nextConfig, { quiet: true });
      if (ok) {
        lastSyncedPresetRef.current = {
          id: nextPreset.id,
          name: nextPreset.name,
          mode: nextPreset.mode,
          filePaths: nextPreset.filePaths,
        };
        setSelectedId(targetId);
        setInfo(isZh ? `已保存「${trimmedName}」。` : `Saved "${trimmedName}".`, 'success');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!config || !activePreset) return;
    setSaving(true);
    try {
      const deletedId = activePreset.id;
      const nextPresets = presets.filter((item) => item.id !== deletedId);
      const nextProjects = { ...(systemPrompts.projectPresetIds ?? {}) };
      for (const [pathKey, presetId] of Object.entries(nextProjects)) {
        if (presetId === deletedId) delete nextProjects[pathKey];
      }
      const nextSystemPrompts = {
        ...systemPrompts,
        presets: nextPresets,
        ...(Object.keys(nextProjects).length > 0 ? { projectPresetIds: nextProjects } : {}),
      };
      if (Object.keys(nextProjects).length === 0) {
        delete nextSystemPrompts.projectPresetIds;
      }
      if (nextSystemPrompts.defaultPresetId === deletedId) {
        delete nextSystemPrompts.defaultPresetId;
      }
      const nextConfig: PiwinConfig = {
        ...config,
        systemPrompts: nextSystemPrompts,
      };
      const ok = await saveConfig(nextConfig, { quiet: true });
      if (ok) {
        const fallback = nextPresets[0];
        if (fallback) {
          lastSyncedPresetRef.current = {
            id: fallback.id,
            name: fallback.name,
            mode: fallback.mode,
            filePaths: fallback.filePaths,
          };
          setSelectedId(fallback.id);
          setName(fallback.name);
          setMode(fallback.mode);
          setFilePaths(fallback.filePaths);
        } else {
          startNewPreset();
        }
        setInfo(isZh ? `已删除「${activePreset.name}」。` : `Deleted "${activePreset.name}".`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSetGlobalDefault(): Promise<void> {
    if (!config || !activePreset) return;
    const ok = await saveConfig(
      {
        ...config,
        systemPrompts: {
          ...systemPrompts,
          defaultPresetId: activePreset.id,
        },
      },
      { quiet: true },
    );
    if (ok) {
      setInfo(
        isZh ? `已设为全局默认：${activePreset.name}` : `Global default: ${activePreset.name}`,
        'success',
      );
    }
  }

  return (
    <section
      className="settings-section settings-section-card sysprompt-workbench"
      data-testid="system-prompts-presets-panel"
    >
      {presets.length > 0 ? (
        <div
          className="sysprompt-preset-tabs"
          role="tablist"
          aria-label={isZh ? '预设方案' : 'Presets'}
        >
          {presets.map((item) => {
            const selected = item.id === selectedId;
            const isDefault = item.id === systemPrompts.defaultPresetId;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectPreset(item.id)}
                className={`sysprompt-preset-pill${selected ? ' is-selected' : ''}`}
                data-testid={`sysprompt-preset-pill-${item.id}`}
                title={
                  isDefault
                    ? isZh
                      ? '当前全局默认'
                      : 'Global default'
                    : item.mode === 'replace'
                      ? isZh
                        ? '替换模式'
                        : 'Replace mode'
                      : isZh
                        ? '追加模式'
                        : 'Append mode'
                }
              >
                {isDefault ? <span className="sysprompt-default-dot" aria-hidden="true" /> : null}
                <span className="sysprompt-preset-pill-name">{item.name}</span>
                <span className="sysprompt-preset-count">{item.filePaths.length}</span>
              </button>
            );
          })}
          {selectedId === '__new__' ? (
            <button
              type="button"
              role="tab"
              aria-selected
              className="sysprompt-preset-pill is-selected is-draft"
              onClick={startNewPreset}
            >
              <span className="sysprompt-preset-pill-name">
                {name.trim() || (isZh ? '未保存' : 'New')}
              </span>
              <span className="sysprompt-preset-count">{filePaths.length}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="sysprompt-new-pill"
            onClick={startNewPreset}
            data-testid="system-prompts-new-preset"
          >
            <IconPlus size={12} />
            <span>{isZh ? '新建' : 'New'}</span>
          </button>
        </div>
      ) : null}

      <div className="sysprompt-control-bar">
        <div className="sysprompt-name-wrap">
          <TextInput
            toolbar
            value={name}
            disabled={saving}
            placeholder={isZh ? '方案名称（如：严格代码审查）' : 'Preset name'}
            aria-label={isZh ? '方案名称' : 'Preset name'}
            testId="system-prompts-preset-name"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>

        <div
          className="sysprompt-mode-wrap"
          title={
            mode === 'append'
              ? isZh
                ? '追加到系统默认契约之后'
                : 'Append after built-in default'
              : isZh
                ? '替换默认人设与契约'
                : 'Replace default persona'
          }
        >
          <SegmentedControl
            size="xs"
            value={mode}
            testId="system-prompts-preset-mode"
            onChange={(nextValue) => setMode(nextValue === 'replace' ? 'replace' : 'append')}
            data={[
              { value: 'append', label: isZh ? '追加' : 'Append' },
              { value: 'replace', label: isZh ? '替换' : 'Replace' },
            ]}
          />
        </div>

        <div className="sysprompt-control-actions">
          <Button
            size="compact"
            variant="secondary"
            disabled={normalizedPaths.length === 0}
            onClick={() => void openCombinedStackPreview()}
            title={isZh ? '预览合成结果' : 'Preview combined prompt'}
            data-testid="system-prompts-preset-preview"
          >
            <IconEye size={13} />
            <span>{isZh ? '预览' : 'Preview'}</span>
          </Button>
          {activePreset && activePreset.id !== systemPrompts.defaultPresetId ? (
            <Button
              size="compact"
              variant="ghost"
              disabled={saving || isDirty}
              onClick={() => void handleSetGlobalDefault()}
              data-testid="system-prompts-preset-set-global"
            >
              {isZh ? '设为默认' : 'Set default'}
            </Button>
          ) : null}
          {activePreset ? (
            <button
              type="button"
              className="sysprompt-icon-action is-danger"
              disabled={saving}
              onClick={() => void handleDelete()}
              title={isZh ? '删除方案' : 'Delete preset'}
              aria-label={isZh ? '删除方案' : 'Delete preset'}
              data-testid="system-prompts-preset-delete"
            >
              <IconTrash size={14} />
            </button>
          ) : null}
          <Button
            size="compact"
            variant="primary"
            disabled={!canSave}
            onClick={() => void handleSave()}
            data-testid="system-prompts-preset-save"
          >
            {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存' : 'Save'}
          </Button>
        </div>
      </div>

      {activePreset ? (
        <PresetProjectBindingsBar
          preset={activePreset}
          presets={presets}
          projectOptions={props.projectOptions}
          selectedProjectPath={props.selectedProjectPath}
          canBrowseProjectDir={props.canBrowseProjectDir}
          disabled={saving}
          onBindProject={(targetPath) => props.onBindProjectToPreset(targetPath, activePreset)}
          onUnbindProject={(targetPath) => props.onUnbindProject(targetPath)}
          onFocusProject={props.onFocusProject}
          onBrowseProjectDir={() => props.onBrowseProjectForPreset(activePreset)}
        />
      ) : null}

      <PromptFileStackEditor
        filePaths={filePaths}
        candidates={candidates}
        {...(systemPromptsDir ? { systemPromptsDir } : {})}
        projectPath={effectiveProjectPath}
        readItemsByPath={readItemsByPath}
        loadingCandidates={loadingCandidates}
        disabled={saving}
        onChangeFilePaths={setFilePaths}
        onPreviewFile={(filePath) => void openSingleFilePreview(filePath)}
        onRefreshCandidates={() => void refreshCandidates()}
      />
    </section>
  );
}
