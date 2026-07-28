import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Modal, TextInput } from '@piwin/ui-kit';
import type { DiscoveredModel, ModelProviderConfig } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';

export type DiscoverModelsDialogProps = {
  open: boolean;
  provider: ModelProviderConfig | null;
  /** Preloaded list — dialog is pick-only, never fetches. */
  models: readonly DiscoveredModel[];
  onOpenChange: (open: boolean) => void;
  onImport: (models: DiscoveredModel[]) => void;
};

/**
 * Success-path model picker only.
 * Fetch + errors belong on the provider form (inline), not in a modal that says "close me".
 */
export function DiscoverModelsDialog({
  open,
  provider,
  models,
  onOpenChange,
  onImport,
}: DiscoverModelsDialogProps): ReactElement | null {
  const { translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const configuredIds = useMemo(
    () => new Set(provider?.models.map((model) => model.id) ?? []),
    [provider],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setSelectedIds(new Set());
  }, [open, models, configuredIds]);

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return models;
    }
    return models.filter((model) =>
      `${model.id} ${model.label ?? ''}`.toLowerCase().includes(normalizedQuery),
    );
  }, [models, query]);

  const selectedModels = models.filter((model) => selectedIds.has(model.id));
  const newModelCount = selectedModels.filter((model) => !configuredIds.has(model.id)).length;

  function toggleModel(modelId: string): void {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(modelId)) {
        nextIds.delete(modelId);
      } else {
        nextIds.add(modelId);
      }
      return nextIds;
    });
  }

  if (!provider) {
    return null;
  }

  return (
    <Modal
      title={copy.discoveryTitleFor(provider.name)}
      open={open}
      onOpenChange={onOpenChange}
      testId="discover-models-dialog"
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={copy.searchDiscovered}
          data-testid="discover-models-search"
          autoFocus
        />
        <div className="cherry-model-pick-list" data-testid="discover-models-list">
          {visibleModels.map((model) => {
            const alreadyConfigured = configuredIds.has(model.id);
            return (
              <label key={model.id} className="cherry-model-pick-row">
                <input
                  type="checkbox"
                  checked={selectedIds.has(model.id)}
                  onChange={() => toggleModel(model.id)}
                />
                <span className="cherry-model-pick-copy">
                  <strong>{model.label ?? model.id}</strong>
                  {model.label ? <code>{model.id}</code> : null}
                </span>
                {alreadyConfigured ? <small>{copy.configured}</small> : null}
              </label>
            );
          })}
          {visibleModels.length === 0 ? <p className="muted">{copy.noMatchingModels}</p> : null}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
        <span className="muted">{copy.selectedModels(selectedModels.length, newModelCount)}</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button onClick={() => onOpenChange(false)}>
            {common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={selectedModels.length === 0}
            onClick={() => {
              onImport(selectedModels);
              onOpenChange(false);
            }}
            data-testid="discover-models-import"
          >
            {copy.importSelected}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
