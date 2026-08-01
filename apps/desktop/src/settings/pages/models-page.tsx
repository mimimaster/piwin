/**
 * Settings → Models page (Wave 3 migration from SettingsPanel).
 * Approved layout lives in ProviderSettings: provider in-page tabs + "+" add,
 * connection grid (keychain-backed API key, base URL, headers), and the
 * full-width model directory with inline expansion (Runtime Limits editing).
 * This page only binds ProviderSettings to the settings context.
 */
import type { ReactElement } from 'react';
import { ProviderSettings } from '../../ProviderSettings';
import { VisionDelegationSettings } from '../../VisionDelegationSettings';
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
    <div className="settings-card" data-testid="settings-models">
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
      <div style={{ marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--line-soft)' }}>
        <VisionDelegationSettings />
      </div>
    </div>
  );
}
