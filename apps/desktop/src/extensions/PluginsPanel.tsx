/**
 * Plugins panel — installed plugins plus advanced local/git/registry install.
 * Discovery happens in conversation or on the sidebar marketplace page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BundledPluginSummary,
  HostResponse,
  InstalledPlugin,
  PluginInstallSource,
  PluginRegistryIndex,
} from '@piwin/contracts';
import { Spinner, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { PageTitle } from '../settings/page-title';
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
  /** Settings shell toast. Pages pass `setError` / `setInfo` from settings context. */
  onError?: (message: string | null) => void;
  onInfo?: (message: string | null) => void;
};


export function PluginsPanel(props: PluginsPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [bundled, setBundled] = useState<BundledPluginSummary[]>([]);
  const [registry, setRegistry] = useState<PluginRegistryIndex | null>(null);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [installKind, setInstallKind] = useState<'local' | 'git' | 'registry'>('local');
  const [installPath, setInstallPath] = useState('');
  const [installGitUrl, setInstallGitUrl] = useState('');
  const [installRegistryId, setInstallRegistryId] = useState('');
  const [installSecrets, setInstallSecrets] = useState('');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [bundledSecrets, setBundledSecrets] = useState<Record<string, string>>({});
  const [installOpen, setInstallOpen] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);

  const reportError = props.onError;
  const reportInfo = props.onInfo;

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    const response = await props.request({ type: 'plugins/list' });
    setLoading(false);
    if (!response.success) {
      reportError?.(response.error);
      return;
    }
    const data = response.data as {
      plugins?: InstalledPlugin[];
      bundled?: BundledPluginSummary[];
    };
    setPlugins(data.plugins ?? []);
    setBundled(data.bundled ?? []);
  }, [props, reportError]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const yoursVisible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return plugins;
    return plugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(query) || plugin.id.toLowerCase().includes(query),
    );
  }, [plugins, filter]);

  const bundledVisible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return bundled;
    return bundled.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query),
    );
  }, [bundled, filter]);

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
    reportError?.(null);
    const response = await props.request({
      type: 'plugins/install',
      source,
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    });
    setInstallingId(null);
    if (!response.success) {
      reportError?.(response.error);
      return false;
    }
    reportInfo?.(successMsg);
    setInstallPath('');
    setInstallGitUrl('');
    setInstallRegistryId('');
    setInstallSecrets('');
    void loadPlugins();
    return true;
  }

  async function handleUninstall(plugin: InstalledPlugin): Promise<void> {
    reportError?.(null);
    const response = await props.request({
      type: 'plugins/uninstall',
      pluginId: plugin.id,
    });
    if (!response.success) {
      reportError?.(response.error);
      return;
    }
    reportInfo?.(isChinese ? `已卸载插件：${plugin.name}` : `Uninstalled plugin: ${plugin.name}`);
    void loadPlugins();
  }

  async function handleLoadRegistry(): Promise<void> {
    setRegistryLoading(true);
    reportError?.(null);
    const response = await props.request({ type: 'plugins/registry/list' });
    setRegistryLoading(false);
    if (!response.success) {
      reportError?.(response.error);
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
            <TextInput
              toolbar
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder={isChinese ? '搜索插件' : 'Search plugins'}
              data-testid="plugins-filter"
              aria-label={isChinese ? '搜索插件' : 'Search plugins'}
            />
          </div>

          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center' }}>
              <Spinner />
            </div>
          ) : (
            <PluginYoursPane
              plugins={yoursVisible}
              bundled={bundledVisible}
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
              registryLoading={registryLoading}
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
              bundledSecrets={bundledSecrets}
              onBundledSecret={(pluginId, secretName, value) => {
                setBundledSecrets((current) => ({
                  ...current,
                  [`${pluginId}:${secretName}`]: value,
                }));
              }}
              onInstallBundled={(bundledId) => {
                const entry = bundled.find((plugin) => plugin.id === bundledId);
                const secrets: Record<string, string> = {};
                for (const secretName of entry?.secretNames ?? []) {
                  const value = (bundledSecrets[`${bundledId}:${secretName}`] ?? '').trim();
                  if (value) secrets[secretName] = value;
                }
                void handleInstall(
                  { kind: 'bundled', bundledId },
                  secrets,
                  isChinese ? '插件已安装' : 'Plugin installed',
                  bundledId,
                );
              }}
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
    </div>
  );
}
