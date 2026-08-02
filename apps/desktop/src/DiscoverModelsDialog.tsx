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
 * Rank + filter discovered models for the picker search box.
 * - Empty query: original order
 * - Tokens (whitespace-split) must all match id or label (case-insensitive)
 * - Prefix hits on id rank above prefix on label, then substring matches
 */
export function filterDiscoveredModels(
  models: readonly DiscoveredModel[],
  query: string,
): DiscoveredModel[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...models];
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [...models];
  }

  type Ranked = { model: DiscoveredModel; rank: number };
  const ranked: Ranked[] = [];

  for (const model of models) {
    const id = model.id.toLowerCase();
    const label = (model.label ?? '').toLowerCase();
    const haystack = `${id} ${label}`.trim();

    if (!tokens.every((token) => haystack.includes(token))) {
      continue;
    }

    // Lower rank = better. Prefer id prefix, then label prefix, then substring.
    const primary = tokens[0] ?? '';
    let rank = 40;
    if (primary && id.startsWith(primary)) {
      rank = 0;
    } else if (primary && label.startsWith(primary)) {
      rank = 10;
    } else if (primary && id.includes(primary)) {
      rank = 20;
    } else if (primary && label.includes(primary)) {
      rank = 30;
    }

    ranked.push({ model, rank });
  }

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    return left.model.id.localeCompare(right.model.id);
  });

  return ranked.map((entry) => entry.model);
}

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
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Depend on model id list content, not the provider object identity —
  // parents often pass a freshly built provider each render.
  const configuredIdsKey = (provider?.models ?? []).map((model) => model.id).join('\0');
  const configuredIds = useMemo(() => {
    if (!configuredIdsKey) return new Set<string>();
    return new Set(configuredIdsKey.split('\0').filter(Boolean));
  }, [configuredIdsKey]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setSelectedIds(new Set());
    // Reset only when the picker opens or the discovered list is replaced —
    // not on every parent re-render / configuredIds Set identity change.
  }, [open, models]);

  const visibleModels = useMemo(() => filterDiscoveredModels(models, query), [models, query]);

  const selectedModels = models.filter((model) => selectedIds.has(model.id));
  const newModelCount = selectedModels.filter((model) => !configuredIds.has(model.id)).length;

  const allVisibleSelected =
    visibleModels.length > 0 && visibleModels.every((model) => selectedIds.has(model.id));

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

  function toggleSelectVisible(): void {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (allVisibleSelected) {
        for (const model of visibleModels) {
          nextIds.delete(model.id);
        }
      } else {
        for (const model of visibleModels) {
          nextIds.add(model.id);
        }
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
      className="discover-models-dialog"
    >
      {/*
        Mantine portals this tree to document.body, but React still bubbles
        synthetic events through ancestors (provider editor / settings shell).
        Stop propagation so a click on the search field cannot dismiss parents.
      */}
      <div
        className="model-pick"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={copy.searchDiscovered}
          testId="discover-models-search"
          autoFocus
        />

        <div className="model-pick-toolbar">
          <button
            type="button"
            className="model-pick-select-all"
            onClick={toggleSelectVisible}
            disabled={visibleModels.length === 0}
            data-testid="discover-models-select-visible"
          >
            {allVisibleSelected
              ? isChinese
                ? '取消全选'
                : 'Deselect visible'
              : isChinese
                ? '全选可见'
                : 'Select visible'}
          </button>
          <span className="model-pick-count muted">
            {visibleModels.length}/{models.length}
          </span>
        </div>

        <div
          className="model-pick-list"
          data-testid="discover-models-list"
          role="listbox"
          aria-multiselectable="true"
        >
          {visibleModels.map((model) => {
            const alreadyConfigured = configuredIds.has(model.id);
            const selected = selectedIds.has(model.id);
            const displayName = model.label?.trim() || model.id;
            const showIdSecondary = Boolean(model.label?.trim() && model.label.trim() !== model.id);

            return (
              <label
                key={model.id}
                className={selected ? 'model-pick-row model-pick-row--selected' : 'model-pick-row'}
                role="option"
                aria-selected={selected}
              >
                <input
                  type="checkbox"
                  className="model-pick-checkbox"
                  checked={selected}
                  onChange={() => toggleModel(model.id)}
                />
                <span className="model-pick-copy">
                  <span className="model-pick-name" title={displayName}>
                    {displayName}
                  </span>
                  {showIdSecondary ? (
                    <code className="model-pick-id" title={model.id}>
                      {model.id}
                    </code>
                  ) : null}
                </span>
                {alreadyConfigured ? (
                  <span className="model-pick-badge">{copy.configured}</span>
                ) : null}
              </label>
            );
          })}
          {visibleModels.length === 0 ? (
            <p className="model-pick-empty muted">{copy.noMatchingModels}</p>
          ) : null}
        </div>
      </div>

      <div className="model-pick-footer">
        <span className="muted">{copy.selectedModels(selectedModels.length, newModelCount)}</span>
        <div className="model-pick-footer-actions">
          <Button onClick={() => onOpenChange(false)}>{common.cancel}</Button>
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
