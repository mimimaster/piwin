/**
 * Settings → Models page (BYOK list + drawer).
 * ProviderSettings renders a searchable/filterable provider list with expandable
 * model management (discover / add / edit) per row, plus a connection-only
 * drawer for credentials and API address.
 * This page only binds ProviderSettings to the settings context.
 */
import type { ReactElement } from 'react';
import { ProviderSettings } from '../../ProviderSettings';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

export function ModelsPage(): ReactElement {
  const { locale } = useDesktopLocale();
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

  if (!config) {
    return (
      <p className="muted" data-testid="settings-models-loading">
        {locale === 'zh-CN' ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  return (
    <div className="settings-models-page" data-testid="settings-models">
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
    </div>
  );
}
