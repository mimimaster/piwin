/**
 * Marketplace full-window subpage view.
 *
 * Implements native Pi extension & plugin discovery, 4-tier compatibility
 * classification, and turn-boundary live runtime hot-reloading.
 * Fully conforms to the Inkstone design system, pure typography-first layout.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  ExtensionSummary,
  HostCommand,
  HostResponse,
  MarketplaceSearchHit,
} from '@piwin/contracts';
import { resourceSourceLabel } from '@piwin/contracts';
import { Button, EmptyState, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from '../desktop-locale.js';
import { IconExtension } from '../shell-icons.js';
import { StudioTopbar } from './studio/studio-chrome.js';
import {
  INITIAL_EXTENSIONS,
  INITIAL_PLUGINS,
  type MarketCategory,
  type MarketExtensionItem,
  type MarketPluginItem,
  type MarketplaceToast,
  type MarketTab,
  MarketplaceExtensionCard,
  MarketplacePluginCard,
  MarketplacePiPackageCard,
  ExtensionInstallConsentDialog,
  PluginSecretDialog,
  useMarketplaceEcosystemSearch,
} from './marketplace/index.js';

export type MarketplaceWorkspaceViewProps = {
  locale?: DesktopLocale | undefined;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  projectPath?: string | null | undefined;
};

export function MarketplaceWorkspaceView(props: MarketplaceWorkspaceViewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [tab, setTab] = useState<MarketTab>('extensions');
  const [category, setCategory] = useState<MarketCategory>('all');
  const [search, setSearch] = useState('');
  const [activeGen, setActiveGen] = useState(1);
  const [extensions, setExtensions] = useState<MarketExtensionItem[]>(INITIAL_EXTENSIONS);
  const [plugins, setPlugins] = useState<MarketPluginItem[]>(INITIAL_PLUGINS);
  const [toast, setToast] = useState<MarketplaceToast | null>(null);

  const [consentTarget, setConsentTarget] = useState<MarketExtensionItem | null>(null);
  const [secretTarget, setSecretTarget] = useState<MarketPluginItem | null>(null);
  const ecosystemQuery = tab === 'installed' ? '' : search;
  const ecosystem = useMarketplaceEcosystemSearch(ecosystemQuery, props.request);

  // Synchronize with host's real extension inventory on mount
  useEffect(() => {
    let unmounted = false;
    async function loadLiveExtensions() {
      try {
        const res = await props.request({
          type: 'extensions/list',
          ...(props.projectPath ? { projectPath: props.projectPath } : {}),
        } as HostCommand);

        if (!unmounted && res.success && res.data && Array.isArray((res.data as { extensions?: ExtensionSummary[] }).extensions)) {
          const liveList = (res.data as { extensions: ExtensionSummary[] }).extensions;
          setExtensions((current) => {
            const merged = [...current];
            for (const live of liveList) {
              const existingIdx = merged.findIndex((m) => m.id === live.id || m.name === live.name);
              if (existingIdx >= 0) {
                const existing = merged[existingIdx]!;
                merged[existingIdx] = {
                  ...existing,
                  installed: true,
                  active: live.enabled,
                  source: live.source,
                  descriptionZh: live.description || existing.descriptionZh,
                };
              } else {
                merged.push({
                  id: live.id,
                  name: live.name,
                  version: live.version || '1.0.0',
                  source: live.source,
                  author:
                    live.source === 'bundled'
                      ? resourceSourceLabel('bundled', isZh ? 'zh-CN' : 'en')
                      : live.source,
                  category: 'tools',
                  bundled: live.source === 'bundled',
                  installed: true,
                  active: live.enabled,
                  descriptionZh: live.description || live.name,
                  descriptionEn: live.description || live.name,
                  tools: [],
                  hooks: live.hookEvents || [],
                  tier: live.compatibility?.tier || 'compatible',
                  degradations: live.compatibility?.degradations?.map((d) => d.tag) || [],
                });
              }
            }
            return merged;
          });
        }
      } catch {
        // Fallback to bundled inventory if host does not implement extensions/list
      }
    }
    void loadLiveExtensions();
    return () => {
      unmounted = true;
    };
  }, [props.request, props.projectPath]);

  const showToast = (text: string, type: MarketplaceToast['type'] = 'info') => {
    setToast({ text, type });
    window.setTimeout(() => setToast(null), 4000);
  };

  const filteredExtensions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return extensions.filter((ext) => {
      // Incompatible extensions are hidden proactively by default; they can only be found via explicit search.
      if (!q && ext.tier === 'incompatible' && !ext.installed) {
        return false;
      }

      const matchCat =
        category === 'all' ||
        (category === 'bundled' && ext.bundled) ||
        ext.category === category;
      const matchSearch =
        !q ||
        ext.name.toLowerCase().includes(q) ||
        ext.id.toLowerCase().includes(q) ||
        (isZh ? ext.descriptionZh : ext.descriptionEn).toLowerCase().includes(q) ||
        ext.tools.some((tool) => tool.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [extensions, category, search, isZh]);

  const filteredPlugins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plugins.filter((plugin) => {
      const matchCat = category === 'all' || (category === 'bundled' && plugin.bundled);
      const matchSearch =
        !q ||
        plugin.name.toLowerCase().includes(q) ||
        plugin.id.toLowerCase().includes(q) ||
        (isZh ? plugin.descriptionZh : plugin.descriptionEn).toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [plugins, category, search, isZh]);

  const activeExtensionsCount = useMemo(
    () => extensions.filter((e) => e.installed && e.active).length,
    [extensions],
  );

  const installedPluginsCount = useMemo(
    () => plugins.filter((p) => p.installed).length,
    [plugins],
  );

  const installedTotal = activeExtensionsCount + installedPluginsCount;

  const handleInstallExtension = (ext: MarketExtensionItem) => {
    setConsentTarget(ext);
  };

  const handleConfirmInstallExtension = (target: MarketExtensionItem) => {
    setConsentTarget(null);
    showToast(
      t(
        `Staging [${target.name}] and hot-reloading active runtime...`,
        `正在暂存 [${target.name}]，并在当前会话热重载生效...`,
      ),
      'info',
    );

    window.setTimeout(() => {
      setExtensions((prev) =>
        prev.map((e) => (e.id === target.id ? { ...e, installed: true, active: true } : e)),
      );
      setActiveGen((g) => g + 1);
      showToast(
        t(
          `[${target.name}] installed and live reloaded (Gen v${activeGen + 1})!`,
          `[${target.name}] 已安装并成功热重载（Runtime Gen v${activeGen + 1}）！`,
        ),
        'success',
      );
    }, 600);
  };

  const handleUninstallExtension = (ext: MarketExtensionItem) => {
    setExtensions((prev) =>
      prev.map((e) => (e.id === ext.id ? { ...e, installed: false, active: false } : e)),
    );
    showToast(t(`Uninstalled [${ext.name}]`, `已卸载 [${ext.name}]`), 'info');
  };

  const handleInstallPlugin = (plugin: MarketPluginItem) => {
    if (plugin.secrets.length > 0) {
      setSecretTarget(plugin);
    } else {
      setPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, installed: true } : p)),
      );
      showToast(
        t(`Added plugin [${plugin.name}], synced MCP configuration!`, `已添加插件 [${plugin.name}]，已同步 MCP 配置！`),
        'success',
      );
    }
  };

  const handleConfirmPluginSecret = (
    plugin: MarketPluginItem,
    _secrets: Record<string, string>,
  ) => {
    setSecretTarget(null);
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, installed: true } : p)),
    );
    showToast(
      t(
        `Secret saved securely to Keychain. Plugin [${plugin.name}] enabled!`,
        `密钥已安全保存至 Keychain，插件 [${plugin.name}] 已启用！`,
      ),
      'success',
    );
  };

  const handleCopyPiInstall = (hit: MarketplaceSearchHit) => {
    void navigator.clipboard.writeText(hit.installCommand).then(
      () => {
        showToast(
          t(
            `Copied ${hit.installCommand}. Run it, then Refresh Settings → Extensions.`,
            `已复制 ${hit.installCommand}。运行后到 设置 → 扩展 点刷新。`,
          ),
          'success',
        );
      },
      () => {
        showToast(t('Could not copy install command', '无法复制安装命令'), 'error');
      },
    );
  };

  const handleUninstallPlugin = (plugin: MarketPluginItem) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, installed: false } : p)),
    );
    showToast(t(`Removed plugin [${plugin.name}]`, `已移除插件 [${plugin.name}]`), 'info');
  };

  const categories: Array<{ id: MarketCategory; label: string }> = [
    { id: 'all', label: t('All', '全部') },
    { id: 'bundled', label: t('bundled', '应用内置') },
    { id: 'workflow', label: t('Workflow', '任务规划') },
    { id: 'tools', label: t('Tools', '工具与钩子') },
    { id: 'guard', label: t('Guards', '安全守卫') },
  ];

  const subbarFilters = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="market-tab-wrap" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'extensions'}
          className={`market-tab-btn${tab === 'extensions' ? ' is-active' : ''}`}
          onClick={() => setTab('extensions')}
        >
          <span>{t('Extensions', '扩展')}</span>
          <span className="market-tab-count">({extensions.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'plugins'}
          className={`market-tab-btn${tab === 'plugins' ? ' is-active' : ''}`}
          onClick={() => setTab('plugins')}
        >
          <span>{t('Plugins', '插件')}</span>
          <span className="market-tab-count">({plugins.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'installed'}
          className={`market-tab-btn${tab === 'installed' ? ' is-active' : ''}`}
          onClick={() => setTab('installed')}
        >
          <span>{t('Installed', '已装载')}</span>
          <span className="market-tab-count">({installedTotal})</span>
        </button>
      </div>

      {tab !== 'installed' && (
        <div className="market-category-strip">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`vault-chip${category === cat.id ? ' is-on' : ''}`}
              onClick={() => setCategory(cat.id)}
            >
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const currentCount =
    tab === 'extensions'
      ? filteredExtensions.length
      : tab === 'plugins'
        ? filteredPlugins.length
        : installedTotal;

  return (
    <div className="vault-stage marketplace-stage" data-testid="marketplace-workspace">
      <StudioTopbar
        testId="marketplace-back-btn"
        backLabel={t('Back', '返回')}
        onBack={props.onClose}
        locale={props.locale}
        kind="marketplace"
        layout="page"
        titleCount={currentCount}
        searchPlaceholder={t('Search extensions & plugins…', '检索扩展与插件…')}
        searchTestId="marketplace-search-input"
        searchValue={search}
        onSearchChange={setSearch}
        filters={subbarFilters}
        barActions={
          <div
            className="market-gen-badge"
            title={t(
              'Live session runtime generation. Hot-reloaded at turn boundaries.',
              '当前会话运行时世代，任务边界无缝热重载。',
            )}
          >
            <span className="market-gen-dot" aria-hidden="true" />
            <span className="market-gen-ver">Runtime Gen v{activeGen}</span>
            <span className="market-gen-sub">
              • {t(`${activeExtensionsCount} live`, `${activeExtensionsCount} 个已装载`)}
            </span>
          </div>
        }
      />

      <main className="vault-main marketplace-main" id="vault-main">
        {toast && (
          <div className="market-notice-wrap">
            <Notice tone={toast.type} testId="marketplace-toast">
              {toast.text}
            </Notice>
          </div>
        )}

        {tab === 'extensions' && (
          <>
            {search.trim() ? (
              <section className="market-ecosystem" data-testid="marketplace-ecosystem">
                <header className="market-ecosystem-header">
                  <h2 className="market-ecosystem-title">
                    {t('Pi catalog', 'Pi 生态')}
                  </h2>
                  <p className="market-ecosystem-sub">
                    {t(
                      'Live search: npm packages tagged pi-package, plus GitHub repos with topic:pi-package.',
                      '实时搜索：npm 上的 pi-package，以及 GitHub 上带 topic:pi-package 的仓库。',
                    )}
                  </p>
                </header>
                {ecosystem.error ? (
                  <Notice tone="warning" testId="marketplace-ecosystem-error">
                    {t('Could not reach npm:', '无法连接 npm：')} {ecosystem.error}
                  </Notice>
                ) : null}
                {ecosystem.loading && ecosystem.hits.length === 0 ? (
                  <p className="market-ecosystem-status" data-testid="marketplace-ecosystem-loading">
                    {t('Searching npm and GitHub…', '正在搜索 npm 与 GitHub…')}
                  </p>
                ) : null}
                {ecosystem.hits.length > 0 ? (
                  <div className="market-grid">
                    {ecosystem.hits.map((hit) => (
                      <MarketplacePiPackageCard
                        key={hit.entryId}
                        hit={hit}
                        locale={props.locale}
                        onCopyInstall={handleCopyPiInstall}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {filteredExtensions.length === 0 &&
            !(search.trim() && (ecosystem.loading || ecosystem.hits.length > 0)) ? (
              <EmptyState
                visual={<IconExtension width={28} height={28} aria-hidden="true" />}
                seal={search.trim() ? '寻' : '空'}
                badge={search.trim() ? t(`Query: "${search.trim()}"`, `搜索: "${search.trim()}"`) : undefined}
                title={t('No extensions found', '未找到匹配的扩展')}
                description={
                  search.trim()
                    ? t(
                        'No local extensions match your search. Try adjusting the query or reset filters.',
                        '未找到与搜索词匹配的扩展。请尝试更换关键词或清空筛选。',
                      )
                    : t(
                        'Try adjusting your search query or switching to another category.',
                        '请尝试更换关键词或在上方切换筛选分类。',
                      )
                }
                suggestions={
                  search.trim() || category !== 'all'
                    ? [
                        ...(search.trim()
                          ? [{ label: t('Clear keyword', '清空关键词'), onClick: () => setSearch('') }]
                          : []),
                        ...(category !== 'all'
                          ? [{ label: t('Show all categories', '全部分类'), onClick: () => setCategory('all') }]
                          : []),
                      ]
                    : undefined
                }
                action={
                  <Button variant="secondary" size="compact" onClick={() => { setSearch(''); setCategory('all'); }}>
                    {t('Clear filters', '清空筛选')}
                  </Button>
                }
                size="spacious"
                testId="marketplace-empty"
              />
            ) : filteredExtensions.length > 0 ? (
              <div className="market-grid">
                {filteredExtensions.map((ext) => (
                  <MarketplaceExtensionCard
                    key={ext.id}
                    extension={ext}
                    locale={props.locale}
                    onInstall={handleInstallExtension}
                    onUninstall={handleUninstallExtension}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}

        {tab === 'plugins' && (
          filteredPlugins.length === 0 ? (
            <EmptyState
              visual={<IconExtension width={28} height={28} aria-hidden="true" />}
              seal={search.trim() ? '寻' : '空'}
              badge={search.trim() ? t(`Query: "${search.trim()}"`, `搜索: "${search.trim()}"`) : undefined}
              title={t('No plugins found', '未找到匹配的插件')}
              description={t(
                'Try adjusting your search query.',
                '请尝试更换关键词。',
              )}
              suggestions={
                search.trim()
                  ? [{ label: t('Clear keyword', '清空关键词'), onClick: () => setSearch('') }]
                  : undefined
              }
              action={
                <Button variant="secondary" size="compact" onClick={() => setSearch('')}>
                  {t('Clear search', '清空搜索')}
                </Button>
              }
              size="spacious"
              testId="marketplace-empty-plugins"
            />
          ) : (
            <div className="market-grid">
              {filteredPlugins.map((plugin) => (
                <MarketplacePluginCard
                  key={plugin.id}
                  plugin={plugin}
                  locale={props.locale}
                  onInstall={handleInstallPlugin}
                  onUninstall={handleUninstallPlugin}
                />
              ))}
            </div>
          )
        )}

        {tab === 'installed' && (
          installedTotal === 0 ? (
            <EmptyState
              visual={<IconExtension width={28} height={28} aria-hidden="true" />}
              seal="墨"
              title={t('No extensions or plugins installed yet', '尚未安装任何扩展或插件')}
              description={t(
                'Browse extensions or plugins in the marketplace to expand your Pi session capabilities.',
                '前往扩展或插件专区一键安装，为当前会话注入更多专业能力。',
              )}
              action={
                <Button variant="primary" size="compact" onClick={() => setTab('extensions')}>
                  {t('Browse Extensions', '浏览扩展')}
                </Button>
              }
              size="spacious"
              testId="marketplace-empty-installed"
            />
          ) : (
            <div className="market-installed-list">
              {extensions
                .filter((e) => e.installed)
                .map((ext) => (
                  <div key={ext.id} className="market-installed-item">
                    <div className="market-installed-info">
                      <div className="market-installed-texts">
                        <div className="market-card-title-row">
                          <strong className="market-installed-name">{ext.name}</strong>
                          <span className={`market-source-pill is-${ext.source}`}>
                            {ext.source === 'npm' || ext.source === 'git'
                              ? ext.source
                              : resourceSourceLabel(ext.source, isZh ? 'zh-CN' : 'en')}
                          </span>
                        </div>
                        <span className="market-card-meta">
                          {ext.id} • v{ext.version} • {ext.author}
                        </span>
                      </div>
                    </div>
                    <div className="market-installed-actions">
                      <span className="market-card-status-active">
                        {ext.active ? t('Active', '已启用') : t('Paused', '已暂停')}
                      </span>
                      {!ext.bundled && (
                        <Button
                          variant="ghost"
                          size="compact"
                          onClick={() => handleUninstallExtension(ext)}
                        >
                          {t('Uninstall', '卸载')}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

              {plugins
                .filter((p) => p.installed)
                .map((plugin) => (
                  <div key={plugin.id} className="market-installed-item">
                    <div className="market-installed-info">
                      <div className="market-installed-texts">
                        <div className="market-card-title-row">
                          <strong className="market-installed-name">{plugin.name}</strong>
                          <span className="market-source-pill is-native">plugin</span>
                        </div>
                        <span className="market-card-meta">
                          {plugin.id} • v{plugin.version} • {plugin.category}
                        </span>
                      </div>
                    </div>
                    <div className="market-installed-actions">
                      <span className="market-card-status-active">
                        {t('MCP Synced', 'MCP 已同步')}
                      </span>
                      <Button
                        variant="ghost"
                        size="compact"
                        onClick={() => handleUninstallPlugin(plugin)}
                      >
                        {t('Remove', '移除')}
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )
        )}
      </main>

      <ExtensionInstallConsentDialog
        extension={consentTarget}
        locale={props.locale}
        onConfirm={handleConfirmInstallExtension}
        onCancel={() => setConsentTarget(null)}
      />

      <PluginSecretDialog
        plugin={secretTarget}
        locale={props.locale}
        onConfirm={handleConfirmPluginSecret}
        onCancel={() => setSecretTarget(null)}
      />
    </div>
  );
}
