/**
 * Plugins panel — marketplace of opt-in plugins, plus installed ("Yours")
 * management and advanced local/git/registry install.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HostResponse,
  InstalledPlugin,
  PluginInstallSource,
  PluginRegistryIndex,
} from '@piwin/contracts';
import { Notice, SegmentedControl, Spinner, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import {
  filterMarketplaceCards,
  marketplaceCardsForCategory,
  type PluginMarketplaceCard,
} from './plugin-marketplace-catalog';
import { PluginMarketplaceCardView } from './plugin-marketplace-card';
import { PluginMarketplaceSecretDialog } from './plugin-marketplace-secret-dialog';
import { PluginYoursPane } from './plugin-yours-pane';

export type PluginsPanelProps = {
  request: (command: {
    type:
      | 'plugins/list'
      | 'plugins/install'
      | 'plugins/uninstall'
      | 'plugins/registry/list'
      | 'plugins/secrets/collect';
    source?: PluginInstallSource;
    pluginId?: string;
    secrets?: Record<string, string>;
    registryUrl?: string;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

type MarketTab = 'marketplace' | 'yours';

export function PluginsPanel(props: PluginsPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [tab, setTab] = useState<MarketTab>('marketplace');
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [registry, setRegistry] = useState<PluginRegistryIndex | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installKind, setInstallKind] = useState<'local' | 'git' | 'registry'>('local');
  const [installPath, setInstallPath] = useState('');
  const [installGitUrl, setInstallGitUrl] = useState('');
  const [installRegistryId, setInstallRegistryId] = useState('');
  const [installSecrets, setInstallSecrets] = useState('');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [pendingCard, setPendingCard] = useState<PluginMarketplaceCard | null>(null);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await props.request({ type: 'plugins/list' });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { plugins: InstalledPlugin[] };
    setPlugins(data.plugins ?? []);
  }, [props]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const installedIds = useMemo(() => new Set(plugins.map((plugin) => plugin.id)), [plugins]);
  const featuredCards = useMemo(() => {
    return filterMarketplaceCards(marketplaceCardsForCategory('featured'), filter);
  }, [filter]);
  const yoursVisible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return plugins;
    return plugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(query) || plugin.id.toLowerCase().includes(query),
    );
  }, [plugins, filter]);

  function parseSecrets(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of raw.split(/[,\n]/)) {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (key && value) result[key] = value;
      }
    }
    return result;
  }

  async function handleInstall(
    source: PluginInstallSource,
    secrets: Record<string, string>,
    successMsg: string,
    busyId?: string,
  ): Promise<boolean> {
    setInstallingId(busyId ?? 'manual');
    setError(null);
    const response = await props.request({
      type: 'plugins/install',
      source,
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    });
    setInstallingId(null);
    if (!response.success) {
      setError(response.error);
      return false;
    }
    setInfo(successMsg);
    setInstallPath('');
    setInstallGitUrl('');
    setInstallRegistryId('');
    setInstallSecrets('');
    void loadPlugins();
    return true;
  }

  async function addMarketplaceCard(
    card: PluginMarketplaceCard,
    secrets: Record<string, string>,
  ): Promise<void> {
    const ok = await handleInstall(
      { kind: 'bundled', bundledId: card.id },
      secrets,
      isChinese ? `已添加 ${card.name}` : `Added ${card.name}`,
      card.id,
    );
    if (ok) setPendingCard(null);
  }

  function handleMarketplaceAdd(card: PluginMarketplaceCard): void {
    if (card.secrets.some((secret) => secret.required)) {
      setPendingCard(card);
      return;
    }
    void addMarketplaceCard(card, {});
  }

  async function handleUninstall(plugin: InstalledPlugin): Promise<void> {
    setError(null);
    const response = await props.request({
      type: 'plugins/uninstall',
      pluginId: plugin.id,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? `已卸载插件：${plugin.name}` : `Uninstalled plugin: ${plugin.name}`);
    void loadPlugins();
  }

  async function handleLoadRegistry(): Promise<void> {
    setError(null);
    const response = await props.request({ type: 'plugins/registry/list' });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { index: PluginRegistryIndex };
    setRegistry(data.index);
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
        {props.variant !== 'inline' ? (
          <PageTitle
            title={isChinese ? '插件' : 'Plugins'}
            description={
              isChinese
                ? '自己决定装哪些插件，并自行配置密钥。'
                : 'Choose which plugins to add, then configure them yourself.'
            }
          />
        ) : null}

        <div className="plugin-market">
          <div className="plugin-market-header">
            <SegmentedControl
              value={tab}
              onChange={(value) => setTab(value as MarketTab)}
              data={[
                { value: 'marketplace', label: isChinese ? '市场' : 'Marketplace' },
                { value: 'yours', label: isChinese ? '已安装' : 'Yours' },
              ]}
              testId="plugin-market-tabs"
            />
            <TextInput
              toolbar
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder={isChinese ? '搜索插件' : 'Search plugins'}
              data-testid="plugins-filter"
              aria-label={isChinese ? '搜索插件' : 'Search plugins'}
            />
          </div>

          {error || info ? (
            <div className="ui-feedback-host" aria-live="polite" style={{ marginBottom: 16 }}>
              {error ? <Notice tone="error">{error}</Notice> : null}
              {info ? <Notice tone="info">{info}</Notice> : null}
            </div>
          ) : null}

          {tab === 'marketplace' ? (
            <MarketplacePane
              cards={featuredCards}
              installedIds={installedIds}
              installingId={installingId}
              isChinese={isChinese}
              empty={
                filter
                  ? isChinese
                    ? '没有匹配的插件'
                    : 'No matching plugins'
                  : isChinese
                    ? '暂无推荐插件'
                    : 'No featured plugins'
              }
              onAdd={handleMarketplaceAdd}
            />
          ) : loading ? (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <Spinner />
            </div>
          ) : (
            <PluginYoursPane
              plugins={yoursVisible}
              isChinese={isChinese}
              emptyFilter={Boolean(filter)}
              installKind={installKind}
              installPath={installPath}
              installGitUrl={installGitUrl}
              installRegistryId={installRegistryId}
              installSecrets={installSecrets}
              installing={installingId !== null}
              installOpen={installOpen}
              registryOpen={registryOpen}
              registry={registry}
              onInstallKind={setInstallKind}
              onInstallPath={setInstallPath}
              onInstallGitUrl={setInstallGitUrl}
              onInstallRegistryId={setInstallRegistryId}
              onInstallSecrets={setInstallSecrets}
              onInstallOpen={setInstallOpen}
              onRegistryOpen={(open) => {
                setRegistryOpen(open);
                if (open && !registry) void handleLoadRegistry();
              }}
              onUninstall={(plugin) => void handleUninstall(plugin)}
              onInstallLocal={() => {
                if (!installPath.trim()) return;
                void handleInstall(
                  { kind: 'local', path: installPath.trim() },
                  parseSecrets(installSecrets),
                  isChinese ? '插件已安装' : 'Plugin installed',
                );
              }}
              onInstallGit={() => {
                if (!installGitUrl.trim()) return;
                void handleInstall(
                  { kind: 'git', url: installGitUrl.trim() },
                  parseSecrets(installSecrets),
                  isChinese ? '插件已从 Git 安装' : 'Plugin installed from Git',
                );
              }}
              onInstallRegistry={() => {
                if (!installRegistryId.trim()) return;
                void handleInstall(
                  { kind: 'registry', registryId: installRegistryId.trim() },
                  parseSecrets(installSecrets),
                  isChinese ? '插件已从商店安装' : 'Plugin installed from registry',
                );
              }}
              onPickRegistry={(id) => {
                setInstallKind('registry');
                setInstallRegistryId(id);
                setInstallOpen(true);
              }}
            />
          )}
        </div>
      </div>
      {pendingCard ? (
        <PluginMarketplaceSecretDialog
          card={pendingCard}
          isChinese={isChinese}
          busy={installingId === pendingCard.id}
          onClose={() => setPendingCard(null)}
          onConfirm={(secrets) => void addMarketplaceCard(pendingCard, secrets)}
        />
      ) : null}
    </div>
  );
}

function MarketplacePane(props: {
  cards: PluginMarketplaceCard[];
  installedIds: Set<string>;
  installingId: string | null;
  isChinese: boolean;
  empty: string;
  onAdd: (card: PluginMarketplaceCard) => void;
}) {
  if (props.cards.length === 0) {
    return <p className="plugin-market-empty">{props.empty}</p>;
  }
  return (
    <section className="plugin-market-section" data-testid="plugin-market-featured">
      <h4 className="plugin-market-section-label">{props.isChinese ? '精选' : 'Featured'}</h4>
      <div className="plugin-market-grid">
        {props.cards.map((card) => (
          <PluginMarketplaceCardView
            key={card.id}
            card={card}
            added={props.installedIds.has(card.id)}
            busy={props.installingId === card.id}
            isChinese={props.isChinese}
            onAdd={props.onAdd}
          />
        ))}
      </div>
    </section>
  );
}
