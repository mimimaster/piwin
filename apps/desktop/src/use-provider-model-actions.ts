/**
 * Immediate model edits for the provider workspace: update / test / default /
 * toggle / discover. Each one saves the config right away, re-resolving the
 * product default so a removed or disabled model never stays the default.
 */

import { useState } from 'react';
import { formatError, isProviderEnabled } from '@piwin/contracts';
import type {
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelDiscoveryResult,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import type { ProviderDetailModels } from './provider-detail.js';
import { withProviders } from './provider-draft.js';
import type { ModelTestState } from './provider-model-list.js';

export type ProviderModelActionsInput = {
  config: PiwinConfig;
  isChinese: boolean;
  onSave: (next: PiwinConfig) => Promise<boolean>;
  onError: (message: string) => void;
  onTestModel: (provider: ModelProviderConfig, modelId: string) => Promise<{ durationMs: number }>;
  onDiscoverModels: (provider: ModelProviderConfig) => Promise<ModelDiscoveryResult>;
  searchCatalog?: ((query: string) => Promise<ModelCatalogEntry[]>) | undefined;
};

function statusKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function useProviderModelActions(
  input: ProviderModelActionsInput,
): (provider: ModelProviderConfig) => ProviderDetailModels {
  const { config, isChinese, onSave, onError, onTestModel, onDiscoverModels, searchCatalog } =
    input;
  const [testStatus, setTestStatus] = useState<Record<string, ModelTestState>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);

  async function updateModels(providerId: string, models: ModelConfigEntry[]): Promise<void> {
    await onSave(
      withProviders(
        config,
        config.providers.map((provider) =>
          provider.id === providerId ? { ...provider, models } : provider,
        ),
      ),
    );
  }

  async function testModel(providerId: string, modelId: string): Promise<void> {
    const key = statusKey(providerId, modelId);
    setTestingKey(key);
    setTestStatus((previous) => ({
      ...previous,
      [key]: { tone: 'busy', message: isChinese ? '检测中…' : 'Testing…' },
    }));
    try {
      const provider = config.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error('provider not found');
      const result = await onTestModel(provider, modelId);
      const seconds = (result.durationMs / 1000).toFixed(1);
      setTestStatus((previous) => ({
        ...previous,
        [key]: { tone: 'ok', message: isChinese ? `可用 · ${seconds}s` : `OK · ${seconds}s` },
      }));
    } catch (error) {
      const message = formatError(error);
      setTestStatus((previous) => ({
        ...previous,
        [key]: { tone: 'error', message: isChinese ? '失败' : 'Failed', errorMessage: message },
      }));
      onError(
        isChinese
          ? `模型「${modelId}」测试失败：${message}`
          : `Model "${modelId}" test failed: ${message}`,
      );
    } finally {
      setTestingKey(null);
    }
  }

  async function setDefaultModel(providerId: string, modelId: string): Promise<void> {
    const provider = config.providers.find((entry) => entry.id === providerId);
    if (!provider || !isProviderEnabled(provider)) return;
    await onSave({ ...config, defaultProviderId: providerId, defaultModelId: modelId });
  }

  async function toggleModel(providerId: string, modelId: string): Promise<void> {
    const target = config.providers.find((entry) => entry.id === providerId);
    if (!target || !isProviderEnabled(target)) return;
    await updateModels(
      providerId,
      target.models.map((model) =>
        model.id === modelId ? { ...model, enabled: model.enabled === false } : model,
      ),
    );
  }

  async function discoverModels(provider: ModelProviderConfig): Promise<ModelDiscoveryResult> {
    try {
      return await onDiscoverModels(provider);
    } catch (error) {
      const message = formatError(error);
      onError(isChinese ? `模型发现失败：${message}` : `Model discovery failed: ${message}`);
      throw error;
    }
  }

  return (provider) => {
    const perModel: Record<string, ModelTestState> = {};
    for (const model of provider.models) {
      const state = testStatus[statusKey(provider.id, model.id)];
      if (state) perModel[model.id] = state;
    }
    const prefix = `${provider.id}::`;
    return {
      defaultModelId:
        provider.id === config.defaultProviderId ? (config.defaultModelId ?? null) : null,
      modelTestStatus: perModel,
      testingModelId: testingKey?.startsWith(prefix) ? testingKey.slice(prefix.length) : null,
      ...(searchCatalog ? { searchCatalog } : {}),
      onUpdateModels: (models) => void updateModels(provider.id, models),
      onTestModel: (modelId) => void testModel(provider.id, modelId),
      onSetDefaultModel: (modelId) => void setDefaultModel(provider.id, modelId),
      onToggleModel: (modelId) => void toggleModel(provider.id, modelId),
      onDiscoverModels: discoverModels,
    };
  };
}
