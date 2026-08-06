/**
 * Plugins panel — list installed plugins, install from local/git/registry,
 * uninstall, and browse the remote registry. Closest analog: ExtensionsPanel.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HostResponse,
  InstalledPlugin,
  PluginInstallSource,
  PluginRegistryIndex,
} from '@piwin/contracts';
import { Button, Collapse, Notice, SegmentedControl, Spinner, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

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

export function PluginsPanel(props: PluginsPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
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
  const [installing, setInstalling] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);

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

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return plugins;
    return plugins.filter(
      (p) => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query),
    );
  }, [plugins, filter]);

  function parseSecrets(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of raw.split(/[,\n]/)) {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const key = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (key && value) {
          result[key] = value;
        }
      }
    }
    return result;
  }

  async function handleInstall(
    source: PluginInstallSource,
    secrets: Record<string, string>,
    successMsg: string,
  ): Promise<void> {
    setInstalling(true);
    setError(null);
    const response = await props.request({
      type: 'plugins/install',
      source,
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    });
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(successMsg);
    setInstallPath('');
    setInstallGitUrl('');
    setInstallRegistryId('');
    setInstallSecrets('');
    void loadPlugins();
  }

  async function handleInstallLocal(): Promise<void> {
    if (!installPath.trim()) return;
    const secrets = parseSecrets(installSecrets);
    await handleInstall(
      { kind: 'local', path: installPath.trim() },
      secrets,
      isChinese ? '插件已安装' : 'Plugin installed',
    );
  }

  async function handleInstallGit(): Promise<void> {
    if (!installGitUrl.trim()) return;
    const secrets = parseSecrets(installSecrets);
    await handleInstall(
      { kind: 'git', url: installGitUrl.trim() },
      secrets,
      isChinese ? '插件已从 Git 安装' : 'Plugin installed from Git',
    );
  }

  async function handleInstallRegistry(): Promise<void> {
    if (!installRegistryId.trim()) return;
    const secrets = parseSecrets(installSecrets);
    await handleInstall(
      { kind: 'registry', registryId: installRegistryId.trim() },
      secrets,
      isChinese ? '插件已从 Registry 安装' : 'Plugin installed from registry',
    );
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
                ? '安装技能 + MCP + 密钥的组合包。支持本地目录、Git URL 和远程 Registry。'
                : 'Install bundles of skills + MCP servers + secrets. Supports local dirs, Git URLs, and remote registry.'
            }
            trailing={
              <span className="muted" style={{ fontSize: '12.5px' }}>
                {visible.length}/{plugins.length} {isChinese ? '已安装' : 'installed'}
              </span>
            }
          />
        ) : null}

        <div className="settings-toolbar" style={{ marginBottom: 16 }}>
          <TextInput
            toolbar
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder={isChinese ? '搜索插件…' : 'Search plugins…'}
            data-testid="plugins-filter"
            aria-label={isChinese ? '搜索插件' : 'Search plugins'}
          />
          <Button
            size="compact"
            variant="ghost"
            onClick={() => void loadPlugins()}
            data-testid="plugins-refresh"
          >
            {isChinese ? '刷新' : 'Refresh'}
          </Button>
        </div>

        {error || info ? (
          <div className="ui-feedback-host" aria-live="polite" style={{ marginBottom: 16 }}>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {info ? <Notice tone="info">{info}</Notice> : null}
          </div>
        ) : null}

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <div className="ext-empty-state" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p className="muted" style={{ fontSize: '14px', margin: 0 }}>
              {filter
                ? isChinese
                  ? '没有匹配的插件'
                  : 'No matching plugins'
                : isChinese
                  ? '未安装任何插件'
                  : 'No plugins installed'}
            </p>
          </div>
        ) : (
          <ul className="ext-list" data-testid="plugins-list">
            {visible.map((plugin) => (
              <li key={plugin.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{plugin.name}</strong>
                    <span className="pill muted">v{plugin.version}</span>
                    <span className="pill muted">{plugin.source.kind}</span>
                  </div>
                  <div className="muted ext-desc">
                    {isChinese ? '技能' : 'skills'}: {plugin.skills.length} · MCP:{' '}
                    {plugin.mcpServerIds.length} · {isChinese ? '密钥' : 'secrets'}:{' '}
                    {plugin.secrets.length}
                  </div>
                </div>
                <Button
                  size="compact"
                  variant="danger"
                  onClick={() => void handleUninstall(plugin)}
                  data-testid={`plugin-uninstall-${plugin.id}`}
                >
                  {isChinese ? '卸载' : 'Uninstall'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div
          className="settings-section"
          style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}
        >
          <button
            type="button"
            className="settings-collapsible-trigger"
            onClick={() => setInstallOpen((v) => !v)}
            aria-expanded={installOpen}
            data-testid="plugins-install-toggle"
          >
            <div className="settings-card-heading" style={{ flex: 1 }}>
              <h4>{isChinese ? '安装插件' : 'Install plugin'}</h4>
            </div>
          </button>
          <Collapse expanded={installOpen}>
            <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SegmentedControl
                value={installKind}
                onChange={(value) => setInstallKind(value as 'local' | 'git' | 'registry')}
                data={[
                  { value: 'local', label: isChinese ? '本地' : 'Local' },
                  { value: 'git', label: 'Git' },
                  { value: 'registry', label: isChinese ? 'Registry' : 'Registry' },
                ]}
              />
              {installKind === 'local' ? (
                <TextInput
                  value={installPath}
                  onChange={(event) => setInstallPath(event.currentTarget.value)}
                  placeholder={isChinese ? '本地插件目录路径' : 'Local plugin directory path'}
                  data-testid="plugin-install-local-path"
                />
              ) : null}
              {installKind === 'git' ? (
                <TextInput
                  value={installGitUrl}
                  onChange={(event) => setInstallGitUrl(event.currentTarget.value)}
                  placeholder={
                    isChinese
                      ? 'Git URL (https://github.com/...)'
                      : 'Git URL (https://github.com/...)'
                  }
                  data-testid="plugin-install-git-url"
                />
              ) : null}
              {installKind === 'registry' ? (
                <TextInput
                  value={installRegistryId}
                  onChange={(event) => setInstallRegistryId(event.currentTarget.value)}
                  placeholder={isChinese ? 'Registry 插件 ID' : 'Registry plugin id'}
                  data-testid="plugin-install-registry-id"
                />
              ) : null}
              <TextInput
                value={installSecrets}
                onChange={(event) => setInstallSecrets(event.currentTarget.value)}
                placeholder={
                  isChinese
                    ? '密钥 (KEY=value, 逗号分隔，可选)'
                    : 'Secrets (KEY=value, comma-separated, optional)'
                }
                data-testid="plugin-install-secrets"
              />
              <Button
                size="compact"
                variant="primary"
                disabled={installing}
                onClick={() => {
                  if (installKind === 'local') void handleInstallLocal();
                  else if (installKind === 'git') void handleInstallGit();
                  else void handleInstallRegistry();
                }}
                data-testid="plugin-install-confirm"
              >
                {installing
                  ? isChinese
                    ? '安装中…'
                    : 'Installing…'
                  : isChinese
                    ? '安装'
                    : 'Install'}
              </Button>
            </div>
          </Collapse>
        </div>

        <div
          className="settings-section"
          style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line-soft)' }}
        >
          <button
            type="button"
            className="settings-collapsible-trigger"
            onClick={() => {
              setRegistryOpen((v) => !v);
              if (!registry) void handleLoadRegistry();
            }}
            aria-expanded={registryOpen}
            data-testid="plugins-registry-toggle"
          >
            <div className="settings-card-heading" style={{ flex: 1 }}>
              <h4>{isChinese ? 'Registry 浏览' : 'Registry browser'}</h4>
            </div>
          </button>
          <Collapse expanded={registryOpen}>
            <div style={{ paddingTop: 16 }}>
              {registry ? (
                registry.plugins.length === 0 ? (
                  <p className="muted" style={{ fontSize: '13px' }}>
                    {isChinese ? 'Registry 为空' : 'Registry is empty'}
                  </p>
                ) : (
                  <ul className="ext-list" data-testid="plugins-registry-list">
                    {registry.plugins.map((entry) => (
                      <li key={entry.id} className="ext-list-item">
                        <div className="ext-list-main">
                          <div className="ext-list-title">
                            <strong>{entry.name}</strong>
                            <span className="pill muted">v{entry.version}</span>
                            <span className="pill muted">{entry.source.kind}</span>
                          </div>
                          {entry.description ? (
                            <div className="muted ext-desc">{entry.description}</div>
                          ) : null}
                        </div>
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() => {
                            setInstallKind('registry');
                            setInstallRegistryId(entry.id);
                            setInstallOpen(true);
                          }}
                          data-testid={`plugin-registry-install-${entry.id}`}
                        >
                          {isChinese ? '安装' : 'Install'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div style={{ padding: '16px', textAlign: 'center' }}>
                  <Spinner />
                </div>
              )}
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  );
}
