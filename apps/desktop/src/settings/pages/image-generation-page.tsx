/**
 * Settings → Image Generation page. Binds ImageGenerationSettings to the
 * settings context; mirrors the Models page wrapper pattern.
 */
import type { ReactElement } from 'react';
import { ImageGenerationSettings } from '../../ImageGenerationSettings';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

export function ImageGenerationPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const settings = useSettings();

  if (!settings.config) {
    return (
      <p className="muted" data-testid="settings-image-generation-loading">
        {locale === 'zh-CN' ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  return (
    <div className="settings-models-page" data-testid="settings-image-generation">
      <div
        className="settings-card settings-card-flush"
        data-testid="settings-image-generation-card"
      >
        <ImageGenerationSettings />
      </div>
    </div>
  );
}
