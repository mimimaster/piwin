/**
 * Settings → Models → Reply Writer (post-turn output rewrite).
 *
 * Shares the settings-row layout with Vision Delegation — see the note at the
 * top of VisionDelegationSettings.tsx.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Select, Switch } from '@piwin/ui-kit';
import type { ModelRef, PiwinConfig, ReplyWriterConfig, ReplyWriterLanguage } from '@piwin/contracts';
import { formatError, isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { useSettings } from './settings/settings-context';
import { FieldRow } from './settings/field-row';
import { PageTitle } from './settings/page-title';

function chatModelOptions(config: PiwinConfig): Array<{
  key: string;
  label: string;
  ref: ModelRef;
}> {
  const options: Array<{ key: string; label: string; ref: ModelRef }> = [];
  for (const provider of config.providers) {
    if (!isProviderEnabled(provider)) continue;
    for (const model of provider.models) {
      if (!isModelEnabled(model) || !modelSupportsCapability(model, 'chat')) continue;
      options.push({
        key: `${provider.id}::${model.id}`,
        label: `${provider.name} / ${model.label ?? model.id}`,
        ref: {
          protocol: provider.protocol,
          providerId: provider.id,
          modelId: model.id,
        },
      });
    }
  }
  return options;
}

export function ReplyWriterSettings(): ReactElement {
  const { config, saveConfig, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftModel, setDraftModel] = useState<ModelRef | undefined>(undefined);
  const [draftLanguage, setDraftLanguage] = useState<ReplyWriterLanguage>('zh-CN');

  const options = useMemo(() => (config ? chatModelOptions(config) : []), [config]);
  const current = config?.replyWriter;
  const savedEnabled = current?.enabled === true;
  const savedModel = current?.model;
  const savedLanguage = current?.language ?? 'zh-CN';
  const selectedKey = draftModel ? `${draftModel.providerId}::${draftModel.modelId}` : '';
  const isDirty =
    draftEnabled !== savedEnabled ||
    draftLanguage !== savedLanguage ||
    draftModel?.providerId !== savedModel?.providerId ||
    draftModel?.modelId !== savedModel?.modelId;

  useEffect(() => {
    setDraftEnabled(current?.enabled === true);
    setDraftModel(current?.model);
    setDraftLanguage(current?.language ?? 'zh-CN');
  }, [current?.enabled, current?.language, current?.model]);

  async function handleSave(): Promise<void> {
    if (!config) return;
    setSaving(true);
    try {
      const next: ReplyWriterConfig = {
        enabled: draftEnabled,
        language: draftLanguage,
        ...(draftModel ? { model: draftModel } : {}),
        ...(current?.systemPrompt ? { systemPrompt: current.systemPrompt } : {}),
        ...(current?.timeoutMs !== undefined ? { timeoutMs: current.timeoutMs } : {}),
      };
      const ok = await saveConfig({ ...config, replyWriter: next });
      if (ok) {
        setInfo(isChinese ? '已保存输出委托设置。' : 'Reply writer settings saved.');
      }
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <p className="muted">{isChinese ? '正在加载…' : 'Loading…'}</p>;
  }

  const noModels = options.length === 0;

  return (
    <div data-testid="reply-writer-settings">
      <section className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '输出委托' : 'Reply Writer'}
          description={
            isChinese
              ? '主模型跑完后，由写作模型重写最终回复的措辞。'
              : 'After the worker model finishes, another model rewrites the visible reply.'
          }
          trailing={
            isDirty ? (
              <span className="settings-dirty-badge" data-testid="reply-writer-status">
                {isChinese ? '未保存' : 'Unsaved'}
              </span>
            ) : null
          }
        />

        <FieldRow
          label={isChinese ? '启用' : 'Enabled'}
          description={
            isChinese
              ? '每轮多一次模型调用，原始草稿保留在记录里。'
              : 'One extra model call per turn; the original draft is kept on the record.'
          }
        >
          <Switch
            checked={draftEnabled}
            disabled={saving}
            onCheckedChange={setDraftEnabled}
            aria-label={isChinese ? '启用输出委托' : 'Enable reply writer'}
            testId="reply-writer-enabled"
          />
        </FieldRow>

        <FieldRow
          label={isChinese ? '写作模型' : 'Writer model'}
          description={
            isChinese
              ? '与主模型相同时自动跳过。'
              : 'Skipped automatically when it matches the worker model.'
          }
        >
          <Select
            disabled={saving || noModels}
            value={selectedKey}
            testId="reply-writer-model"
            onChange={(event) => {
              const option = options.find((item) => item.key === event.currentTarget.value);
              if (!option) return;
              setDraftModel(option.ref);
            }}
            data={[
              {
                value: '',
                label: noModels
                  ? isChinese
                    ? '没有可用的对话模型'
                    : 'No chat models'
                  : isChinese
                    ? '选择模型…'
                    : 'Select a model…',
              },
              ...options.map((option) => ({ value: option.key, label: option.label })),
            ]}
          />
        </FieldRow>

        <FieldRow label={isChinese ? '输出语言' : 'Output language'}>
          <Select
            disabled={saving}
            value={draftLanguage}
            testId="reply-writer-language"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'zh-CN' || value === 'en' || value === 'follow-user') {
                setDraftLanguage(value);
              }
            }}
            data={[
              { value: 'zh-CN', label: isChinese ? '简体中文' : 'Simplified Chinese' },
              { value: 'en', label: isChinese ? '英文' : 'English' },
              { value: 'follow-user', label: isChinese ? '跟随提问语言' : 'Follow the user' },
            ]}
          />
        </FieldRow>

        <div className="settings-section-actions settings-card-footer">
          <span className="settings-note-line">
            {isChinese
              ? '子代理与侧边会话不改写；调用失败保留原文。'
              : 'Subagents and side chats are not rewritten; failures keep the original text.'}
          </span>
          <Button
            size="compact"
            variant="primary"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            data-testid="reply-writer-save"
          >
            {saving ? (isChinese ? '保存中…' : 'Saving…') : isChinese ? '保存' : 'Save'}
          </Button>
        </div>
      </section>
    </div>
  );
}
