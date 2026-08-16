/**
 * Settings → Video Generation.
 *
 * Video providers share a product-level model/capability registry, but their
 * wire formats are not interchangeable. This page stores the selected native
 * API style beside the model route so the Host can choose the right async
 * Host adapter when the video tool runs.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  DiscoveredModel,
  ModelConfigEntry,
  ModelProviderConfig,
  PiwinConfig,
  VideoGenerationApiStyle,
} from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import { useSettings } from './settings/settings-context';
import { VideoGenerationModelForm } from './VideoGenerationModelForm';
import { VideoGenerationModelList } from './VideoGenerationModelList';
import { applyVideoDiscoverySuggestion } from './video-model-discovery.js';
import {
  buildVideoModelEntry,
  collectVideoModels,
  defaultVideoGenerationApiStyle,
  isVideoApiStyle,
  defaultVideoGenerationPath,
  mergeVideoModel,
} from './video-generation-model-config';

export function VideoGenerationSettings(): ReactElement {
  const { config, saveConfig, discoverProviderModels, setError } = useSettings();
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.videoGeneration;
  const common = translator.common;

  const allProviders = useMemo(() => config?.providers ?? [], [config]);
  const videoRows = useMemo(() => (config ? collectVideoModels(config.providers) : []), [config]);

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addModelId, setAddModelId] = useState('');
  const [addApiStyle, setAddApiStyle] = useState<VideoGenerationApiStyle>('custom');
  const [addModelPath, setAddModelPath] = useState(defaultVideoGenerationPath('custom'));
  const [addModelTimeout, setAddModelTimeout] = useState('900');
  const [addPollInterval, setAddPollInterval] = useState('5');
  const [addModelLabel, setAddModelLabel] = useState('');
  const [addModelDescription, setAddModelDescription] = useState('');

  useEffect(() => {
    if (selectedProviderId && allProviders.some((provider) => provider.id === selectedProviderId)) {
      return;
    }
    const videoDefaultProvider = config?.videoGeneration?.defaultModel?.providerId;
    if (videoDefaultProvider && allProviders.some((p) => p.id === videoDefaultProvider)) {
      setSelectedProviderId(videoDefaultProvider);
      return;
    }
    const providerWithVideo = allProviders.find((p) =>
      p.models.some((m) => m.capabilities?.includes('video-generation') || m.routes?.['video-generation']),
    );
    if (providerWithVideo) {
      setSelectedProviderId(providerWithVideo.id);
      return;
    }
    setSelectedProviderId(allProviders[0]?.id ?? '');
  }, [allProviders, config?.videoGeneration?.defaultModel?.providerId, selectedProviderId]);

  const effectiveProviderId = useMemo(() => {
    const editingProviderId = editingKey?.split(':')[0];
    if (editingProviderId && allProviders.some((provider) => provider.id === editingProviderId)) {
      return editingProviderId;
    }
    return selectedProviderId;
  }, [allProviders, editingKey, selectedProviderId]);

  const selectedProvider = useMemo(
    () => allProviders.find((provider) => provider.id === effectiveProviderId) ?? null,
    [allProviders, effectiveProviderId],
  );

  const resetAddForm = useCallback(() => {
    setEditingKey(null);
    setAddModelId('');
    const apiStyle = selectedProvider
      ? defaultVideoGenerationApiStyle(selectedProvider.protocol)
      : 'custom';
    setAddApiStyle(apiStyle);
    setAddModelPath(defaultVideoGenerationPath(apiStyle));
    setAddModelTimeout('900');
    setAddPollInterval('5');
    setAddModelLabel('');
    setAddModelDescription('');
  }, [selectedProvider]);

  function handleProviderChange(providerId: string): void {
    setSelectedProviderId(providerId);
    if (editingKey) {
      return;
    }
    const provider = allProviders.find((candidate) => candidate.id === providerId);
    if (provider) {
      const apiStyle = defaultVideoGenerationApiStyle(provider.protocol);
      setAddApiStyle(apiStyle);
      setAddModelPath(defaultVideoGenerationPath(apiStyle));
    }
  }

  function handleApiStyleChange(apiStyle: VideoGenerationApiStyle): void {
    setAddApiStyle(apiStyle);
    setAddModelPath(defaultVideoGenerationPath(apiStyle));
  }

  function handleDiscoveredVideoModel(model: DiscoveredModel): void {
    const next = applyVideoDiscoverySuggestion(
      model,
      {
        apiStyle: addApiStyle,
        path: addModelPath,
        label: addModelLabel,
      },
      selectedProvider ?? undefined,
    );
    setAddModelId(next.id);
    setAddApiStyle(next.apiStyle);
    setAddModelPath(next.path);
    setAddModelLabel(next.label);
  }

  function handleStartEdit(provider: ModelProviderConfig, model: ModelConfigEntry): void {
    setEditingKey(`${provider.id}:${model.id}`);
    setSelectedProviderId(provider.id);
    const route = model.routes?.['video-generation'];
    const apiStyle = isVideoApiStyle(route?.apiStyle)
      ? route.apiStyle
      : defaultVideoGenerationApiStyle(provider.protocol);
    setAddModelId(model.id);
    setAddApiStyle(apiStyle);
    setAddModelPath(route?.path ?? defaultVideoGenerationPath(apiStyle));
    setAddModelTimeout(route?.timeoutMs !== undefined ? String(route.timeoutMs / 1000) : '900');
    setAddPollInterval(
      route?.pollIntervalMs !== undefined ? String(route.pollIntervalMs / 1000) : '5',
    );
    setAddModelLabel(model.label ?? '');
    setAddModelDescription(model.tooltipMarkdown ?? '');
  }

  async function handleAddModel(): Promise<void> {
    if (!config || !selectedProvider) {
      return;
    }
    const id = addModelId.trim();
    if (!id) {
      return;
    }

    const existingModel = selectedProvider.models.find((model) => model.id === id);
    if (!existingModel) {
      setError?.(
        locale === 'zh-CN'
          ? `通道「${selectedProvider.name || selectedProvider.id}」中尚未配置模型「${id}」。请先在「通道与文本」中添加该模型。`
          : `Model "${id}" is not configured in channel "${selectedProvider.name || selectedProvider.id}". Please add it under Channels & chat first.`,
      );
      return;
    }

    const updatedModel = buildVideoModelEntry({
      id,
      apiStyle: addApiStyle,
      path: addModelPath,
      timeoutSeconds: addModelTimeout,
      pollIntervalSeconds: addPollInterval,
      label: addModelLabel || existingModel.label || '',
      description: addModelDescription || existingModel.tooltipMarkdown || '',
    });

    const nextProviders = config.providers.map((provider) => {
      if (provider.id !== selectedProvider.id) {
        return provider;
      }
      return {
        ...provider,
        models: provider.models.map((model) =>
          model.id === id ? mergeVideoModel(model, updatedModel) : model,
        ),
      };
    });

    resetAddForm();
    await saveConfig({ ...config, providers: nextProviders });
  }

  function handleSetDefault(provider: ModelProviderConfig, modelId: string): void {
    if (!config) {
      return;
    }
    const next: PiwinConfig = {
      ...config,
      videoGeneration: {
        ...config.videoGeneration,
        defaultModel: {
          protocol: provider.protocol,
          providerId: provider.id,
          modelId,
        },
      },
    };
    void saveConfig(next);
  }

  function handleRemoveModel(providerId: string, modelId: string): void {
    if (!config) {
      return;
    }
    const nextProviders = config.providers.map((provider) => {
      if (provider.id !== providerId) {
        return provider;
      }
      return {
        ...provider,
        models: provider.models.map((model) => {
          if (model.id !== modelId) {
            return model;
          }
          const remainingCapabilities = (model.capabilities ?? []).filter(
            (capability) => capability !== 'video-generation',
          );
          const remainingRoutes = model.routes ? { ...model.routes } : undefined;
          if (remainingRoutes) {
            delete remainingRoutes['video-generation'];
          }
          const hasRemainingRoutes =
            remainingRoutes !== undefined && Object.keys(remainingRoutes).length > 0;
          const nextModel: ModelConfigEntry = { ...model };
          if (remainingCapabilities.length > 0) {
            nextModel.capabilities = remainingCapabilities;
          } else {
            delete nextModel.capabilities;
          }
          if (hasRemainingRoutes && remainingRoutes) {
            nextModel.routes = remainingRoutes;
          } else {
            delete nextModel.routes;
          }
          return nextModel;
        }),
      };
    });
    const nextConfig: PiwinConfig = { ...config, providers: nextProviders };
    const defaultModel = config.videoGeneration?.defaultModel;
    if (
      defaultModel?.providerId === providerId &&
      defaultModel.modelId === modelId &&
      config.videoGeneration
    ) {
      const nextVideoGeneration = { ...config.videoGeneration };
      delete nextVideoGeneration.defaultModel;
      if (Object.keys(nextVideoGeneration).length > 0) {
        nextConfig.videoGeneration = nextVideoGeneration;
      } else {
        delete nextConfig.videoGeneration;
      }
    }
    void saveConfig(nextConfig);
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
        <PageTitle
          title={
            editingKey
              ? locale === 'zh-CN'
                ? '编辑视频模型'
                : 'Edit video model'
              : locale === 'zh-CN'
                ? '添加视频模型'
                : 'Add video model'
          }
        />
        {allProviders.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {locale === 'zh-CN'
              ? '请先在「通道与文本」中添加接口通道。'
              : 'Add a provider under Channels & chat first.'}
          </p>
        ) : (
          <VideoGenerationModelForm
            locale={locale}
            copy={copy}
            providers={allProviders}
            selectedProvider={selectedProvider}
            effectiveProviderId={effectiveProviderId}
            editingKey={editingKey}
            modelId={addModelId}
            apiStyle={addApiStyle}
            modelPath={addModelPath}
            timeoutSeconds={addModelTimeout}
            pollIntervalSeconds={addPollInterval}
            modelLabel={addModelLabel}
            modelDescription={addModelDescription}
            onProviderChange={handleProviderChange}
            onApiStyleChange={handleApiStyleChange}
            discoverProviderModels={discoverProviderModels}
            onDiscoveredModel={handleDiscoveredVideoModel}
            onDiscoverError={setError}
            onModelPathChange={setAddModelPath}
            onTimeoutChange={setAddModelTimeout}
            onPollIntervalChange={setAddPollInterval}
            onModelLabelChange={setAddModelLabel}
            onModelDescriptionChange={setAddModelDescription}
            onCancel={resetAddForm}
            onSubmit={() => void handleAddModel()}
          />
        )}
      </div>

      <VideoGenerationModelList
        locale={locale}
        copy={copy}
        config={config}
        rows={videoRows}
        editingKey={editingKey}
        onStartEdit={handleStartEdit}
        onSetDefault={handleSetDefault}
        onRemove={handleRemoveModel}
      />
    </div>
  );
}
