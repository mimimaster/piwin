/**
 * Custom system prompt presets manager: create, edit, delete, and set as global default.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Select, TextArea, TextInput } from '@piwin/ui-kit';
import {
  createDefaultSystemPromptsConfig,
  MAX_SYSTEM_PROMPT_CONTENT_CHARS,
  slugifySystemPromptPresetId,
  type PiwinConfig,
  type SystemPromptMode,
  type SystemPromptPreset,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export type PresetDraftSeed = {
  name: string;
  content: string;
  mode?: SystemPromptMode;
};

export function CustomPresetsPanel(props: {
  draftSeed?: PresetDraftSeed | null;
  onConsumeSeed?: () => void;
}): ReactElement {
  const { config, saveConfig, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const systemPrompts = config?.systemPrompts ?? createDefaultSystemPromptsConfig();
  const presets = systemPrompts.presets;

  const [selectedId, setSelectedId] = useState<string>('__new__');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SystemPromptMode>('append');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);
  const { draftSeed, onConsumeSeed } = props;

  useEffect(() => {
    if (draftSeed) {
      initializedRef.current = true;
      setSelectedId('__new__');
      setName(draftSeed.name);
      setMode(draftSeed.mode ?? 'append');
      setContent(draftSeed.content);
      onConsumeSeed?.();
      return;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      const first = presets[0];
      if (first) {
        setSelectedId(first.id);
        setName(first.name);
        setMode(first.mode);
        setContent(first.content);
      }
      return;
    }
    if (selectedId !== '__new__') {
      const existing = presets.find((item) => item.id === selectedId);
      if (existing) {
        setName(existing.name);
        setMode(existing.mode);
        setContent(existing.content);
      }
    }
  }, [draftSeed, onConsumeSeed, presets, selectedId]);

  const activePreset =
    selectedId === '__new__' ? undefined : presets.find((item) => item.id === selectedId);
  const isDirty = activePreset
    ? activePreset.name !== name.trim() ||
      activePreset.mode !== mode ||
      activePreset.content !== content.trim()
    : name.trim().length > 0 || content.trim().length > 0;
  const canSave = name.trim().length > 0 && content.trim().length > 0 && isDirty && !saving;

  function startNewPreset(): void {
    setSelectedId('__new__');
    setName('');
    setMode('append');
    setContent('');
  }

  function selectPreset(id: string): void {
    if (id === '__new__') {
      startNewPreset();
      return;
    }
    const found = presets.find((item) => item.id === id);
    if (!found) return;
    setSelectedId(found.id);
    setName(found.name);
    setMode(found.mode);
    setContent(found.content);
  }

  async function handleSave(): Promise<void> {
    if (!config) return;
    const trimmedName = name.trim();
    const trimmedContent = content.trim();
    if (!trimmedName || !trimmedContent) {
      setError(isZh ? '请填写预设名称和提示词内容。' : 'Please enter both name and content.');
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
        content: trimmedContent,
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
        setSelectedId(targetId);
        setInfo(
          isZh ? `已保存提示词预设「${trimmedName}」。` : `Saved preset "${trimmedName}".`,
          'success',
        );
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
      for (const [path, presetId] of Object.entries(nextProjects)) {
        if (presetId === deletedId) delete nextProjects[path];
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
          setSelectedId(fallback.id);
          setName(fallback.name);
          setMode(fallback.mode);
          setContent(fallback.content);
        } else {
          startNewPreset();
        }
        setInfo(isZh ? `已删除预设「${activePreset.name}」。` : `Deleted "${activePreset.name}".`);
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
        isZh
          ? `已将「${activePreset.name}」设为全局默认。`
          : `Set "${activePreset.name}" as global default.`,
        'success',
      );
    }
  }

  return (
    <section className="settings-section settings-section-card" data-testid="system-prompts-presets-panel">
      <PageTitle
        title={isZh ? '自定义预设库' : 'Custom Presets'}
        description={
          isZh
            ? '为不同场景保存多套系统提示词，可随时在全局、项目或单会话中切换。'
            : 'Save reusable system prompt presets for different workflows.'
        }
        trailing={
          <Button
            size="compact"
            onClick={startNewPreset}
            data-testid="system-prompts-new-preset"
          >
            {isZh ? '+ 新建预设' : '+ New preset'}
          </Button>
        }
      />

      {presets.length > 0 ? (
        <FieldRow label={isZh ? '选择预设' : 'Select preset'}>
          <Select
            value={selectedId}
            testId="system-prompts-preset-select"
            onChange={(event) => selectPreset(event.currentTarget.value)}
            data={[
              ...presets.map((item) => ({
                value: item.id,
                label:
                  item.id === systemPrompts.defaultPresetId
                    ? `${item.name} · ${isZh ? '全局默认' : 'Global default'}`
                    : item.name,
              })),
              ...(selectedId === '__new__'
                ? [{ value: '__new__', label: isZh ? '（新建未保存预设）' : '(New unsaved preset)' }]
                : []),
            ]}
          />
        </FieldRow>
      ) : null}

      <FieldRow label={isZh ? '预设名称' : 'Preset name'}>
        <TextInput
          value={name}
          disabled={saving}
          placeholder={isZh ? '例如：严格代码审查、简洁翻译助手' : 'e.g. Strict Reviewer'}
          testId="system-prompts-preset-name"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </FieldRow>

      <FieldRow
        label={isZh ? '生效方式' : 'Apply mode'}
        description={
          mode === 'append'
            ? isZh
              ? '追加模式：保留 piwin 默认工作契约与工具规范，并在其后附加本提示词（推荐）。'
              : 'Append: keeps built-in contracts and tools, appending your prompt after them.'
            : isZh
              ? '替换模式：替代默认身份与运行契约，保留已启用工具与项目规则。'
              : 'Replace: replaces default identity/contract while keeping active tools and project rules.'
        }
      >
        <Select
          value={mode}
          disabled={saving}
          testId="system-prompts-preset-mode"
          onChange={(event) => setMode(event.currentTarget.value === 'replace' ? 'replace' : 'append')}
          data={[
            { value: 'append', label: isZh ? '追加到默认提示词后（推荐）' : 'Append to default (Recommended)' },
            { value: 'replace', label: isZh ? '替换默认人设与契约' : 'Replace default persona' },
          ]}
        />
      </FieldRow>

      <div className="ui-field" style={{ marginTop: 10 }}>
        <TextArea
          label={isZh ? '提示词正文' : 'Prompt content'}
          rows={12}
          maxLength={MAX_SYSTEM_PROMPT_CONTENT_CHARS}
          disabled={saving}
          value={content}
          placeholder={isZh ? '输入给模型的系统级指令…' : 'Enter system instructions for the model…'}
          onChange={(nextValue) => setContent(nextValue)}
          testId="system-prompts-preset-content"
        />
      </div>

      <div className="settings-section-actions settings-card-footer">
        <div style={{ display: 'flex', gap: 8 }}>
          {activePreset ? (
            <Button
              size="compact"
              variant="ghost"
              disabled={saving}
              onClick={() => void handleDelete()}
              data-testid="system-prompts-preset-delete"
            >
              {isZh ? '删除' : 'Delete'}
            </Button>
          ) : null}
          {activePreset && activePreset.id !== systemPrompts.defaultPresetId ? (
            <Button
              size="compact"
              variant="ghost"
              disabled={saving || isDirty}
              onClick={() => void handleSetGlobalDefault()}
              data-testid="system-prompts-preset-set-global"
            >
              {isZh ? '设为全局默认' : 'Set global default'}
            </Button>
          ) : null}
        </div>

        <Button
          size="compact"
          variant="primary"
          disabled={!canSave}
          onClick={() => void handleSave()}
          data-testid="system-prompts-preset-save"
        >
          {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存预设' : 'Save preset'}
        </Button>
      </div>
    </section>
  );
}
