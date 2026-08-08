import type { ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { IconCheck, IconClose, IconSpark } from './shell-icons';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export function VideoGenerationProgress(props: {
  locale?: 'zh-CN' | 'en';
  status?: ToolCardUi['status'];
}): ReactElement {
  const isChinese = props.locale !== 'en';
  const status = props.status ?? 'running';
  const isRunning = status === 'running';
  const isCompleted = status === 'done';
  const title = isRunning
    ? isChinese
      ? '正在生成视频'
      : 'Generating video'
    : isCompleted
      ? isChinese
        ? '视频生成完成'
        : 'Video generated'
      : isChinese
        ? '视频生成失败'
        : 'Video generation failed';
  const detail = isRunning
    ? isChinese
      ? '视频任务完成后会显示播放器'
      : 'The video player will appear when the task is ready'
    : isCompleted
      ? isChinese
        ? '生成结果已返回'
        : 'The generated result is ready'
      : isChinese
        ? '生成接口返回错误，可以重试'
        : 'The generation request failed; try again';

  return (
    <div
      className={`image-generation-progress video-generation-progress status-${status}`}
      data-testid="video-generation-progress"
      data-activity-id="video"
      data-activity-animation={getBehaviorActivitySpec('video').animation}
      data-tool-status={status}
      role="status"
      aria-live="polite"
    >
      <div
        className="image-generation-progress-art video-generation-progress-art"
        aria-hidden="true"
      >
        {isRunning ? (
          <IconSpark className="image-generation-progress-spark" />
        ) : (
          <span className="image-generation-progress-status-icon">
            {isCompleted ? <IconCheck /> : <IconClose />}
          </span>
        )}
      </div>
      <div className="image-generation-progress-copy">
        <strong>
          {title}
          {isRunning ? (
            <span className="image-generation-progress-dots" aria-hidden="true">
              …
            </span>
          ) : null}
        </strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
