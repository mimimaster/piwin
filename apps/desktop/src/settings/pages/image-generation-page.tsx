/**
 * Settings → Image Generation page. Binds ImageGenerationSettings to the
 * settings context; mirrors the Models page wrapper pattern.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@piwin/ui-kit';
import { ImageGenerationSettings } from '../../ImageGenerationSettings';
import { VideoGenerationSettings } from '../../VideoGenerationSettings';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

export function ImageGenerationPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const settings = useSettings();
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');

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
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'image' | 'video')}
          testId="media-generation-tabs"
        >
          <TabsList
            className="segmented-control"
            label={locale === 'zh-CN' ? '媒体生成类型' : 'Media generation type'}
          >
            <TabsTrigger
              value="image"
              className="segmented-control-item"
              testId="media-generation-tab-image"
            >
              {locale === 'zh-CN' ? '图像生成' : 'Image generation'}
            </TabsTrigger>
            <TabsTrigger
              value="video"
              className="segmented-control-item"
              testId="media-generation-tab-video"
            >
              {locale === 'zh-CN' ? '视频生成' : 'Video generation'}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="image"
            className="mcp-tab-content"
            testId="media-generation-panel-image"
          >
            <ImageGenerationSettings />
          </TabsContent>
          <TabsContent
            value="video"
            className="mcp-tab-content"
            testId="media-generation-panel-video"
          >
            <VideoGenerationSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
