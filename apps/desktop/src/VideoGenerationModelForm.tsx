import { Button, Field } from '@piwin/ui-kit';
import type { ModelProviderConfig, VideoGenerationApiStyle } from '@piwin/contracts';
import type { DesktopLocale, DesktopTranslator } from './desktop-locale';
import { VIDEO_API_STYLE_OPTIONS, videoApiStyleLabel } from './video-generation-model-config';

type VideoGenerationCopy = DesktopTranslator['settings']['videoGeneration'];

export type VideoGenerationModelFormProps = {
  locale: DesktopLocale;
  copy: VideoGenerationCopy;
  providers: readonly ModelProviderConfig[];
  selectedProvider: ModelProviderConfig | null;
  effectiveProviderId: string;
  editingKey: string | null;
  modelId: string;
  apiStyle: VideoGenerationApiStyle;
  modelPath: string;
  timeoutSeconds: string;
  pollIntervalSeconds: string;
  modelLabel: string;
  modelDescription: string;
  onProviderChange: (providerId: string) => void;
  onApiStyleChange: (apiStyle: VideoGenerationApiStyle) => void;
  onModelIdChange: (value: string) => void;
  onModelPathChange: (value: string) => void;
  onTimeoutChange: (value: string) => void;
  onPollIntervalChange: (value: string) => void;
  onModelLabelChange: (value: string) => void;
  onModelDescriptionChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function VideoGenerationModelForm(props: VideoGenerationModelFormProps) {
  const {
    locale,
    copy,
    providers,
    selectedProvider,
    effectiveProviderId,
    editingKey,
    modelId,
    apiStyle,
    modelPath,
    timeoutSeconds,
    pollIntervalSeconds,
    modelLabel,
    modelDescription,
    onProviderChange,
    onApiStyleChange,
    onModelIdChange,
    onModelPathChange,
    onTimeoutChange,
    onPollIntervalChange,
    onModelLabelChange,
    onModelDescriptionChange,
    onCancel,
    onSubmit,
  } = props;

  return (
    <div className="image-gen-form" style={{ marginTop: 16 }}>
      <div className="image-gen-section-group">
        <div
          className="ui-field-label"
          style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: 12 }}
        >
          {locale === 'zh-CN' ? '接口通道、协议与模型 ID' : 'Channel, protocol & model ID'}
        </div>

        <div
          className="image-gen-form-row image-gen-form-row--full"
          data-testid="video-gen-provider-select"
        >
          <Field label={locale === 'zh-CN' ? '* 接口通道' : `* ${copy.provider}`}>
            <select
              className="mcp-raw-editor"
              style={{
                height: 'auto',
                padding: '9px 12px',
                width: '100%',
                borderRadius: 8,
                fontSize: 13.5,
              }}
              data-testid="video-gen-provider-select-control"
              value={effectiveProviderId}
              disabled={Boolean(editingKey)}
              onChange={(event) => onProviderChange(event.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name || provider.id}
                  {provider.enabled === false ? (locale === 'zh-CN' ? '（已关闭）' : ' (off)') : ''}
                </option>
              ))}
            </select>
          </Field>
          <div
            className="image-gen-provider-meta muted"
            style={{ marginTop: 6, fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}
          >
            <span data-testid="video-gen-baseurl">{selectedProvider?.baseUrl ?? '—'}</span>
            <span data-testid="video-gen-apikey-status">
              {selectedProvider?.apiKeyRef
                ? copy.apiKeyStoredKeychain
                : selectedProvider?.apiKeyEnv
                  ? copy.apiKeyStoredEnv(selectedProvider.apiKeyEnv)
                  : copy.apiKeyUnset}
            </span>
          </div>
        </div>

        <div className="image-gen-form-row" style={{ marginTop: 12 }}>
          <Field label={`* ${copy.apiStyle}`} description={copy.apiStyleHint}>
            <select
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-api-style"
              value={apiStyle}
              onChange={(event) => onApiStyleChange(event.target.value as VideoGenerationApiStyle)}
            >
              {VIDEO_API_STYLE_OPTIONS.map((style) => (
                <option key={style} value={style}>
                  {videoApiStyleLabel(style, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`* ${copy.modelId}`}>
            <input
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-model-id"
              value={modelId}
              onChange={(event) => onModelIdChange(event.target.value)}
              placeholder="sora-2 / veo-3.1 / gen4.5"
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="image-gen-form-row" style={{ marginTop: 12 }}>
          <Field label={copy.requestPath} description={copy.requestPathHint}>
            <input
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-add-model-path"
              value={modelPath}
              onChange={(event) => onModelPathChange(event.target.value)}
              placeholder="/videos"
              spellCheck={false}
            />
          </Field>
          <Field label={`${copy.timeout} (${copy.timeoutUnitSeconds})`}>
            <input
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-add-model-timeout"
              value={timeoutSeconds}
              onChange={(event) => onTimeoutChange(event.target.value)}
              placeholder="900"
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="image-gen-form-row" style={{ marginTop: 12 }}>
          <Field label={`${copy.pollInterval} (${copy.pollIntervalUnitSeconds})`}>
            <input
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-add-poll-interval"
              value={pollIntervalSeconds}
              onChange={(event) => onPollIntervalChange(event.target.value)}
              placeholder="5"
              inputMode="numeric"
            />
          </Field>
          <Field label={copy.modelLabel}>
            <input
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-add-model-label"
              value={modelLabel}
              onChange={(event) => onModelLabelChange(event.target.value)}
              placeholder="Sora 2"
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="image-gen-form-row image-gen-form-row--full" style={{ marginTop: 12 }}>
          <Field label={copy.modelDescription}>
            <input
              className="mcp-raw-editor"
              style={{ height: 'auto', padding: '8px 12px' }}
              data-testid="video-add-model-description"
              value={modelDescription}
              onChange={(event) => onModelDescriptionChange(event.target.value)}
              placeholder={
                locale === 'zh-CN'
                  ? '例如：支持文生视频和图生视频'
                  : 'For example: supports text-to-video and image-to-video'
              }
            />
          </Field>
        </div>

        <p className="muted" data-testid="video-gen-adapter-hint" style={{ marginTop: 12 }}>
          {locale === 'zh-CN'
            ? '视频生成通常是异步任务：创建后轮询或接收回调，完成后下载到本地媒体目录。'
            : 'Video generation is usually asynchronous: create a job, poll or receive a callback, then download it into local media storage.'}
        </p>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {editingKey ? (
            <Button size="compact" variant="ghost" onClick={onCancel}>
              {locale === 'zh-CN' ? '取消编辑' : 'Cancel'}
            </Button>
          ) : null}
          <Button
            size="compact"
            data-testid="video-add-model-submit"
            disabled={!modelId.trim() || !selectedProvider}
            onClick={onSubmit}
          >
            {editingKey ? (locale === 'zh-CN' ? '保存模型修改' : 'Update Model') : copy.addModel}
          </Button>
        </div>
      </div>
    </div>
  );
}
