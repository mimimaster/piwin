/**
 * Installed plugins list plus advanced local/git/registry install.
 */
import type { InstalledPlugin, PluginRegistryIndex } from '@piwin/contracts';
import { Button, Collapse, SegmentedControl, Spinner, TextInput } from '@piwin/ui-kit';

export type PluginYoursPaneProps = {
  plugins: InstalledPlugin[];
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
  registry: PluginRegistryIndex | null;
  onInstallKind: (value: 'local' | 'git' | 'registry') => void;
  onInstallPath: (value: string) => void;
  onInstallGitUrl: (value: string) => void;
  onInstallRegistryId: (value: string) => void;
  onInstallSecrets: (value: string) => void;
  onInstallOpen: (open: boolean) => void;
  onRegistryOpen: (open: boolean) => void;
  onUninstall: (plugin: InstalledPlugin) => void;
  onInstallLocal: () => void;
  onInstallGit: () => void;
  onInstallRegistry: () => void;
  onPickRegistry: (id: string) => void;
};

export function PluginYoursPane(props: PluginYoursPaneProps) {
  return (
    <>
      {props.plugins.length === 0 ? (
        <p className="plugin-market-empty">
          {props.emptyFilter
            ? props.isChinese
              ? '没有匹配的插件'
              : 'No matching plugins'
            : props.isChinese
              ? '还没有安装插件'
              : 'No plugins installed'}
        </p>
      ) : (
        <ul className="ext-list" data-testid="plugins-list">
          {props.plugins.map((plugin) => (
            <li key={plugin.id} className="ext-list-item">
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{plugin.name}</strong>
                  <span className="pill muted">v{plugin.version}</span>
                  <span className="pill muted">{plugin.source.kind}</span>
                </div>
                <div className="muted ext-desc">
                  {props.isChinese ? '技能' : 'skills'}: {plugin.skills.length} · MCP:{' '}
                  {plugin.mcpServerIds.length} · {props.isChinese ? '密钥' : 'secrets'}:{' '}
                  {plugin.secrets.length}
                </div>
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
      )}

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
            {props.registry ? (
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
            ) : (
              <div style={{ padding: '16px', textAlign: 'center' }}>
                <Spinner />
              </div>
            )}
          </div>
        </Collapse>
      </div>
    </>
  );
}
