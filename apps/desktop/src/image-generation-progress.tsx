import type { ReactElement } from 'react';
import { IconSpark } from './shell-icons';

export function ImageGenerationProgress(props: { locale?: 'zh-CN' | 'en' }): ReactElement {
  const isChinese = props.locale !== 'en';

  return (
    <div
      className="image-generation-progress"
      data-testid="image-generation-progress"
      role="status"
      aria-live="polite"
    >
      <div className="image-generation-progress-art" aria-hidden="true">
        <IconSpark className="image-generation-progress-spark" />
      </div>
      <div className="image-generation-progress-copy">
        <strong>
          {isChinese ? '正在生成图片' : 'Generating image'}
          <span className="image-generation-progress-dots" aria-hidden="true">
            …
          </span>
        </strong>
        <span>
          {isChinese ? '接口返回后会显示最终图片' : 'The final image will appear when ready'}
        </span>
      </div>
    </div>
  );
}
