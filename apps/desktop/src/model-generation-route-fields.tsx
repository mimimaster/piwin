import type { ChangeEvent, ReactElement } from 'react';
import {
  isImageApiStyle,
  IMAGE_API_STYLE_OPTIONS,
  imageApiStyleLabel,
  withImageApiStyle,
  withVideoApiStyle,
  type GenerationRouteDraftFields,
} from './generation-route-defaults.js';
import {
  isVideoApiStyle,
  VIDEO_API_STYLE_OPTIONS,
  videoApiStyleLabel,
} from './video-generation-model-config.js';

export type ModelGenerationRouteFieldsProps<T extends GenerationRouteDraftFields> = {
  draft: T;
  disabled?: boolean;
  isChinese: boolean;
  onChange: (update: (current: T) => T) => void;
};

export function ModelGenerationRouteFields<T extends GenerationRouteDraftFields>(
  props: ModelGenerationRouteFieldsProps<T>,
): ReactElement | null {
  const { draft, disabled, isChinese, onChange } = props;
  if (!draft.supportsImageGeneration && !draft.supportsVideoGeneration) {
    return null;
  }
  const locale = isChinese ? 'zh-CN' : 'en';

  return (
    <div className="model-edit-route-stack">
      {draft.supportsImageGeneration ? (
        <div className="model-edit-route-fields" data-testid="model-edit-image-route">
          <div className="model-edit-route-fields-header">
            <div className="model-edit-route-fields-title">
              {isChinese ? '生图协议与端点配置' : 'Image Generation Protocol & Endpoint'}
            </div>
            {isImageApiStyle(draft.imageApiStyle) ? (
              <span className="model-edit-route-fields-pill">
                {imageApiStyleLabel(draft.imageApiStyle, locale)}
              </span>
            ) : null}
          </div>
          <p className="model-edit-route-fields-hint">
            {isChinese
              ? '独立配置该模型的图片生成协议与请求端点（支持 OpenAI DALL-E、Gemini Imagen 等标准），可与通道主协议独立。'
              : 'Configure the image generation API wire protocol and endpoint path for this model.'}
          </p>
          <div className="model-edit-route-grid">
            <label className="model-edit-field-group">
              <span className="model-edit-field-label">
                {isChinese ? '接口协议' : 'API Style'}
              </span>
              <select
                value={draft.imageApiStyle}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange((current) =>
                    withImageApiStyle(
                      current,
                      isImageApiStyle(event.target.value) ? event.target.value : 'openai',
                    ),
                  )
                }
                data-testid="model-edit-image-api-style"
              >
                {IMAGE_API_STYLE_OPTIONS.map((style) => (
                  <option key={style} value={style}>
                    {imageApiStyleLabel(style, locale)}
                  </option>
                ))}
              </select>
            </label>

            <label className="model-edit-field-group">
              <span className="model-edit-field-label">
                {isChinese ? '超时时间（秒）' : 'Timeout (seconds)'}
              </span>
              <input
                value={draft.imageTimeoutSeconds}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange((current) => ({
                    ...current,
                    imageTimeoutSeconds: event.target.value,
                  }))
                }
                placeholder="180"
                inputMode="decimal"
                spellCheck={false}
                data-testid="model-edit-image-timeout"
              />
            </label>

            <label className="model-edit-field-group model-edit-field-group--full">
              <span className="model-edit-field-label">
                {isChinese ? '请求路径' : 'Request Path'}
              </span>
              <input
                value={draft.imagePath}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange((current) => ({ ...current, imagePath: event.target.value }))
                }
                placeholder="/images/generations"
                spellCheck={false}
                data-testid="model-edit-image-path"
              />
            </label>
          </div>
        </div>
      ) : null}

      {draft.supportsVideoGeneration ? (
        <div className="model-edit-route-fields" data-testid="model-edit-video-route">
          <div className="model-edit-route-fields-header">
            <div className="model-edit-route-fields-title">
              {isChinese ? '视频生成协议与端点配置' : 'Video Generation Protocol & Endpoint'}
            </div>
            {isVideoApiStyle(draft.videoApiStyle) ? (
              <span className="model-edit-route-fields-pill">
                {videoApiStyleLabel(draft.videoApiStyle, locale)}
              </span>
            ) : null}
          </div>
          <p className="model-edit-route-fields-hint">
            {isChinese
              ? '独立配置该模型的视频生成协议、端点路径与轮询间隔（支持 Grok Videos、Sora、Veo 等异步协议）。'
              : 'Configure the video generation wire protocol, request path, and polling interval for this model.'}
          </p>
          <div className="model-edit-route-grid">
            <label className="model-edit-field-group">
              <span className="model-edit-field-label">
                {isChinese ? '接口协议' : 'API Style'}
              </span>
              <select
                value={draft.videoApiStyle}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange((current) =>
                    withVideoApiStyle(
                      current,
                      isVideoApiStyle(event.target.value) ? event.target.value : 'custom',
                    ),
                  )
                }
                data-testid="model-edit-video-api-style"
              >
                {VIDEO_API_STYLE_OPTIONS.map((style) => (
                  <option key={style} value={style}>
                    {videoApiStyleLabel(style, locale)}
                  </option>
                ))}
              </select>
            </label>

            <label className="model-edit-field-group">
              <span className="model-edit-field-label">
                {isChinese ? '超时时间（秒）' : 'Timeout (seconds)'}
              </span>
              <input
                value={draft.videoTimeoutSeconds}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange((current) => ({
                    ...current,
                    videoTimeoutSeconds: event.target.value,
                  }))
                }
                placeholder="900"
                inputMode="decimal"
                spellCheck={false}
                data-testid="model-edit-video-timeout"
              />
            </label>

            <label className="model-edit-field-group">
              <span className="model-edit-field-label">
                {isChinese ? '请求路径' : 'Request Path'}
              </span>
              <input
                value={draft.videoPath}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange((current) => ({ ...current, videoPath: event.target.value }))
                }
                placeholder="/videos/generations"
                spellCheck={false}
                data-testid="model-edit-video-path"
              />
            </label>

            <label className="model-edit-field-group">
              <span className="model-edit-field-label">
                {isChinese ? '轮询间隔（秒）' : 'Poll Interval (seconds)'}
              </span>
              <input
                value={draft.videoPollIntervalSeconds}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onChange((current) => ({
                    ...current,
                    videoPollIntervalSeconds: event.target.value,
                  }))
                }
                placeholder="5"
                inputMode="decimal"
                spellCheck={false}
                data-testid="model-edit-video-poll-interval"
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
