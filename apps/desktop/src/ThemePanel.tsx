import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, ThemeManifest, ThemeSummary } from '@piwin/contracts';
import { applyAppearanceToDocument } from './appearance-tokens';

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
    setInfo(`Active theme: ${theme.name}`);
    await reload();
  }

  async function handleInstall(): Promise<void> {
    const sourcePath = installPath.trim();
    if (!sourcePath) {
      setError('Provide a local directory containing theme.json');
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
    setInfo(`Installed ${data.themeId}`);
    setInstallPath('');
    await reload();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>Themes</h3>
        <p className="muted">
          Token packages only (colors/radius/font). No executable CSS/JS. Stored under
          ~/.piwin/themes.
        </p>
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <p className="muted">{info}</p> : null}

        <ul className="ext-list">
          {themes.map((theme) => (
            <li key={theme.id} className="ext-list-item">
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{theme.name}</strong>
                  <span className="pill">{theme.mode}</span>
                  <span className="pill">{theme.source}</span>
                  {theme.active || theme.id === activeId ? (
                    <span className="pill ok">active</span>
                  ) : null}
                </div>
                <div className="muted ext-path">
                  {theme.id} · v{theme.version}
                </div>
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={busy || theme.id === activeId}
                onClick={() => void handleActivate(theme.id)}
              >
                Apply
              </button>
            </li>
          ))}
        </ul>

        <h4>Install local theme</h4>
        <input
          className="text-input"
          value={installPath}
          onChange={(event) => setInstallPath(event.target.value)}
          placeholder="Absolute path to theme directory (contains theme.json)"
        />
        <button type="button" className="btn" disabled={busy} onClick={() => void handleInstall()}>
          Install
        </button>

        <div className="manager-actions">
          <button type="button" className="btn" onClick={() => void reload()}>
            Refresh
          </button>
          {props.variant !== 'inline' ? <button type="button" className="btn" onClick={props.onClose}>Close</button> : null}
        </div>
      </div>
    </div>
  );
}

/** Apply theme tokens to document root CSS variables (shell + artifact-ready). */
export function applyThemeToDocument(theme: ThemeManifest): void {
  applyAppearanceToDocument(theme);
}
