import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, ThemeManifest, ThemeSummary } from '@piwin/contracts';
import { Button, Collapse, Notice, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type ThemePanelProps = {
  request: (command: {
    type: 'theme/list' | 'theme/get-active' | 'theme/set-active' | 'theme/install-local';
    themeId?: string;
    sourcePath?: string;
  }) => Promise<HostResponse>;
  onApplied: (theme: ThemeManifest) => void;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function ThemePanel(props: ThemePanelProps) {
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [activeId, setActiveId] = useState('piwin-dark');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [installPath, setInstallPath] = useState('');
  const [installOpen, setInstallOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    const listed = await props.request({ type: 'theme/list' });
    if (!listed.success) {
      setError(listed.error);
      return;
    }
    const data = listed.data as { themes: ThemeSummary[]; activeThemeId: string };
    setThemes(data.themes);
    setActiveId(data.activeThemeId);
  }, [props]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleActivate(themeId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'theme/set-active', themeId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const theme = (response.data as { theme: ThemeManifest }).theme;
    props.onApplied(theme);
    setInfo(isChinese ? `当前主题：${theme.name}` : `Active theme: ${theme.name}`);
    await reload();
  }

  async function handleInstall(): Promise<void> {
    const sourcePath = installPath.trim();
    if (!sourcePath) {
      setError(
        isChinese
          ? '请提供包含 theme.json 的本地目录。'
          : 'Provide a local directory containing theme.json.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'theme/install-local', sourcePath });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { themeId: string; path: string };
    setInfo(isChinese ? `已安装 ${data.themeId}` : `Installed ${data.themeId}`);
    setInstallPath('');
    await reload();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
        <div className="theme-panel-header">
          <div>
            <h3>{isChinese ? '主题' : 'Themes'}</h3>
            <p className="muted">
              {isChinese ? (
                <>
                  主题包仅包含 token（颜色、圆角、字体），不执行 CSS 或 JavaScript，存储于
                  ~/.piwin/themes。
                </>
              ) : (
                <>
                  Token packages only (colors/radius/font). No executable CSS/JS. Stored under
                  ~/.piwin/themes.
                </>
              )}
            </p>
          </div>
          <div
            className="theme-panel-actions"
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <Button
              size="compact"
              variant="ghost"
              onClick={() => void reload()}
              data-testid="theme-refresh"
            >
              {common.refresh}
            </Button>
            {props.variant !== 'inline' ? (
              <Button
                size="compact"
                variant="ghost"
                onClick={props.onClose}
                data-testid="theme-close"
              >
                {common.close}
              </Button>
            ) : null}
          </div>
        </div>

        {error || info ? (
          <div className="ui-feedback-host" aria-live="polite">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {info ? <Notice tone="info">{info}</Notice> : null}
          </div>
        ) : null}

        <ul className="ext-list" data-testid="theme-list">
          {themes.map((theme) => (
            <li key={theme.id} className="ext-list-item">
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{theme.name}</strong>
                  <span className="pill">{theme.mode}</span>
                  <span className="pill">{theme.source}</span>
                  {theme.active || theme.id === activeId ? (
                    <span className="pill ok">{isChinese ? '当前' : 'active'}</span>
                  ) : null}
                </div>
                <div className="muted ext-path">
                  {theme.id} · v{theme.version}
                </div>
              </div>
              <Button
                data-testid={`theme-apply-${theme.id}`}
                disabled={busy || theme.id === activeId}
                onClick={() => void handleActivate(theme.id)}
              >
                {common.apply}
              </Button>
            </li>
          ))}
        </ul>

        <div
          className="settings-section"
          data-testid="theme-install-section"
          style={{ paddingTop: 8 }}
        >
          <button
            type="button"
            className="settings-collapsible-trigger"
            onClick={() => setInstallOpen((v) => !v)}
            aria-expanded={installOpen}
            data-testid="theme-install-toggle"
          >
            <div className="settings-card-heading" style={{ marginBottom: 0 }}>
              <div>
                <h4>{isChinese ? '安装本地主题' : 'Install local theme'}</h4>
                <p>
                  {isChinese
                    ? '展开后输入包含 theme.json 的目录绝对路径。'
                    : 'Expand and enter the absolute path to a directory containing theme.json.'}
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

          <Collapse expanded={installOpen} testId="theme-install-collapse">
            <div className="theme-install-inline">
              <TextInput
                value={installPath}
                onChange={(event) => setInstallPath(event.currentTarget.value)}
                placeholder="/path/to/my-theme"
                data-testid="theme-install-path"
                style={{ flex: 1 }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleInstall();
                  }
                }}
              />
              <Button
                disabled={busy}
                onClick={() => void handleInstall()}
                data-testid="theme-install-submit"
              >
                {common.install}
              </Button>
            </div>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: '12.5px' }}>
              {isChinese
                ? '包含 theme.json 的目录绝对路径。'
                : 'Absolute path to a directory containing theme.json.'}
            </p>
          </Collapse>
        </div>
      </div>
    </div>
  );
}
