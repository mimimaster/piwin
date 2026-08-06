import { Button } from '@piwin/ui-kit';
import type { ModelConfigEntry, ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import type { DesktopLocale, DesktopTranslator } from './desktop-locale';
import { ProviderIcon } from './provider-icons';
import { PageTitle } from './settings/page-title';
import {
  defaultVideoGenerationApiStyle,
  type VideoModelRow,
  videoApiStyleLabel,
} from './video-generation-model-config';

type VideoGenerationCopy = DesktopTranslator['settings']['videoGeneration'];

export type VideoGenerationModelListProps = {
  locale: DesktopLocale;
  copy: VideoGenerationCopy;
  config: PiwinConfig;
  rows: readonly VideoModelRow[];
  editingKey: string | null;
  onStartEdit: (provider: ModelProviderConfig, model: ModelConfigEntry) => void;
  onSetDefault: (provider: ModelProviderConfig, modelId: string) => void;
  onRemove: (providerId: string, modelId: string) => void;
};

export function VideoGenerationModelList(props: VideoGenerationModelListProps) {
  const { locale, copy, config, rows, editingKey, onStartEdit, onSetDefault, onRemove } = props;

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
            const route = model.routes?.['video-generation'];
            const isDefault =
              config.videoGeneration?.defaultModel?.modelId === model.id &&
              config.videoGeneration?.defaultModel?.providerId === provider.id;
            const isEditing = editingKey === `${provider.id}:${model.id}`;
            const apiStyle = route?.apiStyle ?? defaultVideoGenerationApiStyle(provider.protocol);
            return (
              <li
                key={`${provider.id}:${model.id}`}
                className={`image-gen-model-item ${isEditing ? 'is-editing' : ''}`}
                data-testid="video-model-row"
              >
                <ProviderIcon id={provider.id} size={28} />
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
                        {locale === 'zh-CN' ? '默认' : 'Default'}
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
                </div>
                <div className="image-gen-model-item-actions">
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => onStartEdit(provider, model)}
                  >
                    {locale === 'zh-CN' ? '编辑' : 'Edit'}
                  </Button>
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
                  <Button
                    size="compact"
                    variant="ghost"
                    data-testid="video-model-remove"
                    onClick={() => onRemove(provider.id, model.id)}
                    style={{ color: 'var(--danger)' }}
                  >
                    {copy.removeModel}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
