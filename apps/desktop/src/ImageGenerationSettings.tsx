/**
 * Settings → Image Generation.
 *
 * Lists already-tagged image models. Writes `imageGeneration.defaultModel`
 * and that model's `routes['image-generation']`. Does not add or retag rows.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { isModelEnabled, isProviderEnabled } from '@piwin/contracts';
import type { ModelConfigEntry, ModelProviderConfig, ModelRouteConfig } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context.js';
import {
  buildImageGenerationRoute,
  imageApiStyleLabel,
  isImageApiStyle,
  patchProviderModelRoute,
} from './generation-route-defaults.js';
import {
  createModelConfigurationDraft,
  type ModelConfigurationDraft,
} from './model-configuration.js';
import { ModelGenerationRouteFields } from './model-generation-route-fields.js';
import { ProviderIcon } from './provider-icons.js';
import { useSettings } from './settings/settings-context.js';
import { PageTitle } from './settings/page-title.js';

export {
  IMAGE_API_STYLE_OPTIONS,
  imageApiStyleLabel,
  isImageApiStyle,
} from './generation-route-defaults.js';

/** Image-capable when it declares the capability or has an image-generation route. */
export function isImageGenerationModel(model: ModelConfigEntry): boolean {
  if (model.capabilities?.includes('image-generation')) {
    return true;
  }
  return model.routes?.['image-generation'] !== undefined;
}

type ImageModelRow = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

export function collectImageModels(providers: readonly ModelProviderConfig[]): ImageModelRow[] {
  const rows: ImageModelRow[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      if (isImageGenerationModel(model)) {
        rows.push({ provider, model });
      }
    }
  }
  return rows;
}

export function ImageGenerationSettings(): ReactElement {
  const { config, saveConfig, testImageGenerationModel, setError, setInfo } = useSettings();
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.imageGeneration;
  const common = translator.common;
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelConfigurationDraft | null>(null);

  const imageRows = useMemo(() => (config ? collectImageModels(config.providers) : []), [config]);

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
      imageGeneration: {
        ...config.imageGeneration,
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
        'image-generation',
        route,
      ),
    });
  }

  function startEdit(provider: ModelProviderConfig, model: ModelConfigEntry): void {
    setEditingKey(`${provider.id}:${model.id}`);
    setDraft({
      ...createModelConfigurationDraft(model, undefined, provider.protocol),
      supportsImageGeneration: true,
      supportsVideoGeneration: false,
    });
  }

  function cancelEdit(): void {
    setEditingKey(null);
    setDraft(null);
  }

  function saveEdit(provider: ModelProviderConfig, modelId: string): void {
    if (!draft) return;
    const route = buildImageGenerationRoute(draft);
    if (!route) return;
    handleSaveRoute(provider, modelId, route);
    cancelEdit();
  }

  async function handleTestModel(
    provider: ModelProviderConfig,
    model: ModelConfigEntry,
  ): Promise<void> {
    if (!testImageGenerationModel) {
      setError(
        locale === 'zh-CN'
          ? '当前 Host 不支持图片模型测试，请重启并更新 Host。'
          : 'The current Host does not support image model testing. Restart or update the Host.',
      );
      return;
    }
    const key = `${provider.id}:${model.id}`;
    setTestingKey(key);
    setError(null);
    try {
      const result = await testImageGenerationModel(provider, model.id);
      const formats = result.outputs
        .map((output) => output.mimeType.replace('image/', ''))
        .join(', ');
      setInfo(
        locale === 'zh-CN'
          ? `图片模型调用成功：${result.imageCount} 张，${formats}，耗时 ${result.durationMs}ms。`
          : `Image call succeeded: ${result.imageCount} output, ${formats}, ${result.durationMs}ms.`,
        'success',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingKey(null);
    }
  }

  if (!config) {
    return (
      <p className="muted" data-testid="image-gen-loading">
        {common.loading}
      </p>
    );
  }

  return (
    <div className="image-generation-settings" data-testid="image-generation-settings">
      <div className="settings-section settings-section-card">
        <PageTitle title={copy.pageTitle} description={copy.pageDescription} />
        {imageRows.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }} data-testid="image-gen-empty">
            {copy.noModels}
          </p>
        ) : (
          <ul className="image-gen-model-list" style={{ marginTop: 12 }}>
            {imageRows.map(({ provider, model }) => {
              const key = `${provider.id}:${model.id}`;
              const route = model.routes?.['image-generation'];
              const isDefault =
                config.imageGeneration?.defaultModel?.modelId === model.id &&
                config.imageGeneration?.defaultModel?.providerId === provider.id;
              const isTesting = testingKey === key;
              const isEditing = editingKey === key;
              const live = isProviderEnabled(provider) && isModelEnabled(model);
              return (
                <li
                  key={key}
                  className={`image-gen-model-item${isEditing ? ' is-editing' : ''}${live ? '' : ' is-off'}`}
                  data-testid="image-model-row"
                >
                  <div className="image-gen-model-item-header">
                    <ProviderIcon id={provider.id} name={provider.name} size={30} />
                    <div className="image-gen-model-item-identity">
                      <div className="image-gen-model-item-title">
                        <span className="image-gen-model-item-id">{model.id}</span>
                        {model.label ? (
                          <span className="image-gen-model-item-label">{model.label}</span>
                        ) : null}
                        {isDefault ? (
                          <span className="image-gen-default-badge">
                            {locale === 'zh-CN' ? '默认' : 'Default'}
                          </span>
                        ) : null}
                        {!live ? (
                          <span className="image-gen-off-badge" data-testid="image-model-off-badge">
                            {locale === 'zh-CN' ? '已停用' : 'Disabled'}
                          </span>
                        ) : null}
                      </div>
                      <div className="image-gen-model-item-meta">
                        <strong className="image-gen-provider-name">{provider.name}</strong>
                        {!isEditing ? (
                          <>
                            <span className="image-gen-meta-sep">·</span>
                            <span className="image-gen-meta-path">{route?.path ?? '—'}</span>
                            {isImageApiStyle(route?.apiStyle) ? (
                              <>
                                <span className="image-gen-meta-sep">·</span>
                                <span className="image-gen-meta-pill">
                                  {imageApiStyleLabel(route.apiStyle, locale)}
                                </span>
                              </>
                            ) : null}
                            {route?.timeoutMs !== undefined ? (
                              <>
                                <span className="image-gen-meta-sep">·</span>
                                <span>{route.timeoutMs / 1000}{copy.timeoutUnitSeconds}</span>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>

                    {!isEditing ? (
                      <div className="image-gen-model-item-actions">
                        <Button
                          size="compact"
                          variant="ghost"
                          data-testid="image-model-edit-route"
                          onClick={() => startEdit(provider, model)}
                        >
                          {copy.editRoute}
                        </Button>
                        <Button
                          size="compact"
                          variant="ghost"
                          data-testid="image-model-test"
                          disabled={isTesting || !live}
                          onClick={() => void handleTestModel(provider, model)}
                        >
                          {isTesting
                            ? locale === 'zh-CN'
                              ? '测试中…'
                              : 'Testing…'
                            : locale === 'zh-CN'
                              ? '测试调用'
                              : 'Test call'}
                        </Button>
                        {!isDefault ? (
                          <Button
                            size="compact"
                            variant="ghost"
                            data-testid="image-model-set-default"
                            disabled={!live}
                            onClick={() => handleSetDefault(provider, model.id)}
                          >
                            {copy.setDefault}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {isEditing && draft ? (
                    <div className="image-gen-route-editor">
                      <ModelGenerationRouteFields
                        draft={draft}
                        isChinese={locale === 'zh-CN'}
                        onChange={(update) =>
                          setDraft((current) => (current ? update(current) : current))
                        }
                      />
                      <div className="image-gen-editor-footer">
                        <Button size="compact" variant="ghost" onClick={cancelEdit}>
                          {locale === 'zh-CN' ? '取消' : 'Cancel'}
                        </Button>
                        <Button
                          size="compact"
                          variant="primary"
                          data-testid="image-model-save-route"
                          onClick={() => saveEdit(provider, model.id)}
                        >
                          {copy.saveRoute}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
