/**
 * Settings → Models → Vision Delegation (text-only primary models).
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button, Field, FieldCheckbox } from '@piwin/ui-kit';
import type {
  ModelRef,
  PiwinConfig,
  VisionDelegationConfig,
  VisionDelegateResult,
} from '@piwin/contracts';
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

  const options = useMemo(() => (config ? visionCapableOptions(config) : []), [config]);
  const current = config?.visionDelegation;
  const enabled = current?.enabled === true;
  const selectedKey = current?.model ? `${current.model.providerId}::${current.model.modelId}` : '';

  async function patch(next: VisionDelegationConfig): Promise<void> {
    if (!config) return;
    setSaving(true);
    try {
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
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
        <FieldCheckbox
          label={isChinese ? '启用视觉委派' : 'Enable vision delegation'}
          description={
            isChinese
              ? '开启后，主模型仅支持文本时会用视觉模型描述图片并注入主对话。'
              : 'When on, a vision model describes images before the turn when the primary model is text-only.'
          }
          checked={enabled}
          disabled={saving}
          onCheckedChange={(checked) => {
            void patch({
              enabled: checked,
              ...(current?.model ? { model: current.model } : {}),
              ...(current?.systemPrompt ? { systemPrompt: current.systemPrompt } : {}),
              ...(current?.timeoutMs !== undefined ? { timeoutMs: current.timeoutMs } : {}),
              ...(current?.cacheEnabled !== undefined
                ? { cacheEnabled: current.cacheEnabled }
                : {}),
            });
          }}
          data-testid="vision-delegation-enabled"
        />

        <Field label={isChinese ? '视觉模型' : 'Vision model'}>
          <select
            className="mcp-raw-editor"
            style={{ height: 'auto', padding: '8px 12px' }}
            disabled={saving || options.length === 0}
            value={selectedKey}
            data-testid="vision-delegation-model"
            onChange={(event) => {
              const option = options.find((item) => item.key === event.currentTarget.value);
              if (!option) return;
              void patch({
                enabled,
                model: option.ref,
                ...(current?.systemPrompt ? { systemPrompt: current.systemPrompt } : {}),
                ...(current?.timeoutMs !== undefined ? { timeoutMs: current.timeoutMs } : {}),
                ...(current?.cacheEnabled !== undefined
                  ? { cacheEnabled: current.cacheEnabled }
                  : {}),
              });
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

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            size="compact"
            disabled={saving || testing || !enabled || !selectedKey}
            onClick={() => void handleTestDescribe()}
            data-testid="vision-delegation-test"
          >
            {testing
              ? isChinese
                ? '描述中…'
                : 'Describing…'
              : isChinese
                ? '测试描述'
                : 'Test describe'}
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
          <p
            className="muted"
            style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}
            data-testid="vision-delegation-test-result"
          >
            {testResult}
          </p>
        ) : null}

        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {isChinese
            ? '仅列出 input 含 image 的已配置模型。未启用时，文本模型会使用路径注入兜底。'
            : 'Only configured models with image input are listed. When disabled, text-only models fall back to path injection.'}
        </p>

        <p className="muted" style={{ fontSize: 12, margin: 0 }} data-testid="vision-handoff-note">
          {isChinese
            ? '说明：模型通过 read 工具读到的图片不经过 host 分流。若需要在 text-only 主模型上处理 read 图，可安装 Pi extension「pi-vision-handoff」（需模型 input 已正确标记）。Composer 粘贴图由 piwin host 处理，不依赖该 extension。'
            : 'Note: images returned by the model read tool are not routed by the host. For text-only primaries that need read-tool images, install the Pi extension “pi-vision-handoff” (requires correct model input flags). Composer paste/drop images are handled by the piwin host and do not require that extension.'}
        </p>
      </div>
    </div>
  );
}
