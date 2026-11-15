/**
 * Compaction delegation settings panel (设置 -> 模型 -> 压缩委托).
 * Lets the user toggle compaction delegation and choose a dedicated chat model
 * used for all context compaction summarization instead of the main model.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Select, Skeleton, Switch } from '@piwin/ui-kit';
import type { CompactionConfig, CompactionDelegationConfig, ModelRef } from '@piwin/contracts';
import {
  createDefaultCompactionConfig,
  findReadyCompactionDelegate,
  formatError,
} from '@piwin/contracts';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { buildEnabledModelOptions } from '../models/model-options';
import { useSettings } from './settings-context';
import { FieldRow } from './field-row';
import { PageTitle } from './page-title';

type CompactionModelOption = {
  key: string;
  ref: ModelRef;
  label: string;
};

function modelKey(model: ModelRef | undefined): string {
  return model ? `${model.protocol}\u0000${model.providerId}\u0000${model.modelId}` : '';
}

function toCompactionModelOptions(
  providers: Parameters<typeof buildEnabledModelOptions>[0],
): CompactionModelOption[] {
  const options: CompactionModelOption[] = [];
  for (const option of buildEnabledModelOptions(providers)) {
    if (!option.protocol) {
      continue;
    }
    const ref: ModelRef = {
      protocol: option.protocol,
      providerId: option.providerId,
      modelId: option.modelId,
    };
    options.push({
      key: modelKey(ref),
      ref,
      label: option.label,
    });
  }
  return options;
}

export function CompactionDelegationSettings(): ReactElement {
  const { config, saveConfig, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';

  const current = config?.compaction?.delegation;
  const [draftEnabled, setDraftEnabled] = useState(current?.enabled ?? false);
  const [draftModel, setDraftModel] = useState<ModelRef | undefined>(current?.model);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftEnabled(config?.compaction?.delegation?.enabled ?? false);
    setDraftModel(config?.compaction?.delegation?.model);
  }, [config?.compaction?.delegation]);

  const options = useMemo(
    () => (config ? toCompactionModelOptions(config.providers) : []),
    [config],
  );

  async function handleSave(): Promise<void> {
    if (!config) return;
    if (draftEnabled && !draftModel) return;
    setSaving(true);
    try {
      const baseCompaction = config.compaction ?? createDefaultCompactionConfig();
      const nextDelegation: CompactionDelegationConfig | undefined = draftModel
        ? { enabled: draftEnabled, model: draftModel }
        : draftEnabled
          ? { enabled: true }
          : undefined;
      const { delegation: _previousDelegation, ...restCompaction } = baseCompaction;
      const nextCompaction: CompactionConfig = nextDelegation
        ? { ...restCompaction, delegation: nextDelegation }
        : restCompaction;
      const ok = await saveConfig({ ...config, compaction: nextCompaction });
      if (ok) {
        setInfo(isChinese ? '已保存压缩委托设置。' : 'Compaction delegation settings saved.');
      }
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return (
      <div className="settings-loading-inline">
        <Skeleton
          label={isChinese ? '正在加载压缩委托配置…' : 'Loading compaction delegation settings…'}
          rows={[35, 80]}
        />
      </div>
    );
  }

  const currentEnabled = current?.enabled ?? false;
  const dirty = draftEnabled !== currentEnabled || modelKey(draftModel) !== modelKey(current?.model);
  const selectedKey = modelKey(draftModel);
  const hasSelectedOption = Boolean(selectedKey && options.some((option) => option.key === selectedKey));
  const noModels = options.length === 0;
  const savedDelegateUnavailable =
    Boolean(current?.enabled && current.model) &&
    findReadyCompactionDelegate({
      ...(config.compaction ? { compaction: config.compaction } : {}),
      providers: config.providers,
    }) === undefined;
  const missingModelForEnabled = draftEnabled && !draftModel;

  return (
    <div data-testid="compaction-delegation-settings">
      <PageTitle
        title={isChinese ? '压缩委托' : 'Compaction delegation'}
        description={
          isChinese
            ? '启用并选择模型保存后，所有上下文压缩摘要将统一走该委托模型，不再使用当前会话主模型。'
            : 'When enabled and saved with a model, all context compaction summaries route to this delegated model instead of the active main model.'
        }
        trailing={
          dirty ? (
            <span className="settings-dirty-badge" data-testid="compaction-delegation-status">
              {isChinese ? '未保存' : 'Unsaved'}
            </span>
          ) : null
        }
      />

      <section className="settings-section settings-section-card">
        <FieldRow
          label={isChinese ? '启用压缩委托' : 'Enable compaction delegation'}
          description={
            isChinese
              ? '开启后对手动 /compact、自动阈值/溢出压缩与切换前压缩均生效。'
              : 'Applies to manual /compact, automatic threshold/overflow compaction, and pre-switch compaction.'
          }
        >
          <Switch
            checked={draftEnabled}
            disabled={saving}
            testId="compaction-delegation-enabled"
            onCheckedChange={setDraftEnabled}
            aria-label={isChinese ? '启用压缩委托' : 'Enable compaction delegation'}
          />
        </FieldRow>

        <FieldRow
          label={isChinese ? '委托模型' : 'Delegated model'}
          description={
            isChinese
              ? '可从已启用的第三方服务商中任选聊天模型专门负责上下文摘要压缩。'
              : 'Choose any enabled chat model (including third-party providers) to perform context summarization.'
          }
        >
          <Select
            disabled={saving || (noModels && !hasSelectedOption && !selectedKey)}
            value={selectedKey}
            testId="compaction-delegation-model"
            aria-label={isChinese ? '委托模型' : 'Delegated model'}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const option = options.find((item) => item.key === value);
              if (!option) {
                setDraftModel(undefined);
                return;
              }
              setDraftModel(option.ref);
            }}
            data={[
              {
                value: '',
                label: noModels
                  ? isChinese
                    ? '暂无可用聊天模型'
                    : 'No enabled chat models'
                  : isChinese
                    ? '请选择模型…'
                    : 'Select a model…',
              },
              ...(selectedKey && !hasSelectedOption && draftModel
                ? [
                    {
                      value: selectedKey,
                      label: `${draftModel.providerId} / ${draftModel.modelId} (${isChinese ? '当前不可用' : 'unavailable'})`,
                    },
                  ]
                : []),
              ...options.map((option) => ({ value: option.key, label: option.label })),
            ]}
          />
        </FieldRow>

        {missingModelForEnabled ? (
          <p className="settings-note-line" data-testid="compaction-delegation-missing-model">
            {isChinese
              ? '请先选择用于压缩的委托模型，再点击保存。'
              : 'Select a delegated chat model before saving.'}
          </p>
        ) : savedDelegateUnavailable ? (
          <p className="settings-note-line" data-testid="compaction-delegation-unavailable-warning">
            {isChinese
              ? '当前已保存的委托模型或其服务商未启用，压缩将失败直至更新模型或关闭开关。'
              : 'The saved delegated model or its provider is disabled; compaction will fail until updated or disabled.'}
          </p>
        ) : null}

        <div className="settings-section-actions settings-card-footer">
          <span className="settings-note-line">
            {isChinese
              ? '保存后新会话及空闲会话将自动切换为委托模型压缩。'
              : 'New sessions and idle runtimes switch to the delegated model after saving.'}
          </span>
          <Button
            variant="primary"
            disabled={saving || !dirty || missingModelForEnabled}
            data-testid="compaction-delegation-save"
            onClick={() => void handleSave()}
          >
            {saving ? (isChinese ? '保存中…' : 'Saving…') : isChinese ? '保存' : 'Save'}
          </Button>
        </div>
      </section>
    </div>
  );
}
