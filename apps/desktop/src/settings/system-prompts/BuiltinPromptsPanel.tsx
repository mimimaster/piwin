/**
 * Built-in module system prompts directory: inspect, override, reset to default, or clone as preset.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button, Select, StatusBadge, TextArea } from '@piwin/ui-kit';
import {
  applyBuiltinSystemPromptOverride,
  BUILTIN_SYSTEM_PROMPTS,
  MAX_SYSTEM_PROMPT_CONTENT_CHARS,
  readBuiltinSystemPromptValue,
  type BuiltinSystemPromptSlotId,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import type { PresetDraftSeed } from './CustomPresetsPanel';

export function BuiltinPromptsPanel(props: {
  initialSlotId?: BuiltinSystemPromptSlotId | undefined;
  onSaveAsPreset?: (seed: PresetDraftSeed) => void;
}): ReactElement {
  const { config, saveConfig, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [slotId, setSlotId] = useState<BuiltinSystemPromptSlotId>(
    props.initialSlotId ?? 'agent.default',
  );
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.initialSlotId) {
      setSlotId(props.initialSlotId);
    }
  }, [props.initialSlotId]);

  const resolved = readBuiltinSystemPromptValue(config, slotId);
  const { descriptor, isOverridden, effectiveContent } = resolved;

  useEffect(() => {
    setDraft(effectiveContent);
  }, [effectiveContent, slotId]);

  const trimmedDraft = draft.trim();
  const isDirty = descriptor.overridable && trimmedDraft !== effectiveContent.trim();
  const canReset =
    descriptor.overridable && (isOverridden || trimmedDraft !== descriptor.defaultContent.trim());

  async function handleSaveOverride(): Promise<void> {
    if (!config || !descriptor.overridable) return;
    setSaving(true);
    try {
      const next = applyBuiltinSystemPromptOverride(config, descriptor.slotId as never, trimmedDraft);
      const ok = await saveConfig(next, { quiet: true });
      if (ok) {
        setInfo(
          isZh
            ? `已保存「${descriptor.titleZh}」覆写。`
            : `Saved override for "${descriptor.titleEn}".`,
          'success',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDefault(): Promise<void> {
    if (!config || !descriptor.overridable) return;
    setSaving(true);
    try {
      const next = applyBuiltinSystemPromptOverride(config, descriptor.slotId as never, null);
      const ok = await saveConfig(next, { quiet: true });
      if (ok) {
        setDraft(descriptor.defaultContent);
        setInfo(
          isZh
            ? `已恢复「${descriptor.titleZh}」为系统默认。`
            : `Restored "${descriptor.titleEn}" to default.`,
          'success',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section settings-section-card" data-testid="system-prompts-builtins-panel">
      <PageTitle
        title={isZh ? '系统内置提示词' : 'Built-in System Prompts'}
        description={
          isZh
            ? '集中查看各模块默认系统提示词，支持微调覆写或一键恢复默认。'
            : 'Inspect default system prompts per module, customize them, or restore defaults.'
        }
        trailing={
          <StatusBadge
            tone={isOverridden ? 'warning' : 'neutral'}
            label={
              !descriptor.overridable
                ? isZh
                  ? '只读契约'
                  : 'Read-only'
                : isOverridden
                  ? isZh
                    ? '已自定义'
                    : 'Customized'
                  : isZh
                    ? '系统默认'
                    : 'Default'
            }
          />
        }
      />

      <FieldRow
        label={isZh ? '选择模块' : 'Module'}
        description={isZh ? descriptor.descriptionZh : descriptor.descriptionEn}
      >
        <Select
          value={slotId}
          testId="system-prompts-builtin-select"
          onChange={(event) => setSlotId(event.currentTarget.value as BuiltinSystemPromptSlotId)}
          data={BUILTIN_SYSTEM_PROMPTS.map((item) => {
            const state = readBuiltinSystemPromptValue(config, item.slotId);
            const title = isZh ? item.titleZh : item.titleEn;
            const suffix = !item.overridable
              ? isZh
                ? ' · 只读'
                : ' · Read-only'
              : state.isOverridden
                ? isZh
                  ? ' · 已修改'
                  : ' · Modified'
                : '';
            return { value: item.slotId, label: `${title}${suffix}` };
          })}
        />
      </FieldRow>

      <div className="ui-field" style={{ marginTop: 10 }}>
        <TextArea
          label={isZh ? '提示词内容' : 'Prompt content'}
          rows={13}
          maxLength={MAX_SYSTEM_PROMPT_CONTENT_CHARS}
          disabled={!descriptor.overridable || saving}
          value={draft}
          onChange={(nextValue) => setDraft(nextValue)}
          testId="system-prompts-builtin-content"
        />
      </div>

      <div className="settings-section-actions settings-card-footer">
        <div style={{ display: 'flex', gap: 8 }}>
          {props.onSaveAsPreset ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() =>
                props.onSaveAsPreset?.({
                  name: isZh ? `${descriptor.titleZh} 副本` : `${descriptor.titleEn} Copy`,
                  content: draft,
                  mode: 'replace',
                })
              }
              data-testid="system-prompts-builtin-clone"
            >
              {isZh ? '另存为自定义预设' : 'Save as preset'}
            </Button>
          ) : null}
          {descriptor.overridable ? (
            <Button
              size="compact"
              variant="ghost"
              disabled={!canReset || saving}
              onClick={() => void handleResetDefault()}
              data-testid="system-prompts-builtin-reset"
            >
              {isZh ? '恢复默认' : 'Restore default'}
            </Button>
          ) : null}
        </div>

        {descriptor.overridable ? (
          <Button
            size="compact"
            variant="primary"
            disabled={!isDirty || trimmedDraft.length === 0 || saving}
            onClick={() => void handleSaveOverride()}
            data-testid="system-prompts-builtin-save"
          >
            {saving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存修改' : 'Save override'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
