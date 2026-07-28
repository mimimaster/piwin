import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, ThemeManifest, ThemeSummary } from '@piwin/contracts';
import { Button, Field, Notice } from '@piwin/ui-kit';
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
      setError(isChinese ? '请提供包含 theme.json 的本地目录。' : 'Provide a local directory containing theme.json.');
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
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>{isChinese ? '主题' : 'Themes'}</h3>
        <p className="muted">
          {isChinese
            ? <>主题包仅包含 token（颜色、圆角、字体），不执行 CSS 或 JavaScript，存储于 ~/.piwin/themes。</>
            : <>Token packages only (colors/radius/font). No executable CSS/JS. Stored under ~/.piwin/themes.</>}
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        <ul className="ext-list">
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
                variant="primary"
                data-testid={`theme-apply-${theme.id}`}
                disabled={busy || theme.id === activeId}
                onClick={() => void handleActivate(theme.id)}
              >
                {common.apply}
              </Button>
            </li>
          ))}
        </ul>

        <h4>{isChinese ? '安装本地主题' : 'Install local theme'}</h4>
        <Field
          label={isChinese ? '主题目录' : 'Theme directory'}
          description={isChinese ? '包含 theme.json 的目录绝对路径。' : 'Absolute path to a directory containing theme.json.'}
          required
        >
          <input
            value={installPath}
            onChange={(event) => setInstallPath(event.target.value)}
            placeholder="/path/to/my-theme"
            data-testid="theme-install-path"
          />
        </Field>
        <Button disabled={busy} onClick={() => void handleInstall()}>
          {common.install}
        </Button>

        <div className="manager-actions">
          <Button onClick={() => void reload()}>
            {common.refresh}
          </Button>
          {props.variant !== 'inline' ? <Button onClick={props.onClose}>{common.close}</Button> : null}
        </div>
      </div>
    </div>
  );
}
