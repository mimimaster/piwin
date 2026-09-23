/**
 * Settings → Models → Vision Delegation (text-only primary models).
 *
 * Laid out with the shared settings primitives (PageTitle + FieldRow) rather
 * than a bespoke stack, so it reads like every other settings page: one row
 * per decision, label left, control right. Explanations live on the row they
 * belong to; the one genuinely advanced note sits behind a disclosure.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Select, Switch } from '@piwin/ui-kit';
import type {
  ModelRef,
  PiwinConfig,
  VisionDelegationConfig,
  VisionDelegateResult,
} from '@piwin/contracts';
import { formatError,  isProviderEnabled } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { useSettings } from './settings/settings-context';
import { FieldRow } from './settings/field-row';
import { PageTitle } from './settings/page-title';

function visionCapableOptions(config: PiwinConfig): Array<{
  key: string;
  label: string;
  ref: ModelRef;
}> {
  const options: Array<{ key: string; label: string; ref: ModelRef }> = [];
  for (const provider of config.providers) {
    if (!isProviderEnabled(provider)) continue;
    for (const model of provider.models) {
      if (!model.input?.includes('image')) continue;
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

/** 1x1 PNG for settings smoke test. */
const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function VisionDelegationSettings(): ReactElement {
  const { config, saveConfig, setError, setInfo, request } = useSettings();
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftModel, setDraftModel] = useState<ModelRef | undefined>(undefined);

  const options = useMemo(() => (config ? visionCapableOptions(config) : []), [config]);
  const current = config?.visionDelegation;
  const savedEnabled = current?.enabled === true;
  const savedModel = current?.model;
  const selectedKey = draftModel ? `${draftModel.providerId}::${draftModel.modelId}` : '';
  const isDirty =
    draftEnabled !== savedEnabled ||
    draftModel?.providerId !== savedModel?.providerId ||
    draftModel?.modelId !== savedModel?.modelId;

  useEffect(() => {
    setDraftEnabled(current?.enabled === true);
    setDraftModel(current?.model);
  }, [current?.enabled, current?.model]);

  async function handleSave(): Promise<void> {
    if (!config) return;
    setSaving(true);
    try {
      const next: VisionDelegationConfig = {
        enabled: draftEnabled,
        ...(draftModel ? { model: draftModel } : {}),
        ...(current?.systemPrompt ? { systemPrompt: current.systemPrompt } : {}),
        ...(current?.timeoutMs !== undefined ? { timeoutMs: current.timeoutMs } : {}),
        ...(current?.cacheEnabled !== undefined ? { cacheEnabled: current.cacheEnabled } : {}),
      };
      const ok = await saveConfig({ ...config, visionDelegation: next });
      if (ok) {
        setInfo(isChinese ? '已保存视觉委托设置。' : 'Vision delegation settings saved.');
      }
    } catch (error) {
      setError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestDescribe(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await request({
        type: 'vision/delegate',
        input: {
          mimeType: 'image/png',
          imageBase64: TEST_PNG_BASE64,
        },
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as VisionDelegateResult;
      setTestResult(
        isChinese
          ? `描述成功（${data.durationMs}ms${data.cacheHit ? ' · 缓存' : ''}）：${data.description}`
          : `OK (${data.durationMs}ms${data.cacheHit ? ' · cache' : ''}): ${data.description}`,
      );
    } catch (error) {
      const message = formatError(error);
      setError(message);
      setTestResult(isChinese ? `失败：${message}` : `Failed: ${message}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleClearCache(): Promise<void> {
    try {
      const response = await request({ type: 'vision/cache/clear' });
      if (!response.success) {
        throw new Error(response.error);
      }
      setInfo(isChinese ? '已清空视觉描述缓存。' : 'Vision description cache cleared.');
    } catch (error) {
      setError(formatError(error));
    }
  }

  if (!config) {
    return <p className="muted">{isChinese ? '正在加载…' : 'Loading…'}</p>;
  }

  const noModels = options.length === 0;

  return (
    <div data-testid="vision-delegation-settings">
      <section className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '视觉委托' : 'Vision Delegation'}
          description={
            isChinese
              ? '主模型只认文本时，先用视觉模型把图片转成文字描述。'
              : 'When the primary model is text-only, turn images into text with a vision model first.'
          }
          trailing={
            isDirty ? (
              <span className="settings-dirty-badge" data-testid="vision-delegation-status">
                {isChinese ? '未保存' : 'Unsaved'}
              </span>
            ) : null
          }
        />

        <FieldRow
          label={isChinese ? '启用' : 'Enabled'}
          description={
            isChinese
              ? '关闭时，文本模型改用路径注入兜底。'
              : 'When off, text-only models fall back to path injection.'
          }
        >
          <Switch
            checked={draftEnabled}
            disabled={saving}
            onCheckedChange={setDraftEnabled}
            aria-label={isChinese ? '启用视觉委托' : 'Enable vision delegation'}
            testId="vision-delegation-enabled"
          />
        </FieldRow>

        <FieldRow
          label={isChinese ? '视觉模型' : 'Vision model'}
          description={
            isChinese
              ? '只列出已启用、且标记支持图片的模型。'
              : 'Only enabled models tagged with image input are listed.'
          }
        >
          <Select
            disabled={saving || noModels}
            value={selectedKey}
            testId="vision-delegation-model"
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
                    ? '没有可用的视觉模型'
                    : 'No vision-capable models'
                  : isChinese
                    ? '选择模型…'
                    : 'Select a model…',
              },
              ...options.map((option) => ({ value: option.key, label: option.label })),
            ]}
          />
        </FieldRow>

        <div className="settings-section-actions settings-card-footer">
          <Button
            size="compact"
            variant="ghost"
            disabled={saving}
            onClick={() => void handleClearCache()}
            data-testid="vision-delegation-clear-cache"
          >
            {isChinese ? '清空缓存' : 'Clear cache'}
          </Button>
          <Button
            size="compact"
            disabled={saving || testing || isDirty || !draftEnabled || !selectedKey}
            onClick={() => void handleTestDescribe()}
            data-testid="vision-delegation-test"
            title={
              isChinese
                ? '发一张 1×1 测试图，确认网关真的接受图像输入'
                : 'Sends a 1×1 test image to confirm the gateway really accepts image input'
            }
          >
            {testing
              ? isChinese
                ? '描述中…'
                : 'Describing…'
              : isChinese
                ? '验证图片'
                : 'Test image'}
          </Button>
          <Button
            size="compact"
            variant="primary"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            data-testid="vision-delegation-save"
          >
            {saving ? (isChinese ? '保存中…' : 'Saving…') : isChinese ? '保存' : 'Save'}
          </Button>
        </div>

        {testResult ? (
          <p className="settings-result-well" data-testid="vision-delegation-test-result">
            {testResult}
          </p>
        ) : null}
      </section>

      <details className="settings-note-details" data-testid="vision-handoff-note">
        <summary>{isChinese ? 'read 工具读到的图片' : 'Images from the read tool'}</summary>
        <p>
          {isChinese
            ? '不走 host 分流。text-only 主模型要处理这类图，需装 Pi extension「pi-vision-handoff」。Composer 粘贴/拖入的图不受影响。'
            : 'Not routed by the host. A text-only primary needs the Pi extension “pi-vision-handoff” to handle them. Composer paste/drop images are unaffected.'}
        </p>
      </details>
    </div>
  );
}
