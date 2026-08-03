/**
 * Settings → Models → Vision Delegation (text-only primary models).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Field, FieldCheckbox } from '@piwin/ui-kit';
import type {
  ModelRef,
  PiwinConfig,
  VisionDelegationConfig,
  VisionDelegateResult,
} from '@piwin/contracts';
import { isProviderEnabled } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { useSettings } from './settings/settings-context';
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
        setInfo(isChinese ? '已保存视觉委派设置。' : 'Vision delegation settings saved.');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestDescribe(): Promise<void> {
    if (isDirty) {
      setTestResult(
        isChinese
          ? '当前选择尚未保存，请先点击“保存设置”。'
          : 'The current selection is not saved. Click Save settings first.',
      );
      return;
    }
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
      const message = error instanceof Error ? error.message : String(error);
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
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  if (!config) {
    return <p className="muted">{isChinese ? '正在加载…' : 'Loading…'}</p>;
  }

  return (
    <div data-testid="vision-delegation-settings">
      <PageTitle
        title={isChinese ? '视觉委派' : 'Vision Delegation'}
        description={
          isChinese
            ? '当主模型仅支持文本时，用视觉模型描述粘贴/拖入的图片，再注入主对话。'
            : 'When the primary model is text-only, describe pasted/dropped images with a vision model before the main turn.'
        }
        trailing={
          <span
            className={`vision-settings-status ${draftEnabled ? 'vision-settings-status--enabled' : ''}`}
            data-testid="vision-delegation-status"
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
          label={isChinese ? '启用视觉委派' : 'Enable vision delegation'}
          description={
            isChinese
              ? '开启后，主模型仅支持文本时会用视觉模型描述图片并注入主对话。'
              : 'When on, a vision model describes images before the turn when the primary model is text-only.'
          }
          checked={draftEnabled}
          disabled={saving}
          onCheckedChange={setDraftEnabled}
          data-testid="vision-delegation-enabled"
        />

        <div className="vision-settings-model-field">
          <Field label={isChinese ? '视觉模型' : 'Vision model'}>
            <select
              className="mcp-raw-editor"
              disabled={saving || options.length === 0}
              value={selectedKey}
              data-testid="vision-delegation-model"
              onChange={(event) => {
                const option = options.find((item) => item.key === event.currentTarget.value);
                if (!option) return;
                setDraftModel(option.ref);
              }}
            >
              <option value="">
                {options.length === 0
                  ? isChinese
                    ? '没有标记为 Vision 的模型'
                    : 'No vision-capable models configured'
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
          <p className="vision-settings-field-note">
            {isChinese
              ? '模型列表来自本地 input 标记；验证图片会实际请求网关，以确认它真的接受图像输入。'
              : 'The list uses local input tags; Test image sends a real request to verify that the gateway accepts image input.'}
          </p>
        </div>

        <div className="vision-settings-actions">
          <Button
            size="compact"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            data-testid="vision-delegation-save"
          >
            {saving
              ? isChinese
                ? '保存中…'
                : 'Saving…'
              : isChinese
                ? '保存设置'
                : 'Save settings'}
          </Button>
          <Button
            size="compact"
            disabled={saving || testing || isDirty || !draftEnabled || !selectedKey}
            onClick={() => void handleTestDescribe()}
            data-testid="vision-delegation-test"
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
            variant="ghost"
            disabled={saving}
            onClick={() => void handleClearCache()}
            data-testid="vision-delegation-clear-cache"
          >
            {isChinese ? '清空缓存' : 'Clear cache'}
          </Button>
        </div>

        {testResult ? (
          <p className="vision-settings-test-result" data-testid="vision-delegation-test-result">
            {testResult}
          </p>
        ) : null}

        {isDirty ? (
          <p className="vision-settings-unsaved-note" data-testid="vision-delegation-unsaved-note">
            {isChinese
              ? '模型或启用状态已修改但尚未保存。保存后才能验证当前模型，新的会话也会使用保存后的配置。'
              : 'The model or enabled state has changed but is not saved. Save before testing; new sessions use the saved configuration.'}
          </p>
        ) : null}

        <p className="vision-settings-note">
          {isChinese
            ? '仅列出已启用且标记为支持图片的模型。未启用时，文本模型会使用路径注入兜底。'
            : 'Only enabled models tagged with image input are listed. When disabled, text-only models fall back to path injection.'}
        </p>

        <p className="vision-settings-note" data-testid="vision-handoff-note">
          {isChinese
            ? '说明：模型通过 read 工具读到的图片不经过 host 分流。若需要在 text-only 主模型上处理 read 图，可安装 Pi extension「pi-vision-handoff」（需模型 input 已正确标记）。Composer 粘贴图由 piwin host 处理，不依赖该 extension。'
            : 'Note: images returned by the model read tool are not routed by the host. For text-only primaries that need read-tool images, install the Pi extension “pi-vision-handoff” (requires correct model input flags). Composer paste/drop images are handled by the piwin host and do not require that extension.'}
        </p>
      </div>
    </div>
  );
}
