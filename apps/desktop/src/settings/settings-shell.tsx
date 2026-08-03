/**
 * Settings shell: two-layer frame (category nav + single content page).
 * Nav is generated from the section registry; content renders the registered
 * page component — the registry covers every section.
 *
 * Markup intentionally mirrors the previous SettingsPanel layout (same CSS
 * classes and data-testids) — R3 owns any CSS restructuring.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconClose } from '../shell-icons';
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

const SECTION_ICONS: Record<SettingsSectionId, ReactNode> = {
  general: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  appearance: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 19 7-7 3 3-7 7-3-3z" />
      <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="m2 2 20 20" />
      <path d="m8 8 2-2" />
      <path d="m11 11 2-2" />
    </svg>
  ),
  permissions: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  models: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v10" />
      <path d="M18.4 6.9A9 9 0 1 1 5.6 6.9" />
      <path d="M12 22V12" />
    </svg>
  ),
  vision: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  'image-generation': (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  session: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
  skills: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  ),
  web: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20" />
      <path d="M12 2a14.5 14.5 0 0 1 0 20" />
      <path d="M2 12h20" />
    </svg>
  ),
  tools: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.69.9H20a2 2 0 0 1 2 2v1" />
      <path d="M17 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="m19 19-2-2" />
      <path d="M20 21a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2" />
    </svg>
  ),
  extensions: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  ),
  plugins: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3v6a6 6 0 0 0 12 0V3" />
      <path d="M6 3h12" />
      <path d="M10 21h4" />
      <path d="M12 15v6" />
    </svg>
  ),
  prompts: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" strokeWidth="2.5" />
    </svg>
  ),
  automation: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  ),
  subagents: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="3" />
      <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
      <path d="M12 11v3" />
    </svg>
  ),
  pets: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  ),
  shortcuts: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" ry="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M7 16h10" />
    </svg>
  ),
  usage: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M7 15v3" />
      <path d="M12 10v8" />
      <path d="M17 5v13" />
    </svg>
  ),
};

export type SettingsShellProps = {
  activeSection: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  contextValue: SettingsContextValue;
  /** Error/info banners owned by SettingsPanel; rendered above the content. */
  banners?: ReactNode;
  /** Callback to close the modal sub-form. */
  onClose?: (() => void) | undefined;
};

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { activeSection, onSelectSection, contextValue, onClose } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const copy = getDesktopCopy(locale);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);

  const PageComponent = getSettingsSection(activeSection);

  const query = searchQuery.trim().toLowerCase();

  // Clicking a nav icon/section should always land at the top of the page.
  useEffect(() => {
    const node = mainScrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
  }, [activeSection]);

  return (
    <div
      className="settings-page"
      data-testid="settings-panel"
      aria-label={copy.settings}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div
        className="settings-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={copy.settings}
      >
        <aside className="settings-nav">
          <div className="settings-nav-brand">
            <span className="settings-nav-mark" aria-hidden>
              {/* Light theme → black alpaca; dark theme → white alpaca (CSS toggles). */}
              <img
                className="settings-nav-mark-img settings-nav-mark-img--for-light"
                src="/ui/alpaca-mark-black.png"
                alt=""
                width={18}
                height={18}
                draggable={false}
              />
              <img
                className="settings-nav-mark-img settings-nav-mark-img--for-dark"
                src="/ui/alpaca-mark-white.png"
                alt=""
                width={18}
                height={18}
                draggable={false}
              />
            </span>
            <strong>{copy.settings}</strong>
          </div>
          <div className="settings-search-container">
            <svg
              className="settings-search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              className="settings-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isChinese ? '搜索设置...' : 'Search Settings...'}
            />
          </div>
          <nav className="settings-nav-list" aria-label={copy.settings}>
            {SETTINGS_GROUPS.map((group) => {
              const groupSections = sectionsForGroup(group.id).filter((item) => {
                if (!query) return true;
                const label = translator.settings.nav[item.labelKey]?.toLowerCase() ?? '';
                const groupLabel = translator.settings[group.labelKey]?.toLowerCase() ?? '';
                return (
                  label.includes(query) || groupLabel.includes(query) || item.id.includes(query)
                );
              });
              if (groupSections.length === 0) return null;
              return (
                <div key={group.id} className="settings-nav-group">
                  <div className="settings-nav-group-label">
                    {translator.settings[group.labelKey]}
                  </div>
                  {groupSections.map((item) => (
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
                      <span className="settings-nav-icon">{SECTION_ICONS[item.id]}</span>
                      <span className="settings-nav-label">
                        {translator.settings.nav[item.labelKey]}
                      </span>
                      {item.beta ? (
                        <span className="settings-beta-badge" aria-label={copy.betaFeature}>
                          Beta
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="settings-nav-footer">
            <span className="settings-connection-dot" aria-hidden />
            {copy.localConfiguration}
          </div>
        </aside>
        <div className="settings-main" ref={mainScrollRef} data-testid="settings-main-scroll">
          {onClose ? (
            <header className="settings-main-header">
              <IconButton
                label={isChinese ? '关闭设置' : 'Close settings'}
                title={isChinese ? '关闭设置 (Esc)' : 'Close settings (Esc)'}
                onClick={onClose}
                className="settings-close-btn"
                data-testid="settings-close-button"
              >
                <IconClose />
              </IconButton>
            </header>
          ) : null}
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
        {/* Keep transient feedback outside the scrolling main column. The
            dialog owns this overlay, so save results stay visible at any
            scroll position without moving page content. */}
        {props.banners ? (
          <div
            className="ui-feedback-host settings-feedback-host"
            data-testid="settings-feedback-host"
          >
            {props.banners}
          </div>
        ) : null}
      </div>
    </div>
  );
}
