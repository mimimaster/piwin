import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExtensionSummary,
  ExtensionsEnsureBundledData,
  ExtensionsInstallData,
  ExtensionsListData,
  HostResponse,
  InstallSource,
} from '@piwin/contracts';
import { Button, Field, Notice, IconButton, Spinner } from '@piwin/ui-kit';
import { IconRefresh } from './shell-icons';
import { useDesktopLocale } from './desktop-locale-context';

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

/**
 * Desktop manager for Pi Extensions under ~/.piwin/extensions.
 * Listing never executes modules; Pi loads them at session create (ADR 0010).
 */
export function ExtensionsPanel(props: ExtensionsPanelProps) {
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ensuring, setEnsuring] = useState(false);
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
    setBusyId(extension.id);
    setError(null);
    const response = await props.request({
      type: 'extensions/set_enabled',
      extensionId: extension.id,
      enabled: !extension.enabled,
    });
    setBusyId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadExtensions();
  }

  async function handleEnsureBundled(): Promise<void> {
    setEnsuring(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'extensions/ensure-bundled' });
    setEnsuring(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as ExtensionsEnsureBundledData;
    if (data.installed.length === 0) {
      setInfo(
        isChinese
          ? '内置扩展已存在（或未附带任何内置扩展）。'
          : 'Bundled extensions already present (or none shipped).',
      );
    } else {
      setInfo(
        isChinese
          ? `已安装内置扩展：${data.installed.join(', ')}`
          : `Installed bundled: ${data.installed.join(', ')}`,
      );
    }
    await loadExtensions();
  }


  async function handleInstall(): Promise<void> {
    setError(null);
    setInfo(null);
    let source: InstallSource;
    if (installKind === 'local') {
      const path = installPath.trim();
      if (!path) {
        setError(
          isChinese
            ? '请填写本地 .ts 文件或包目录路径。'
            : 'Local path to .ts file or package directory is required.',
        );
        return;
      }
      source = { kind: 'local', path };
    } else {
      const url = installGitUrl.trim();
      if (!url) {
        setError(isChinese ? '请填写 Git URL。' : 'Git URL is required.');
        return;
      }
      source = { kind: 'git', url };
    }
    setInstalling(true);
    const command: {
      type: 'extensions/install';
      source: InstallSource;
      name?: string;
    } = { type: 'extensions/install', source };
    if (installName.trim()) {
      command.name = installName.trim();
    }
    const response = await props.request(command);
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as ExtensionsInstallData;
    setInfo(
      isChinese
        ? `已安装 ${data.extensionId} → ${data.targetPath}`
        : `Installed ${data.extensionId} → ${data.targetPath}`,
    );
    setInstallPath('');
    setInstallGitUrl('');
    setInstallName('');
    await loadExtensions();
  }

  return (
    <div
      className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}
      data-testid="extensions-panel"
    >
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>{isChinese ? '扩展' : 'Extensions'}</h3>
        <p className="muted">
          {isChinese ? (
            <>
              Pi TypeScript 模块位于 <code>~/.piwin/extensions</code>。启用/停用对<strong>新会话</strong>
              生效。列表不会执行代码 — 会话启动时由 Pi 加载已启用模块。
            </>
          ) : (
            <>
              Pi TypeScript modules under <code>~/.piwin/extensions</code>. Enable/disable applies to{' '}
              <strong>new sessions</strong>. Listing does not execute code — Pi loads enabled modules
              when a session starts.
            </>
          )}
        </p>
        <Notice
          tone="warning"
          testId="extensions-security-banner"
          title={isChinese ? '安全' : 'Security'}
        >
          {isChinese
            ? '已启用的扩展拥有与 Pi 相同的完整进程权限。请只安装你信任的模块。'
            : 'Enabled extensions run with full process privileges (same as Pi). Only install modules you trust.'}
        </Notice>
        <Field label={isChinese ? '搜索扩展' : 'Search extensions'}>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={isChinese ? '名称、ID 或描述…' : 'Name, id, or description…'}
            data-testid="extensions-filter"
          />
        </Field>
        {loading ? (
          <div className="panel-loading">
            <Spinner label={isChinese ? '正在加载扩展' : 'Loading extensions'} />
            <span className="muted">{common.loading}</span>
          </div>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}
        <ul className="ext-list" data-testid="extensions-list">
          {visible.length === 0 && !loading ? (
            <li className="muted" data-testid="extensions-empty">
              {isChinese
                ? '未找到扩展 — 可安装内置 path-guard，或将 .ts 文件放入 ~/.piwin/extensions'
                : 'No extensions found — install bundled path-guard or drop a .ts file into ~/.piwin/extensions'}
            </li>
          ) : (
            visible.map((extension) => (
              <li
                key={extension.id}
                className="ext-list-item"
                data-testid="extension-item"
                data-extension-id={extension.id}
              >
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{extension.name}</strong>
                    <span className="pill">{extension.source}</span>
                    <span className="pill">{extension.enabled ? 'on' : 'off'}</span>
                  </div>
                  <div className="muted ext-desc">{extension.description}</div>
                  <div className="muted ext-path">{extension.path}</div>
                </div>
                <Button
                  data-testid="extension-toggle-btn"
                  disabled={busyId === extension.id}
                  onClick={() => void handleToggle(extension)}
                >
                  {extension.enabled ? common.disable : common.enable}
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="settings-section">
          <h4>{isChinese ? '内置种子' : 'Bundled seed'}</h4>
          <p className="muted">
            {isChinese ? (
              <>
                <code>path-guard</code> 会阻止写入类似密钥文件名（.env、keys）。不会覆盖已有副本。
              </>
            ) : (
              <>
                <code>path-guard</code> blocks write/edit to secret-like basenames (.env, keys). Does not
                overwrite an existing copy.
              </>
            )}
          </p>
          <Button
            variant="primary"
            data-testid="extensions-ensure-bundled-btn"
            disabled={ensuring}
            onClick={() => void handleEnsureBundled()}
          >
            {ensuring
              ? isChinese
                ? '安装中…'
                : 'Installing…'
              : isChinese
                ? '安装内置扩展'
                : 'Install bundled extensions'}
          </Button>
        </div>


        <div className="settings-section">
          <h4>{isChinese ? '安装扩展' : 'Install extension'}</h4>
          <Field label={isChinese ? '来源' : 'Source'}>
            <select
              value={installKind}
              onChange={(event) => setInstallKind(event.target.value as 'local' | 'git')}
            >
              <option value="local">
                {isChinese ? '本地 .ts 文件或包目录' : 'Local .ts file or package dir'}
              </option>
              <option value="git">Git URL</option>
            </select>
          </Field>
          {installKind === 'local' ? (
            <Field label={isChinese ? '路径' : 'Path'} required>
              <input
                value={installPath}
                onChange={(event) => setInstallPath(event.target.value)}
                placeholder="/path/to/my-extension.ts"
                data-testid="extensions-install-path"
              />
            </Field>
          ) : (
            <Field label="Git URL" required>
              <input
                value={installGitUrl}
                onChange={(event) => setInstallGitUrl(event.target.value)}
                placeholder="https://github.com/org/repo.git"
              />
            </Field>
          )}
          <Field
            label={isChinese ? '名称覆盖' : 'Name override'}
            description={isChinese ? '可选的文件夹或文件基名' : 'Optional folder or file basename'}
          >
            <input
              value={installName}
              onChange={(event) => setInstallName(event.target.value)}
              placeholder={isChinese ? '文件夹或文件基名' : 'folder or file basename'}
            />
          </Field>
          <Button
            variant="primary"
            data-testid="extensions-install-btn"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? (isChinese ? '安装中…' : 'Installing…') : common.install}
          </Button>
        </div>
        <div className="manager-actions">
          <IconButton
            label={isChinese ? '刷新扩展' : 'Refresh extensions'}
            data-testid="extensions-refresh-btn"
            onClick={() => void loadExtensions()}
          >
            <IconRefresh />
          </IconButton>
          {props.variant !== 'inline' ? (
            <Button
              data-testid="extensions-close-btn"
              onClick={props.onClose}
            >
              {common.close}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
