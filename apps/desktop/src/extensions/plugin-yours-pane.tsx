/**
 * Installed plugins list plus advanced local/git/registry install.
 */
import type { BundledPluginSummary, InstalledPlugin, PluginRegistryIndex } from '@piwin/contracts';
import { pluginSourceKindLabel } from '@piwin/contracts';
import { Button, Collapse, PasswordInput, SegmentedControl, Spinner, TextInput } from '@piwin/ui-kit';

export type PluginYoursPaneProps = {
  plugins: InstalledPlugin[];
  bundled: BundledPluginSummary[];
  isChinese: boolean;
  emptyFilter: boolean;
  installKind: 'local' | 'git' | 'registry';
  installPath: string;
  installGitUrl: string;
  installRegistryId: string;
  installSecrets: string;
  installing: boolean;
  installOpen: boolean;
  registryOpen: boolean;
  registryLoading: boolean;
  registry: PluginRegistryIndex | null;
  onInstallKind: (value: 'local' | 'git' | 'registry') => void;
  onInstallPath: (value: string) => void;
  onInstallGitUrl: (value: string) => void;
  onInstallRegistryId: (value: string) => void;
  onInstallSecrets: (value: string) => void;
  onInstallOpen: (open: boolean) => void;
  onRegistryOpen: (open: boolean) => void;
  onUninstall: (plugin: InstalledPlugin) => void;
  bundledSecrets: Record<string, string>;
  onBundledSecret: (pluginId: string, secretName: string, value: string) => void;
  onInstallBundled: (bundledId: string) => void;
  onInstallLocal: () => void;
  onInstallGit: () => void;
  onInstallRegistry: () => void;
  onPickRegistry: (id: string) => void;
};

function pluginCounts(
  plugin: InstalledPlugin,
  isChinese: boolean,
): string {
  return `${isChinese ? '技能' : 'skills'}: ${plugin.skills.length} · MCP: ${plugin.mcpServerIds.length} · ${isChinese ? '密钥' : 'secrets'}: ${plugin.secrets.length}`;
}

export function PluginYoursPane(props: PluginYoursPaneProps) {
  const installedById = new Map(props.plugins.map((plugin) => [plugin.id, plugin]));
  const bundledIds = new Set(props.bundled.map((entry) => entry.id));
  const userPlugins = props.plugins.filter((plugin) => !bundledIds.has(plugin.id));
  const nothingVisible = props.bundled.length === 0 && userPlugins.length === 0;

  return (
    <>
      {props.bundled.length > 0 ? (
        <section data-testid="plugins-bundled">
          <h3 className="muted ext-list-group-title">
            {props.isChinese ? '应用内置' : 'Bundled'}
          </h3>
          <ul className="ext-list">
            {props.bundled.map((entry) => {
              const installed = installedById.get(entry.id);
              const secretNames = entry.secretNames ?? [];
              return (
                <li key={entry.id} className="ext-list-item">
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{entry.name}</strong>
                      <span className="pill muted">v{entry.version}</span>
                      <span className="pill muted">
                        {pluginSourceKindLabel('bundled', props.isChinese ? 'zh-CN' : 'en')}
                      </span>
                    </div>
                    <div className="muted ext-desc">
                      {installed
                        ? pluginCounts(installed, props.isChinese)
                        : entry.description ?? entry.name}
                    </div>
                    {!installed && secretNames.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {secretNames.map((secretName) => (
                          <PasswordInput
                            key={secretName}
                            value={props.bundledSecrets[`${entry.id}:${secretName}`] ?? ''}
                            onChange={(event) =>
                              props.onBundledSecret(entry.id, secretName, event.currentTarget.value)
                            }
                            placeholder={secretName}
                            aria-label={secretName}
                            testId={`plugin-secret-${entry.id}-${secretName}`}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {installed ? (
                    <Button
                      size="compact"
                      variant="danger"
                      onClick={() => props.onUninstall(installed)}
                      data-testid={`plugin-uninstall-${entry.id}`}
                    >
                      {props.isChinese ? '卸载' : 'Uninstall'}
                    </Button>
                  ) : (
                    <Button
                      size="compact"
                      variant="primary"
                      disabled={
                        props.installing ||
                        secretNames.some(
                          (secretName) =>
                            !(props.bundledSecrets[`${entry.id}:${secretName}`] ?? '').trim(),
                        )
                      }
                      onClick={() => props.onInstallBundled(entry.id)}
                      data-testid={`plugin-install-bundled-${entry.id}`}
                    >
                      {props.isChinese ? '安装' : 'Install'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {nothingVisible ? (
        <p className="plugin-market-empty">
          {props.emptyFilter
            ? props.isChinese
              ? '没有匹配的插件'
              : 'No matching plugins'
            : props.isChinese
              ? '还没有安装插件'
              : 'No plugins installed'}
        </p>
      ) : userPlugins.length > 0 ? (
        <ul className="ext-list" data-testid="plugins-list">
          {userPlugins.map((plugin) => (
            <li key={plugin.id} className="ext-list-item">
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{plugin.name}</strong>
                  <span className="pill muted">v{plugin.version}</span>
                  <span className="pill muted">
                    {pluginSourceKindLabel(plugin.source.kind, props.isChinese ? 'zh-CN' : 'en')}
                  </span>
                </div>
                <div className="muted ext-desc">{pluginCounts(plugin, props.isChinese)}</div>
              </div>
              <Button
                size="compact"
                variant="danger"
                onClick={() => props.onUninstall(plugin)}
                data-testid={`plugin-uninstall-${plugin.id}`}
              >
                {props.isChinese ? '卸载' : 'Uninstall'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className="settings-section"
        style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}
      >
        <button
          type="button"
          className="settings-collapsible-trigger"
          onClick={() => props.onInstallOpen(!props.installOpen)}
          aria-expanded={props.installOpen}
          data-testid="plugins-install-toggle"
        >
          <div className="settings-card-heading" style={{ flex: 1 }}>
            <h4>{props.isChinese ? '从本地 / Git 安装' : 'Install from local / Git'}</h4>
          </div>
        </button>
        <Collapse expanded={props.installOpen}>
          <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SegmentedControl
              value={props.installKind}
              onChange={(value) => props.onInstallKind(value as 'local' | 'git' | 'registry')}
              data={[
                { value: 'local', label: props.isChinese ? '本地' : 'Local' },
                { value: 'git', label: 'Git' },
                { value: 'registry', label: 'Registry' },
              ]}
            />
            {props.installKind === 'local' ? (
              <TextInput
                value={props.installPath}
                onChange={(event) => props.onInstallPath(event.currentTarget.value)}
                placeholder={props.isChinese ? '本地插件目录路径' : 'Local plugin directory path'}
                data-testid="plugin-install-local-path"
              />
            ) : null}
            {props.installKind === 'git' ? (
              <TextInput
                value={props.installGitUrl}
                onChange={(event) => props.onInstallGitUrl(event.currentTarget.value)}
                placeholder="Git URL (https://github.com/...)"
                data-testid="plugin-install-git-url"
              />
            ) : null}
            {props.installKind === 'registry' ? (
              <TextInput
                value={props.installRegistryId}
                onChange={(event) => props.onInstallRegistryId(event.currentTarget.value)}
                placeholder={props.isChinese ? 'Registry 插件 ID' : 'Registry plugin id'}
                data-testid="plugin-install-registry-id"
              />
            ) : null}
            <TextInput
              value={props.installSecrets}
              onChange={(event) => props.onInstallSecrets(event.currentTarget.value)}
              placeholder={
                props.isChinese
                  ? '密钥 (KEY=value, 逗号分隔，可选)'
                  : 'Secrets (KEY=value, comma-separated, optional)'
              }
              data-testid="plugin-install-secrets"
            />
            <Button
              size="compact"
              variant="primary"
              disabled={props.installing}
              onClick={() => {
                if (props.installKind === 'local') props.onInstallLocal();
                else if (props.installKind === 'git') props.onInstallGit();
                else props.onInstallRegistry();
              }}
              data-testid="plugin-install-confirm"
            >
              {props.installing
                ? props.isChinese
                  ? '安装中…'
                  : 'Installing…'
                : props.isChinese
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
          onClick={() => props.onRegistryOpen(!props.registryOpen)}
          aria-expanded={props.registryOpen}
          data-testid="plugins-registry-toggle"
        >
          <div className="settings-card-heading" style={{ flex: 1 }}>
            <h4>{props.isChinese ? 'Registry 浏览' : 'Registry browser'}</h4>
          </div>
        </button>
        <Collapse expanded={props.registryOpen}>
          <div style={{ paddingTop: 16 }}>
            {props.registryLoading ? (
              <div style={{ padding: '16px', textAlign: 'center' }} data-testid="plugins-registry-spinner">
                <Spinner />
              </div>
            ) : props.registry ? (
              props.registry.plugins.length === 0 ? (
                <p className="muted" style={{ fontSize: '13px' }}>
                  {props.isChinese ? 'Registry 为空' : 'Registry is empty'}
                </p>
              ) : (
                <ul className="ext-list" data-testid="plugins-registry-list">
                  {props.registry.plugins.map((entry) => (
                    <li key={entry.id} className="ext-list-item">
                      <div className="ext-list-main">
                        <div className="ext-list-title">
                          <strong>{entry.name}</strong>
                          <span className="pill muted">v{entry.version}</span>
                        </div>
                        {entry.description ? (
                          <div className="muted ext-desc">{entry.description}</div>
                        ) : null}
                      </div>
                      <Button
                        size="compact"
                        variant="ghost"
                        onClick={() => props.onPickRegistry(entry.id)}
                        data-testid={`plugin-registry-install-${entry.id}`}
                      >
                        {props.isChinese ? '安装' : 'Install'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </Collapse>
      </div>
    </>
  );
}
