/**
 * Settings → Vision page.
 * Hosts Vision Delegation configuration, extracted from the Models page.
 */
import type { ReactElement } from 'react';
import { VisionDelegationSettings } from '../../VisionDelegationSettings';
import { PageTitle } from '../page-title';
import { useDesktopLocale } from '../../desktop-locale-context';

export function VisionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';

  return (
    <div data-testid="settings-vision-page">
      <PageTitle
        title={isChinese ? '视觉' : 'Vision'}
        description={
          isChinese
            ? '配置视觉委派：当主模型仅支持文本时，用视觉模型描述图片。'
            : 'Configure vision delegation: describe images with a vision model when the primary model is text-only.'
        }
      />
      <div className="settings-section-card" style={{ marginTop: 20 }}>
        <VisionDelegationSettings />
      </div>
    </div>
  );
}
