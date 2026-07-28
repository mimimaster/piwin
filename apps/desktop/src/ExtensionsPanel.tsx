import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExtensionSummary,
  ExtensionsInstallData,
  ExtensionsListData,
  HostResponse,
  InstallSource,
} from '@piwin/contracts';
import { Button, Field, Notice, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

export type ExtensionsPanelProps = {
  projectPath: string | null;
  request: (command: {
    type:
      | 'extensions/list'
      | 'extensions/set_enabled'
      | 'extensions/ensure-bundled'
      | 'extensions/install';
    projectPath?: string;
    extensionId?: string;
    enabled?: boolean;
    source?: InstallSource;
    name?: string;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function ExtensionsPanel(props: ExtensionsPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installKind, setInstallKind] = useState<'local' | 'git'>('local');
  const [installPath, setInstallPath] = useState('');
  const [installGitUrl, setInstallGitUrl] = useState('');
  const [installName, setInstallName] = useState('');
  const [installing, setInstalling] = useState(false);

  const loadExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);
    const command: { type: 'extensions/list'; projectPath?: string } = {
      type: 'extensions/list',
    };
    if (props.projectPath) {
      command.projectPath = props.projectPath;
    }
    const response = await props.request(command);
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as ExtensionsListData;
    setExtensions(data.extensions ?? []);
  }, [props]);

  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return extensions;
    }
    return extensions.filter(
      (extension) =>
        extension.name.toLowerCase().includes(query) ||
        extension.id.toLowerCase().includes(query) ||
        extension.description.toLowerCase().includes(query) ||
        extension.source.toLowerCase().includes(query),
    );
  }, [extensions, filter]);

  async function handleToggle(extension: ExtensionSummary): Promise<void> {
    setError(null);
    const response = await props.request({
      type: 'extensions/set_enabled',
      extensionId: extension.id,
      enabled: !extension.enabled,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? `已${extension.enabled ? '关闭' : '开启'}扩展：${extension.name}` : `${extension.enabled ? 'Disabled' : 'Enabled'} extension: ${extension.name}`);
    void loadExtensions();
  }

  async function handleInstallLocal() {
    if (!installPath.trim()) return;
    setInstalling(true);
    setError(null);
    const trimmedName = installName.trim();
    const response = await props.request({
      type: 'extensions/install',
      source: { kind: 'local', path: installPath.trim() },
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as ExtensionsInstallData;
    setInfo(isChinese ? `已安装扩展到：${data.targetPath}` : `Installed extension to: ${data.targetPath}`);
    setInstallPath('');
    setInstallName('');
    void loadExtensions();
  }

  async function handleInstallGit() {
    if (!installGitUrl.trim()) return;
    setInstalling(true);
    setError(null);
    const trimmedName = installName.trim();
    const response = await props.request({
      type: 'extensions/install',
      source: { kind: 'git', url: installGitUrl.trim() },
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as ExtensionsInstallData;
    setInfo(isChinese ? `已从 Git 安装扩展到：${data.targetPath}` : `Installed extension from Git to: ${data.targetPath}`);
    setInstallGitUrl('');
    setInstallName('');
    void loadExtensions();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <PageTitle
          title={isChinese ? 'Pi 扩展' : 'Pi Extensions'}
          description={isChinese ? '扩展 Agent 的核心能力，支持本地模块加载。' : 'Extend core agent capabilities with local module loading.'}
        />

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <Field label={isChinese ? '搜索扩展' : 'Search extensions'}>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={isChinese ? '名称、ID 或描述…' : 'Search...'}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)' }}
              />
            </Field>
          </div>
          <Button size="compact" onClick={() => void loadExtensions()}>{isChinese ? '刷新' : 'Refresh'}</Button>
        </div>

        {loading && <div style={{ padding: '20px', textAlign: 'center' }}><Spinner /></div>}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <ul className="ext-list">
          {visible.length === 0 && !loading ? (
            <li className="muted" style={{ textAlign: 'center', padding: '40px' }}>{isChinese ? '未安装任何扩展' : 'No extensions installed'}</li>
          ) : (
            visible.map((extension) => (
              <li key={extension.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{extension.name}</strong>
                    <span className="pill" style={{ opacity: 0.6 }}>{extension.source}</span>
                  </div>
                  <div className="muted ext-desc">{extension.description}</div>
                </div>
                <span
                  role="switch"
                  aria-checked={extension.enabled ? 'true' : 'false'}
                  tabIndex={0}
                  className={extension.enabled ? 'mcp-toggle checked' : 'mcp-toggle'}
                  onClick={() => void handleToggle(extension)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void handleToggle(extension);
                    }
                  }}
                />
              </li>
            ))
          )}
        </ul>

        <div className="settings-section">
          <PageTitle
            title={isChinese ? '手动安装' : 'Install Manually'}
            description={isChinese ? '从本地路径或 Git 仓库安装新的 Pi 扩展。' : 'Install a new Pi extension from a local path or Git repository.'}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <select
                  value={installKind}
                  onChange={(event) => setInstallKind(event.target.value as 'local' | 'git')}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)' }}
                >
                  <option value="local">{isChinese ? '本地目录' : 'Local Directory'}</option>
                  <option value="git">Git URL</option>
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <input
                  value={installKind === 'local' ? installPath : installGitUrl}
                  onChange={(event) => installKind === 'local' ? setInstallPath(event.target.value) : setInstallGitUrl(event.target.value)}
                  placeholder={installKind === 'local' ? (isChinese ? '路径...' : 'Path...') : 'https://github.com/...'}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)' }}
                />
              </div>
              <Button
                disabled={installing || (installKind === 'local' ? !installPath : !installGitUrl)}
                onClick={() => installKind === 'local' ? handleInstallLocal() : handleInstallGit()}
              >
                {isChinese ? '安装' : 'Install'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
