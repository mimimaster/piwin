import type { ChangeEvent, ReactElement } from 'react';
import type { ImageGenerationApiStyle, VideoGenerationApiStyle } from '@piwin/contracts';
import {
  IMAGE_API_STYLE_OPTIONS,
  imageApiStyleLabel,
  withImageApiStyle,
  withVideoApiStyle,
  type GenerationRouteDraftFields,
} from './generation-route-defaults.js';
import { VIDEO_API_STYLE_OPTIONS, videoApiStyleLabel } from './video-generation-model-config.js';

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
          <div className="model-edit-route-fields-title">
            {isChinese ? '生图请求' : 'Image request'}
          </div>
          <p className="model-edit-route-fields-hint">
            {isChinese
              ? '通道协议不等于生图协议。同一 CPA 可以同时托管 OpenAI 图、Imagen 或 Gemini 原生图。'
              : 'Channel protocol is not the image wire format. One gateway can host OpenAI, Imagen, or Gemini-native image models.'}
          </p>
          <div className="model-edit-inline-row">
            <label className="model-edit-inline-field">
              <span className="model-edit-inline-label">
                {isChinese ? '接口协议' : 'API style'}
              </span>
              <select
                value={draft.imageApiStyle}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange((current) =>
                    withImageApiStyle(current, event.target.value as ImageGenerationApiStyle),
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
            <label className="model-edit-inline-field">
              <span className="model-edit-inline-label">
                {isChinese ? '超时（秒）' : 'Timeout (s)'}
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
          </div>
          <label className="model-edit-inline-field">
            <span className="model-edit-inline-label">
              {isChinese ? '请求路径' : 'Request path'}
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
      ) : null}
      {draft.supportsVideoGeneration ? (
        <div className="model-edit-route-fields" data-testid="model-edit-video-route">
          <div className="model-edit-route-fields-title">
            {isChinese ? '视频请求' : 'Video request'}
          </div>
          <p className="model-edit-route-fields-hint">
            {isChinese
              ? '视频协议写在这个模型上，不跟通道走。xGrok、Sora、Veo 可以挂在同一个 OpenAI/Anthropic CPA 下。'
              : 'Video protocol lives on this model, not the channel. xGrok, Sora, and Veo can share one OpenAI/Anthropic gateway.'}
          </p>
          <div className="model-edit-inline-row">
            <label className="model-edit-inline-field">
              <span className="model-edit-inline-label">
                {isChinese ? '接口协议' : 'API style'}
              </span>
              <select
                value={draft.videoApiStyle}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange((current) =>
                    withVideoApiStyle(current, event.target.value as VideoGenerationApiStyle),
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
            <label className="model-edit-inline-field">
              <span className="model-edit-inline-label">
                {isChinese ? '超时（秒）' : 'Timeout (s)'}
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
          </div>
          <div className="model-edit-inline-row">
            <label className="model-edit-inline-field">
              <span className="model-edit-inline-label">
                {isChinese ? '请求路径' : 'Request path'}
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
            <label className="model-edit-inline-field">
              <span className="model-edit-inline-label">
                {isChinese ? '轮询间隔（秒）' : 'Poll interval (s)'}
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
