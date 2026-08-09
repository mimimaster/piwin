/**
 * Settings → Model Configuration hub.
 *
 * Three model-management tabs share one provider list (config.providers):
 *   - 文本模型: BYOK provider management (ProviderSettings)
 *   - 图像生成: image-generation model config (ImageGenerationSettings)
 *   - 视频生成: video-generation model config (VideoGenerationSettings)
 *
 * Speech is a capability default, not a fourth model-management surface. The
 * compact defaults section below the tabs keeps ASR/TTS close to model config
 * without competing with the primary model-management surface.
 *
 * Providers are the single source of truth — image/video tabs reference the
 * same channels by id.  The old standalone "Image Generation" nav section is
 * now a legacy deep link that redirects here.
 */
import { useState, type ReactElement } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@piwin/ui-kit';
import { ProviderSettings } from '../../ProviderSettings';
import { ImageGenerationSettings } from '../../ImageGenerationSettings';
import { VideoGenerationSettings } from '../../VideoGenerationSettings';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';
import { AsrModelSettings } from '../asr-model-settings.js';
import { PageTitle } from '../page-title.js';

type ModelTab = 'text' | 'image' | 'video';

export function ModelsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const {
    config,
    saving,
    saveConfig,
    setError,
    setInfo,
    discoverProviderModels,
    testProviderModel,
    searchModelCatalog,
    storeProviderSecret,
    loadProviderSecret,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<ModelTab>('text');

  if (!config) {
    return (
      <p className="muted" data-testid="settings-models-loading">
        {isChinese ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  return (
    <div className="settings-models-page" data-testid="settings-models">
      <section className="model-management" data-testid="settings-model-management">
        <PageTitle
          title={isChinese ? '模型管理' : 'Model management'}
          description={
            isChinese
              ? '统一管理服务商、模型和不同生成能力。语音能力只在下方设置默认值。'
              : 'Manage providers, models, and generation capabilities in one place. Speech defaults live below.'
          }
        />
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ModelTab)}
          testId="model-config-tabs"
        >
          <TabsList
            className="segmented-control model-management-tabs"
            label={isChinese ? '模型管理类型' : 'Model management type'}
          >
            <TabsTrigger
              value="text"
              className="segmented-control-item"
              testId="model-config-tab-text"
            >
              {isChinese ? '文本模型' : 'Text models'}
            </TabsTrigger>
            <TabsTrigger
              value="image"
              className="segmented-control-item"
              testId="model-config-tab-image"
            >
              {isChinese ? '图像生成' : 'Image generation'}
            </TabsTrigger>
            <TabsTrigger
              value="video"
              className="segmented-control-item"
              testId="model-config-tab-video"
            >
              {isChinese ? '视频生成' : 'Video generation'}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="text"
            className="model-management-tab-content"
            testId="model-config-panel-text"
          >
            <div className="settings-card settings-card-flush" data-testid="settings-provider-card">
              <ProviderSettings
                config={config}
                saving={saving}
                onSave={saveConfig}
                onError={setError}
                onInfo={setInfo}
                onDiscoverModels={discoverProviderModels}
                onTestModel={testProviderModel}
                onStoreSecret={storeProviderSecret}
                onLoadSecret={loadProviderSecret}
                searchCatalog={async (query) => {
                  const result = await searchModelCatalog({ query, limit: 12 });
                  return result.entries;
                }}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="image"
            className="model-management-tab-content"
            testId="model-config-panel-image"
          >
            <ImageGenerationSettings />
          </TabsContent>

          <TabsContent
            value="video"
            className="model-management-tab-content"
            testId="model-config-panel-video"
          >
            <VideoGenerationSettings />
          </TabsContent>
        </Tabs>
      </section>
      <AsrModelSettings
        config={config}
        saving={saving}
        onSave={saveConfig}
        onError={setError}
        onInfo={setInfo}
      />
    </div>
  );
}
