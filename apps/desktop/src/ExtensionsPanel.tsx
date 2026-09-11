import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExtensionCompatibilityTier,
  ExtensionSummary,
  ExtensionsInstallData,
  ExtensionsListData,
  HostResponse,
  InstallSource,
} from '@piwin/contracts';
import { isExtensionBlueprintEligible } from '@piwin/contracts';
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
import {
  extensionEnabledEffectMessage,
  extensionInstalledEffectMessage,
  extensionSyncedAndApplyRequestedMessage,
} from './settings-effect-copy.js';
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

type FriendlyError = { title: string; hint: string; raw: string };

/**
 * Map a raw install failure onto a short title + next step. The host already
 * strips temp paths from git errors; here we add localized framing and keep the
 * raw string available behind a disclosure for anyone debugging.
 */
function describeInstallError(raw: string, isChinese: boolean): FriendlyError {
  const text = raw.replace(/^git extension install failed:\s*/i, '').trim();
  const has = (pattern: RegExp) => pattern.test(text);

  if (has(/pi install npm:/i)) {
    return {
      title: isChinese ? '这是 npm 包，不能从 Git 直接安装' : 'This is an npm package',
      hint: isChinese
        ? '该扩展需要 npm 安装步骤，不能从 Git 地址直接暂存。若它只给 Agent 加工具或钩子，可在终端运行提示的 pi install npm:…，然后回到此页点「刷新」。若它依赖 Pi 终端界面（自定义 UI、主题、快捷键），piwin 不支持。'
        : 'This package needs an npm install step, so it cannot be staged from a Git URL. If it only adds Agent tools or hooks, run the suggested `pi install npm:…` command, then Refresh this page. Pi TUI plugins (custom UI, themes, keybindings) do not work in piwin.',
      raw,
    };
  }
  if (has(/no index\.ts entry point|must contain index\.ts/i)) {
    return {
      title: isChinese ? '仓库里没有找到扩展入口' : 'No extension entry point found',
      hint: isChinese
        ? '该仓库根目录没有 index.ts。如果扩展在子文件夹里，请在下方填写子目录（例如 extensions）。仅以 npm 包形式发布的扩展无法通过 Git 地址安装。'
        : 'This repository has no index.ts at its root. If the extension lives in a subfolder, set the subdirectory below (e.g. "extensions"). Extensions published only as npm packages cannot be installed from a Git URL.',
      raw,
    };
  }
  if (has(/\.ts module|must be a \.ts module/i)) {
    return {
      title: isChinese ? '入口文件必须是 .ts 模块' : 'Entry point must be a .ts module',
      hint: isChinese
        ? '把子目录指向扩展的 .ts 文件或它所在的包目录。'
        : 'Point the subdirectory at the extension .ts file or its package folder.',
      raw,
    };
  }
  if (has(/could not clone|not found|repository .* does not exist|authentication failed/i)) {
    return {
      title: isChinese ? '无法克隆该仓库' : 'Could not clone the repository',
      hint: isChinese
        ? '请确认地址正确，并且仓库是公开的。私有仓库需要先在本地克隆，再用「本地」方式安装。'
        : 'Check that the URL is correct and the repository is public. For private repos, clone locally first and install with the "Local" option.',
      raw,
    };
  }
  if (has(/timed out|ETIMEDOUT/i)) {
    return {
      title: isChinese ? '克隆超时' : 'Clone timed out',
      hint: isChinese ? '请检查网络连接后重试。' : 'Check your network connection and try again.',
      raw,
    };
  }
  if (has(/symbolic link/i)) {
    return {
      title: isChinese ? '扩展来源包含符号链接' : 'Extension source contains symlinks',
      hint: isChinese
        ? '出于安全考虑，扩展来源不能包含符号链接。'
        : 'For safety, extension sources may not contain symbolic links.',
      raw,
    };
  }
  return {
    title: isChinese ? '安装失败' : 'Install failed',
    hint: text,
    raw,
  };
}

/**
 * Indeterminate progress while an install request is in flight. There is no
 * progress stream from the host, so we advance staged copy on a timer to signal
 * that the (potentially slow) git clone is still working.
 */
function InstallProgress(props: { isChinese: boolean; kind: 'local' | 'git' }) {
  const stages = useMemo(() => {
    if (props.kind === 'git') {
      return props.isChinese
        ? ['正在克隆仓库…', '正在检查扩展结构…', '正在暂存文件…']
        : ['Cloning repository…', 'Inspecting extension…', 'Staging files…'];
    }
    return props.isChinese
      ? ['正在读取模块…', '正在暂存文件…']
      : ['Reading module…', 'Staging files…'];
  }, [props.isChinese, props.kind]);

  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    setStageIndex(0);
    const timer = setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, stages.length - 1));
    }, 1800);
    return () => clearInterval(timer);
  }, [stages]);

  return (
    <div
      className="ext-install-progress"
      role="status"
      aria-live="polite"
      data-testid="extensions-install-progress"
    >
      <div className="ext-install-progress-track">
        <span className="ext-install-progress-bar" />
      </div>
      <div className="ext-install-progress-label">
        <Spinner testId="extensions-install-spinner" />
        <span>{stages[stageIndex]}</span>
      </div>
    </div>
  );
}

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
  const [installGitSubdir, setInstallGitSubdir] = useState('');
  const [installGitRef, setInstallGitRef] = useState('');
  const [installName, setInstallName] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);

  const requestExtensions = props.request;
  const projectPath = props.projectPath;
  const loadRequestSequenceRef = useRef(0);

  const loadExtensions = useCallback(
    async (applyToSession = false) => {
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
      if (!applyToSession || !props.sessionId) {
        return;
      }
      const applyResponse = await requestExtensions({
        type: 'extensions/apply',
        sessionId: props.sessionId,
        when: 'after-current-run',
      });
      if (requestSequence !== loadRequestSequenceRef.current) {
        return;
      }
      if (!applyResponse.success) {
        setError(applyResponse.error);
        return;
      }
      setInfo(extensionSyncedAndApplyRequestedMessage(locale));
    },
    [locale, projectPath, props.sessionId, requestExtensions],
  );

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
    setInfo(extensionEnabledEffectMessage(locale, extension.name, false));
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
      setInfo(extensionEnabledEffectMessage(locale, extension.name, true));
    }
  }

  async function runInstall(source: InstallSource): Promise<void> {
    setInstalling(true);
    setInstallError(null);
    setError(null);
    const trimmedName = installName.trim();
    try {
      const response = await props.request({
        type: 'extensions/install',
        source,
        ...(trimmedName ? { name: trimmedName } : {}),
      });
      if (!response.success) {
        setInstallError(response.error);
        return;
      }
      const data = response.data as ExtensionsInstallData;
      setInfo(extensionInstalledEffectMessage(locale, data.targetPath));
      setInstallPath('');
      setInstallGitUrl('');
      setInstallGitSubdir('');
      setInstallGitRef('');
      setInstallName('');
      void loadExtensions();
    } finally {
      setInstalling(false);
    }
  }

  function handleInstallLocal() {
    const path = installPath.trim();
    if (!path) return;
    void runInstall({ kind: 'local', path });
  }

  function handleInstallGit() {
    const url = installGitUrl.trim();
    if (!url) return;
    const subdir = installGitSubdir.trim();
    const ref = installGitRef.trim();
    void runInstall({
      kind: 'git',
      url,
      ...(subdir ? { subdir } : {}),
      ...(ref ? { ref } : {}),
    });
  }

  function submitInstall() {
    installKind === 'local' ? handleInstallLocal() : handleInstallGit();
  }

  const friendlyInstallError = installError ? describeInstallError(installError, isChinese) : null;
  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
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
            onClick={() => void loadExtensions(true)}
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
                    {compatibilityLabel(extension.compatibility?.tier, isChinese) ? (
                      <span
                        className="pill muted"
                        data-testid={`extension-compat-${extension.id}`}
                      >
                        {compatibilityLabel(extension.compatibility?.tier, isChinese)}
                      </span>
                    ) : null}
                    {extension.enabled ? (
                      <span className="pill ok">{isChinese ? '已启用' : 'on'}</span>
                    ) : null}
                  </div>
                  <div className="muted ext-desc">{extension.description}</div>
                </div>
                <Switch
                  checked={extension.enabled}
                  disabled={
                    props.readOnly ||
                    (extension.compatibility !== undefined &&
                      !isExtensionBlueprintEligible(extension.compatibility))
                  }
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
            <div className="ext-install-form">
              <div className="settings-toolbar settings-toolbar--install" style={{ marginTop: 16 }}>
                <SegmentedControl
                  value={installKind}
                  onChange={(value) => {
                    setInstallKind(value as 'local' | 'git');
                    setInstallError(null);
                  }}
                  data={[
                    { value: 'local', label: isChinese ? '本地' : 'Local' },
                    { value: 'git', label: 'Git' },
                  ]}
                  className="settings-install-kind"
                />
                <TextInput
                  toolbar
                  disabled={installing}
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
                    if (event.key === 'Enter' && !installing) {
                      event.preventDefault();
                      submitInstall();
                    }
                  }}
                />
                <Button
                  disabled={
                    installing ||
                    props.readOnly ||
                    (installKind === 'local' ? !installPath.trim() : !installGitUrl.trim())
                  }
                  onClick={submitInstall}
                  data-testid="extensions-install-submit"
                >
                  {installing ? (
                    <span className="ext-install-btn-busy">
                      <Spinner />
                      {isChinese ? '安装中…' : 'Installing…'}
                    </span>
                  ) : isChinese ? (
                    '安装'
                  ) : (
                    'Install'
                  )}
                </Button>
              </div>

              {installKind === 'git' ? (
                <div className="ext-install-git-extra">
                  <TextInput
                    toolbar
                    disabled={installing}
                    value={installGitSubdir}
                    onChange={(event) => setInstallGitSubdir(event.currentTarget.value)}
                    placeholder={
                      isChinese
                        ? '子目录（可选，如 extensions）'
                        : 'Subdirectory (optional, e.g. extensions)'
                    }
                    aria-label={isChinese ? '子目录' : 'Subdirectory'}
                    data-testid="extensions-install-subdir"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !installing) {
                        event.preventDefault();
                        submitInstall();
                      }
                    }}
                  />
                  <TextInput
                    toolbar
                    disabled={installing}
                    value={installGitRef}
                    onChange={(event) => setInstallGitRef(event.currentTarget.value)}
                    placeholder={isChinese ? '分支 / 标签（可选）' : 'Branch / tag (optional)'}
                    aria-label={isChinese ? '分支或标签' : 'Branch or tag'}
                    data-testid="extensions-install-ref"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !installing) {
                        event.preventDefault();
                        submitInstall();
                      }
                    }}
                  />
                </div>
              ) : null}

              {installing ? <InstallProgress isChinese={isChinese} kind={installKind} /> : null}

              {friendlyInstallError ? (
                <Notice
                  tone="error"
                  testId="extensions-install-error"
                  title={friendlyInstallError.title}
                  action={
                    <button
                      type="button"
                      className="ext-install-error-dismiss"
                      onClick={() => setInstallError(null)}
                      aria-label={isChinese ? '关闭' : 'Dismiss'}
                      data-testid="extensions-install-error-dismiss"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  }
                  details={
                    friendlyInstallError.hint !== friendlyInstallError.raw ? (
                      <details className="ext-install-error-raw">
                        <summary>{isChinese ? '技术细节' : 'Technical details'}</summary>
                        <code>{friendlyInstallError.raw}</code>
                      </details>
                    ) : null
                  }
                >
                  {friendlyInstallError.hint}
                </Notice>
              ) : null}
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  );
}

function compatibilityLabel(
  tier: ExtensionCompatibilityTier | undefined,
  isChinese: boolean,
): string | null {
  switch (tier) {
    case 'compatible':
      return isChinese ? '可用' : 'compatible';
    case 'degraded':
    case 'incompatible':
      return isChinese ? '仅 Pi 终端' : 'Pi TUI only';
    case 'unverified':
      return isChinese ? '未验证' : 'unverified';
    default:
      return null;
  }
}
