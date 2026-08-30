/**
 * Settings → Video Generation.
 *
 * Lists already-tagged video models. Writes `videoGeneration.defaultModel`
 * and that model's `routes['video-generation']`. Does not add or retag rows.
 */

import { useMemo, type ReactElement } from 'react';
import { isModelEnabled, isProviderEnabled } from '@piwin/contracts';
import type { ModelProviderConfig, ModelRouteConfig } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { patchProviderModelRoute } from './generation-route-defaults.js';
import { PageTitle } from './settings/page-title';
import { useSettings } from './settings/settings-context';
import { VideoGenerationModelList } from './VideoGenerationModelList';
import { collectVideoModels } from './video-generation-model-config';

export function VideoGenerationSettings(): ReactElement {
  const { config, saveConfig } = useSettings();
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.videoGeneration;
  const common = translator.common;
  const videoRows = useMemo(() => (config ? collectVideoModels(config.providers) : []), [config]);

  function handleSetDefault(provider: ModelProviderConfig, modelId: string): void {
    if (!config || !isProviderEnabled(provider)) {
      return;
    }
    const model = provider.models.find((entry) => entry.id === modelId);
    if (!model || !isModelEnabled(model)) {
      return;
    }
    void saveConfig({
      ...config,
      videoGeneration: {
        ...config.videoGeneration,
        defaultModel: {
          protocol: provider.protocol,
          providerId: provider.id,
          modelId,
        },
      },
    });
  }

  function handleSaveRoute(
    provider: ModelProviderConfig,
    modelId: string,
    route: ModelRouteConfig,
  ): void {
    if (!config) {
      return;
    }
    void saveConfig({
      ...config,
      providers: patchProviderModelRoute(
        config.providers,
        provider.id,
        modelId,
        'video-generation',
        route,
      ),
    });
  }

  if (!config) {
    return (
      <p className="muted" data-testid="video-gen-loading">
        {common.loading}
      </p>
    );
  }

  return (
    <div className="video-generation-settings" data-testid="video-generation-settings">
      <div className="settings-section settings-section-card">
        <PageTitle title={copy.pageTitle} description={copy.pageDescription} />
      </div>
      <VideoGenerationModelList
        locale={locale}
        copy={copy}
        config={config}
        rows={videoRows}
        onSetDefault={handleSetDefault}
        onSaveRoute={handleSaveRoute}
      />
    </div>
  );
}
