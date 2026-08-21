/**
 * Settings → Models → Reply Writer (post-turn output rewrite).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Field, FieldCheckbox } from '@piwin/ui-kit';
import type { ModelRef, PiwinConfig, ReplyWriterConfig, ReplyWriterLanguage } from '@piwin/contracts';
import { formatError, isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { useSettings } from './settings/settings-context';
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

  return (
    <div data-testid="reply-writer-settings">
      <PageTitle
        title={isChinese ? '输出委托' : 'Reply Writer'}
        description={
          isChinese
            ? '干活模型跑完后，用另一个模型把可见回复改写成能读的人话。工具和改文件仍由当前会话模型完成。'
            : 'After the worker model finishes, rewrite the visible reply with another model. Tools and edits still use the session model.'
        }
        trailing={
          <span
            className={`vision-settings-status ${draftEnabled ? 'vision-settings-status--enabled' : ''}`}
            data-testid="reply-writer-status"
          >
            {isDirty
              ? isChinese
                ? '有未保存修改'
                : 'Unsaved changes'
              : draftEnabled
                ? isChinese
                  ? '已启用'
                  : 'Enabled'
                : isChinese
                  ? '未启用'
                  : 'Disabled'}
          </span>
        }
      />

      <div className="vision-settings-body">
        <FieldCheckbox
          label={isChinese ? '启用输出委托' : 'Enable reply writer'}
          description={
            isChinese
              ? '开启后，每轮成功结束都会多一次写作模型调用，并替换气泡正文。原草稿会留在记录里。'
              : 'When on, each successful turn makes one extra writer call and replaces the bubble text. The worker draft is kept on the record.'
          }
          checked={draftEnabled}
          disabled={saving}
          onCheckedChange={setDraftEnabled}
          data-testid="reply-writer-enabled"
        />

        <div className="vision-settings-model-field">
          <Field label={isChinese ? '写作模型' : 'Writer model'}>
            <select
              className="mcp-raw-editor"
              disabled={saving || options.length === 0}
              value={selectedKey}
              data-testid="reply-writer-model"
              onChange={(event) => {
                const option = options.find((item) => item.key === event.currentTarget.value);
                if (!option) return;
                setDraftModel(option.ref);
              }}
            >
              <option value="">
                {options.length === 0
                  ? isChinese
                    ? '没有可用的对话模型'
                    : 'No chat models configured'
                  : isChinese
                    ? '选择模型…'
                    : 'Select a model…'}
              </option>
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={isChinese ? '输出语言' : 'Output language'}>
          <select
            className="mcp-raw-editor"
            disabled={saving}
            value={draftLanguage}
            data-testid="reply-writer-language"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'zh-CN' || value === 'en' || value === 'follow-user') {
                setDraftLanguage(value);
              }
            }}
          >
            <option value="zh-CN">{isChinese ? '简体中文' : 'Simplified Chinese'}</option>
            <option value="en">{isChinese ? '英文' : 'English'}</option>
            <option value="follow-user">{isChinese ? '跟用户语言' : 'Follow the user'}</option>
          </select>
        </Field>

        <div className="vision-settings-actions">
          <Button
            size="compact"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            data-testid="reply-writer-save"
          >
            {saving
              ? isChinese
                ? '保存中…'
                : 'Saving…'
              : isChinese
                ? '保存设置'
                : 'Save settings'}
          </Button>
        </div>

        <p className="vision-settings-note">
          {isChinese
            ? '写作模型和干活模型相同时会跳过。子代理和侧边对话不会改写。失败时保留原来的正文。'
            : 'Skipped when the writer is the same as the worker. Subagents and side chats are not rewritten. Failures keep the original text.'}
        </p>
      </div>
    </div>
  );
}
