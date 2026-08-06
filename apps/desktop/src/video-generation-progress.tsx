import type { ReactElement } from 'react';
import { IconSpark } from './shell-icons';

export function VideoGenerationProgress(props: { locale?: 'zh-CN' | 'en' }): ReactElement {
  const isChinese = props.locale !== 'en';

  return (
    <div
      className="image-generation-progress video-generation-progress"
      data-testid="video-generation-progress"
      role="status"
      aria-live="polite"
    >
      <div
        className="image-generation-progress-art video-generation-progress-art"
        aria-hidden="true"
      >
        <IconSpark className="image-generation-progress-spark" />
      </div>
      <div className="image-generation-progress-copy">
        <strong>
          {isChinese ? '正在生成视频' : 'Generating video'}
          <span className="image-generation-progress-dots" aria-hidden="true">
            …
          </span>
        </strong>
        <span>
          {isChinese
            ? '视频任务完成后会显示播放器'
            : 'The video player will appear when the task is ready'}
        </span>
      </div>
    </div>
  );
}
