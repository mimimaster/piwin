import type {
  ModelCatalogEntry,
  ModelConfigEntry,
  ModelProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import { Button, TextInput } from '@piwin/ui-kit';
import type { ReactElement } from 'react';
import { ProviderRow } from './provider-row.js';
import type { ProviderTestStatus } from './provider-status.js';
import { IconPlus, IconSearch } from './shell-icons.js';

export type ProviderListCopy = {
  modelsHeading: string;
  searchPlaceholder: string;
  filterAll: string;
  filterOn: string;
  filterOff: string;
  noProviders: string;
  noMatchingProviders: string;
  addProvider: string;
  addProviderHint: string;
};

export type ModelTestState = {
  tone: 'ok' | 'error' | 'busy';
  message: string;
};

export type ProviderListProps = {
  config: PiwinConfig;
  filteredProviders: readonly ModelProviderConfig[];
  providerCount: number;
  enabledCount: number;
  modelCount: number;
  query: string;
  setQuery: (query: string) => void;
  filter: 'all' | 'on' | 'off';
  setFilter: (filter: 'all' | 'on' | 'off') => void;
  isChinese: boolean;
  saving: boolean;
  copy: ProviderListCopy;
  getProviderStatus: (provider: ModelProviderConfig) => ProviderTestStatus;
  onOpenProvider: (provider: ModelProviderConfig) => void;
  onToggleProvider: (id: string) => void;
  onAddOpen: () => void;
  /** Update a provider's models (from expanded row). */
  onUpdateProviderModels: (providerId: string, models: ModelConfigEntry[]) => void;
  /** Test a model (from expanded row). */
  onTestProviderModel: (providerId: string, modelId: string) => void;
  /** Set default model (from expanded row). */
  onSetDefaultModel: (providerId: string, modelId: string) => void;
  /** Per-provider model test status, keyed by `${providerId}::${modelId}`. */
  modelTestStatus?: Record<string, ModelTestState>;
  /** Currently testing model key (`${providerId}::${modelId}`) or null. */
  testingModelKey?: string | null;
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
};

function formatCount(isChinese: boolean, count: number, label: string): string {
  return isChinese ? `${count} ${label}` : `${count} ${label}${count === 1 ? '' : 's'}`;
}

export function ProviderList({
  config,
  filteredProviders,
  providerCount,
  enabledCount,
  modelCount,
  query,
  setQuery,
  filter,
  setFilter,
  isChinese,
  saving,
  copy,
  getProviderStatus,
  onOpenProvider,
  onToggleProvider,
  onAddOpen,
  onUpdateProviderModels,
  onTestProviderModel,
  onSetDefaultModel,
  modelTestStatus = {},
  testingModelKey = null,
  searchCatalog,
}: ProviderListProps): ReactElement {
  const providerLabel = isChinese ? '个提供商' : 'providers';
  const enabledLabel = isChinese ? '个已启用' : 'enabled';
  const modelLabel = isChinese ? '个模型' : 'models';

  return (
    <div className="provider-settings" data-testid="provider-settings">
      <div className="provider-list-header">
        <div>
          <h2 className="provider-list-title">{copy.modelsHeading}</h2>
          <div className="provider-list-meta muted">
            {formatCount(isChinese, providerCount, providerLabel)}
            <span className="provider-list-meta-dot" aria-hidden>
              ·
            </span>
            {formatCount(isChinese, enabledCount, enabledLabel)}
            <span className="provider-list-meta-dot" aria-hidden>
              ·
            </span>
            {formatCount(isChinese, modelCount, modelLabel)}
          </div>
        </div>
      </div>

      <div className="provider-list-toolbar">
        <div className="provider-list-search">
          <IconSearch width={14} height={14} />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={copy.searchPlaceholder}
            spellCheck={false}
            testId="provider-search-input"
          />
        </div>
        <div className="provider-list-filters">
          {(['all', 'on', 'off'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`provider-filter-chip${filter === f ? ' provider-filter-chip--active' : ''}`}
              onClick={() => setFilter(f)}
              data-testid={`provider-filter-${f}`}
            >
              {f === 'all' ? copy.filterAll : f === 'on' ? copy.filterOn : copy.filterOff}
            </button>
          ))}
        </div>
        <div className="provider-list-toolbar-spacer" />
        <Button
          size="compact"
          onClick={onAddOpen}
          data-testid="provider-add-open"
          className="provider-list-add-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <IconPlus width={14} height={14} />
          {copy.addProvider}
        </Button>
      </div>

      <div className="provider-list-scroll">
        <div className="provider-list-count">
          {isChinese
            ? `已添加（${filteredProviders.length}）`
            : `Added (${filteredProviders.length})`}
        </div>
        {filteredProviders.map((provider) => {
          const providerModelTestStatus: Record<string, ModelTestState> = {};
          for (const model of provider.models) {
            const key = `${provider.id}::${model.id}`;
            const ts = modelTestStatus[key];
            if (ts) providerModelTestStatus[model.id] = ts;
          }
          return (
            <ProviderRow
              key={provider.id}
              provider={provider}
              status={getProviderStatus(provider)}
              isDefault={provider.id === config.defaultProviderId}
              isChinese={isChinese}
              disabled={saving}
              modelTestStatus={providerModelTestStatus}
              testingModelId={
                testingModelKey?.startsWith(`${provider.id}::`)
                  ? testingModelKey.slice(provider.id.length + 2)
                  : null
              }
              {...(searchCatalog ? { searchCatalog } : {})}
              onOpen={() => onOpenProvider(provider)}
              onToggle={() => onToggleProvider(provider.id)}
              onUpdateModels={(models) => onUpdateProviderModels(provider.id, models)}
              onTestModel={(modelId) => onTestProviderModel(provider.id, modelId)}
              onSetDefaultModel={(modelId) => onSetDefaultModel(provider.id, modelId)}
            />
          );
        })}
        {filteredProviders.length === 0 && (
          <div className="provider-empty" data-testid="provider-empty">
            {query || filter !== 'all' ? copy.noMatchingProviders : copy.noProviders}
          </div>
        )}
        <button
          type="button"
          className="provider-add-block"
          onClick={onAddOpen}
          data-testid="provider-add-block"
        >
          <span className="provider-add-block-plus">
            <IconPlus width={16} height={16} />
          </span>
          <div className="provider-add-block-text">
            <b>{copy.addProvider}</b>
            <span>{copy.addProviderHint}</span>
          </div>
        </button>
      </div>
    </div>
  );
}
