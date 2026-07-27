/**
 * Settings shell: two-layer frame (category nav + single content page).
 * Nav is generated from the section registry; content renders the registered
 * page component — the registry covers every section.
 *
 * Markup intentionally mirrors the previous SettingsPanel layout (same CSS
 * classes and data-testids) — R3 owns any CSS restructuring.
 */
import type { ReactElement, ReactNode } from 'react';
import { getDesktopCopy } from '../desktop-locale';
import { useDesktopLocale } from '../desktop-locale-context';
import {
  SETTINGS_GROUPS,
  getSettingsSection,
  sectionsForGroup,
  type SettingsSectionId,
} from './section-registry';
import { SettingsProvider, type SettingsContextValue } from './settings-context';
// Side effect: registers all migrated page components before first render.
import './pages';

export type SettingsShellProps = {
  activeSection: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  contextValue: SettingsContextValue;
  /** Error/info banners owned by SettingsPanel; rendered above the content. */
  banners?: ReactNode;
};

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { activeSection, onSelectSection, contextValue } = props;
  const { locale, translator } = useDesktopLocale();
  const copy = getDesktopCopy(locale);
  const root = contextValue.root;

  const activeMeta = SETTINGS_GROUPS.flatMap((group) => sectionsForGroup(group.id)).find(
    (section) => section.id === activeSection,
  );
  const PageComponent = getSettingsSection(activeSection);

  return (
    <div className="settings-page" data-testid="settings-panel" aria-label={copy.settings}>
      <aside className="settings-nav">
        <div className="settings-nav-brand">
          <span className="settings-nav-mark" aria-hidden>π</span>
          <span>
            <strong>{copy.settings}</strong>
            <small>piwin Desktop</small>
          </span>
        </div>
        <nav className="settings-nav-list" aria-label={copy.settings}>
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="settings-nav-group">
              <div className="settings-nav-group-label">
                {translator.settings[group.labelKey]}
              </div>
              {sectionsForGroup(group.id).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    activeSection === item.id ? 'settings-nav-item active' : 'settings-nav-item'
                  }
                  onClick={() => onSelectSection(item.id)}
                  aria-current={activeSection === item.id ? 'page' : undefined}
                  data-testid={`settings-nav-${item.id}`}
                >
                  {translator.settings.nav[item.labelKey]}
                  {item.beta ? (
                    <span className="settings-beta-badge" aria-label={copy.betaFeature}>Beta</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-nav-footer">
          <span className="settings-connection-dot" aria-hidden />
          {copy.localConfiguration}
        </div>
      </aside>
      <div className="settings-main">
        <header className="settings-main-header">
          <h2>
            {activeMeta ? translator.settings.nav[activeMeta.labelKey] : copy.settings}
          </h2>
          <p
            className="settings-config-path"
            data-testid="settings-config-root"
            title={`${copy.configurationRoot}: ${root}`}
          >
            {root}
          </p>
        </header>
        {props.banners ?? null}
        <div
          className={`settings-main-content${
            activeSection === 'models'
              ? ' settings-content--models settings-content--models-flush'
              : ''
          }`}
        >
          {PageComponent ? (
            <SettingsProvider value={contextValue}>
              <PageComponent />
            </SettingsProvider>
          ) : null}
        </div>
      </div>
    </div>
  );
}
