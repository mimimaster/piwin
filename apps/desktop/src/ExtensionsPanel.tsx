import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExtensionSummary,
  ExtensionsEnsureBundledData,
  ExtensionsInstallData,
  ExtensionsListData,
  HostResponse,
  InstallSource,
} from '@piwin/contracts';
import { IconButton } from '@piwin/ui-kit';
import { IconRefresh } from './shell-icons';

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
      setInfo('Bundled extensions already present (or none shipped).');
    } else {
      setInfo(`Installed bundled: ${data.installed.join(', ')}`);
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
        setError('Local path to .ts file or package directory is required');
        return;
      }
      source = { kind: 'local', path };
    } else {
      const url = installGitUrl.trim();
      if (!url) {
        setError('Git URL is required');
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
    setInfo(`Installed ${data.extensionId} → ${data.targetPath}`);
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
        <h3>Extensions</h3>
        <p className="muted">
          Pi TypeScript modules under <code>~/.piwin/extensions</code>. Enable/disable applies to{' '}
          <strong>new sessions</strong>. Listing does not execute code — Pi loads enabled modules
          when a session starts.
        </p>
        <div className="error-banner" data-testid="extensions-security-banner" role="note">
          Security: enabled extensions run with full process privileges (same as Pi). Only install
          modules you trust.
        </div>
        <input
          className="text-input"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search extensions…"
          aria-label="Search extensions"
          data-testid="extensions-filter"
        />
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <p className="muted">{info}</p> : null}
        <ul className="ext-list" data-testid="extensions-list">
          {visible.length === 0 && !loading ? (
            <li className="muted" data-testid="extensions-empty">
              No extensions found — install bundled path-guard or drop a .ts file into
              ~/.piwin/extensions
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
                <button
                  type="button"
                  className="btn"
                  data-testid="extension-toggle-btn"
                  disabled={busyId === extension.id}
                  onClick={() => void handleToggle(extension)}
                >
                  {extension.enabled ? 'Disable' : 'Enable'}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="settings-section">
          <h4>Bundled seed</h4>
          <p className="muted">
            <code>path-guard</code> blocks write/edit to secret-like basenames (.env, keys). Does not
            overwrite an existing copy.
          </p>
          <button
            type="button"
            className="btn primary"
            data-testid="extensions-ensure-bundled-btn"
            disabled={ensuring}
            onClick={() => void handleEnsureBundled()}
          >
            {ensuring ? 'Installing…' : 'Install bundled extensions'}
          </button>
        </div>


        <div className="settings-section">
          <h4>Install extension</h4>
          <label className="field">
            Source
            <select
              value={installKind}
              onChange={(event) => setInstallKind(event.target.value as 'local' | 'git')}
            >
              <option value="local">Local .ts file or package dir</option>
              <option value="git">Git URL</option>
            </select>
          </label>
          {installKind === 'local' ? (
            <label className="field">
              Path
              <input
                value={installPath}
                onChange={(event) => setInstallPath(event.target.value)}
                placeholder="/path/to/my-extension.ts"
                data-testid="extensions-install-path"
              />
            </label>
          ) : (
            <label className="field">
              Git URL
              <input
                value={installGitUrl}
                onChange={(event) => setInstallGitUrl(event.target.value)}
                placeholder="https://github.com/org/repo.git"
              />
            </label>
          )}
          <label className="field">
            Name override (optional)
            <input
              value={installName}
              onChange={(event) => setInstallName(event.target.value)}
              placeholder="folder or file basename"
            />
          </label>
          <button
            type="button"
            className="btn primary"
            data-testid="extensions-install-btn"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
        <div className="manager-actions">
          <IconButton
            label="Refresh extensions"
            data-testid="extensions-refresh-btn"
            onClick={() => void loadExtensions()}
          >
            <IconRefresh />
          </IconButton>
          {props.variant !== 'inline' ? (
            <button
              type="button"
              className="btn"
              data-testid="extensions-close-btn"
              onClick={props.onClose}
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
