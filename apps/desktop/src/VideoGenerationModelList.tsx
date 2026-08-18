import { useState } from 'react';
import { Button } from '@piwin/ui-kit';
import type { ModelRouteConfig, ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import type { DesktopLocale, DesktopTranslator } from './desktop-locale';
import { buildVideoGenerationRoute } from './generation-route-defaults.js';
import { createModelConfigurationDraft, type ModelConfigurationDraft } from './model-configuration.js';
import { ModelGenerationRouteFields } from './model-generation-route-fields.js';
import { ProviderIcon } from './provider-icons';
import { PageTitle } from './settings/page-title';
import {
  defaultVideoGenerationApiStyle,
  isVideoApiStyle,
  type VideoModelRow,
  videoApiStyleLabel,
} from './video-generation-model-config';

type VideoGenerationCopy = DesktopTranslator['settings']['videoGeneration'];

export type VideoGenerationModelListProps = {
  locale: DesktopLocale;
  copy: VideoGenerationCopy;
  config: PiwinConfig;
  rows: readonly VideoModelRow[];
  onSetDefault: (provider: ModelProviderConfig, modelId: string) => void;
  onSaveRoute: (provider: ModelProviderConfig, modelId: string, route: ModelRouteConfig) => void;
};

export function VideoGenerationModelList(props: VideoGenerationModelListProps) {
  const { locale, copy, config, rows, onSetDefault, onSaveRoute } = props;
  const isChinese = locale === 'zh-CN';
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelConfigurationDraft | null>(null);

  function rowKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  function startEdit(provider: ModelProviderConfig, model: VideoModelRow['model']): void {
    setEditingKey(rowKey(provider.id, model.id));
    setDraft({
      ...createModelConfigurationDraft(model, undefined, provider.protocol),
      supportsImageGeneration: false,
      supportsVideoGeneration: true,
    });
  }

  function cancelEdit(): void {
    setEditingKey(null);
    setDraft(null);
  }

  function saveEdit(provider: ModelProviderConfig, modelId: string): void {
    if (!draft) return;
    const route = buildVideoGenerationRoute(draft);
    if (!route) return;
    onSaveRoute(provider, modelId, route);
    cancelEdit();
  }

  return (
    <div className="settings-section settings-section-card" style={{ marginTop: 16 }}>
      <PageTitle title={copy.modelsHeading} />
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }} data-testid="video-gen-empty">
          {copy.noModels}
        </p>
      ) : (
        <ul className="image-gen-model-list" style={{ marginTop: 12 }}>
          {rows.map(({ provider, model }) => {
            const key = rowKey(provider.id, model.id);
            const route = model.routes?.['video-generation'];
            const isDefault =
              config.videoGeneration?.defaultModel?.modelId === model.id &&
              config.videoGeneration?.defaultModel?.providerId === provider.id;
            const apiStyle = isVideoApiStyle(route?.apiStyle)
              ? route.apiStyle
              : defaultVideoGenerationApiStyle(provider.protocol);
            const isEditing = editingKey === key;
            return (
              <li
                key={key}
                className="image-gen-model-item"
                data-testid="video-model-row"
              >
                <ProviderIcon id={provider.id} name={provider.name} size={28} />
                <div className="image-gen-model-item-body">
                  <div className="image-gen-model-item-title">
                    <span className="image-gen-model-item-id">{model.id}</span>
                    {model.label ? (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {model.label}
                      </span>
                    ) : null}
                    {isDefault ? (
                      <span className="image-gen-default-badge">
                        {isChinese ? '默认' : 'Default'}
                      </span>
                    ) : null}
                  </div>
                  <div className="image-gen-model-item-meta">
                    <strong style={{ color: 'var(--text)' }}>{provider.name}</strong>
                    {' · '}
                    {videoApiStyleLabel(apiStyle, locale)}
                    {' · '}
                    {route?.path ?? '—'}
                    {route?.pollIntervalMs !== undefined
                      ? ` · ${route.pollIntervalMs / 1000}${copy.pollIntervalUnitSeconds}`
                      : ''}
                  </div>
                  {isEditing && draft ? (
                    <div className="image-gen-route-editor" style={{ marginTop: 10 }}>
                      <ModelGenerationRouteFields
                        draft={draft}
                        isChinese={isChinese}
                        onChange={(update) => setDraft((current) => (current ? update(current) : current))}
                      />
                      <div className="image-gen-model-item-actions" style={{ marginTop: 8 }}>
                        <Button
                          size="compact"
                          variant="primary"
                          data-testid="video-model-save-route"
                          onClick={() => saveEdit(provider, model.id)}
                        >
                          {copy.saveRoute}
                        </Button>
                        <Button size="compact" variant="ghost" onClick={cancelEdit}>
                          {isChinese ? '取消' : 'Cancel'}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="image-gen-model-item-actions">
                  {!isEditing ? (
                    <Button
                      size="compact"
                      variant="ghost"
                      data-testid="video-model-edit-route"
                      onClick={() => startEdit(provider, model)}
                    >
                      {copy.editRoute}
                    </Button>
                  ) : null}
                  {!isDefault ? (
                    <Button
                      size="compact"
                      variant="ghost"
                      data-testid="video-model-set-default"
                      onClick={() => onSetDefault(provider, model.id)}
                    >
                      {copy.setDefault}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
