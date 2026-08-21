import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExtensionSummary,
  ExtensionsInstallData,
  ExtensionsListData,
  HostResponse,
  InstallSource,
} from '@piwin/contracts';
import {
  Button,
  Collapse,
  Notice,
  SegmentedControl,
  Spinner,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

export type ExtensionsPanelProps = {
  projectPath: string | null;
  sessionId?: string | null;
  request: (command: {
    type:
      | 'extensions/list'
      | 'extensions/set_enabled'
      | 'extensions/apply'
      | 'extensions/ensure-bundled'
      | 'extensions/install';
    projectPath?: string;
    extensionId?: string;
    enabled?: boolean;
    sessionId?: string;
    when?: 'now' | 'after-current-run' | 'new-sessions-only';
    expectedSettingsRevision?: string;
    expectedRegistryRevision?: string;
    deploymentId?: string;
    source?: InstallSource;
    name?: string;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
  readOnly?: boolean;
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
  const [installOpen, setInstallOpen] = useState(false);

  const requestExtensions = props.request;
  const projectPath = props.projectPath;
  const loadRequestSequenceRef = useRef(0);

  const loadExtensions = useCallback(async () => {
    const requestSequence = loadRequestSequenceRef.current + 1;
    loadRequestSequenceRef.current = requestSequence;
    setLoading(true);
    setError(null);
    const command: { type: 'extensions/list'; projectPath?: string } = {
      type: 'extensions/list',
    };
    if (projectPath) {
      command.projectPath = projectPath;
    }
    const response = await requestExtensions(command);
    if (requestSequence !== loadRequestSequenceRef.current) {
      return;
    }
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as ExtensionsListData;
    setExtensions(data.extensions ?? []);
  }, [projectPath, requestExtensions]);

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
    setInfo(
      isChinese
        ? `已${extension.enabled ? '关闭' : '开启'}扩展：${extension.name}`
        : `${extension.enabled ? 'Disabled' : 'Enabled'} extension: ${extension.name}`,
    );
    setExtensions((prev) =>
      prev.map((e) => (e.id === extension.id ? { ...e, enabled: !e.enabled } : e)),
    );
    if (props.sessionId) {
      const applyResponse = await props.request({
        type: 'extensions/apply',
        sessionId: props.sessionId,
        when: 'after-current-run',
      });
      if (!applyResponse.success) {
        setError(applyResponse.error);
        void loadExtensions();
        return;
      }
      setInfo(
        isChinese
          ? `已在当前 Run 结束后应用扩展：${extension.name}`
          : `Extension will apply after the current run: ${extension.name}`,
      );
    }
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
    setInfo(
      isChinese ? `已安装扩展到：${data.targetPath}` : `Installed extension to: ${data.targetPath}`,
    );
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
    setInfo(
      isChinese
        ? `已从 Git 安装扩展到：${data.targetPath}`
        : `Installed extension from Git to: ${data.targetPath}`,
    );
    setInstallGitUrl('');
    setInstallName('');
    void loadExtensions();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
        {props.variant !== 'inline' ? (
          <PageTitle
            title={isChinese ? 'Pi 扩展' : 'Pi Extensions'}
            description={
              isChinese
                ? '扩展 Agent 的核心能力，支持本地模块加载。'
                : 'Extend core agent capabilities with local module loading.'
            }
            trailing={
              <span className="muted" style={{ fontSize: '12.5px' }}>
                {visible.length}/{extensions.length} {isChinese ? '已安装' : 'installed'}
              </span>
            }
          />
        ) : null}

        <div className="settings-toolbar" style={{ marginBottom: 16 }}>
          <TextInput
            toolbar
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder={isChinese ? '搜索扩展…' : 'Search extensions…'}
            data-testid="extensions-filter"
            aria-label={isChinese ? '搜索扩展' : 'Search extensions'}
          />
          <Button
            size="compact"
            variant="ghost"
            onClick={() => void loadExtensions()}
            data-testid="extensions-refresh"
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
                  ? '没有匹配的扩展'
                  : 'No matching extensions'
                : isChinese
                  ? '未安装任何扩展'
                  : 'No extensions installed'}
            </p>
          </div>
        ) : (
          <ul className="ext-list" data-testid="extensions-list">
            {visible.map((extension) => (
              <li key={extension.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{extension.name}</strong>
                    <span className="pill muted">{extension.source}</span>
                    {extension.enabled ? (
                      <span className="pill ok">{isChinese ? '已启用' : 'on'}</span>
                    ) : null}
                  </div>
                  <div className="muted ext-desc">{extension.description}</div>
                </div>
                <Switch
                  checked={extension.enabled}
                  disabled={props.readOnly}
                  onCheckedChange={() => void handleToggle(extension)}
                  aria-label={isChinese ? `启用 ${extension.name}` : `Enable ${extension.name}`}
                  data-testid={`extension-toggle-${extension.id}`}
                />
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
            disabled={props.readOnly}
            onClick={() => setInstallOpen((v) => !v)}
            aria-expanded={installOpen}
            data-testid="extensions-install-toggle"
          >
            <div className="settings-card-heading" style={{ marginBottom: 0 }}>
              <div>
                <h4>{isChinese ? '手动安装' : 'Install Manually'}</h4>
                <p>
                  {isChinese
                    ? '从本地路径或 Git 仓库安装新的 Pi 扩展。'
                    : 'Install a new Pi extension from a local path or Git repository.'}
                </p>
              </div>
            </div>
            <svg
              className={`settings-collapsible-chevron ${installOpen ? 'open' : ''}`}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <Collapse expanded={installOpen} testId="extensions-install-collapse">
            <div className="settings-toolbar settings-toolbar--install" style={{ marginTop: 16 }}>
              <SegmentedControl
                value={installKind}
                onChange={(value) => setInstallKind(value as 'local' | 'git')}
                data={[
                  { value: 'local', label: isChinese ? '本地' : 'Local' },
                  { value: 'git', label: 'Git' },
                ]}
                className="settings-install-kind"
              />
              <TextInput
                toolbar
                value={installKind === 'local' ? installPath : installGitUrl}
                onChange={(event) =>
                  installKind === 'local'
                    ? setInstallPath(event.currentTarget.value)
                    : setInstallGitUrl(event.currentTarget.value)
                }
                placeholder={
                  installKind === 'local'
                    ? isChinese
                      ? '本地路径…'
                      : 'Local path…'
                    : 'https://github.com/…'
                }
                aria-label={
                  installKind === 'local' ? (isChinese ? '本地路径' : 'Local Path') : 'Git URL'
                }
                data-testid="extensions-install-source"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    installKind === 'local' ? handleInstallLocal() : handleInstallGit();
                  }
                }}
              />
              <Button
                disabled={
                  installing ||
                  props.readOnly ||
                  (installKind === 'local' ? !installPath : !installGitUrl)
                }
                onClick={() =>
                  installKind === 'local' ? handleInstallLocal() : handleInstallGit()
                }
                data-testid="extensions-install-submit"
              >
                {isChinese ? '安装' : 'Install'}
              </Button>
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  );
}
