/**
 * Settings shell: full-window two-layer frame (category nav + single content page).
 * Nav is generated from the section registry; content renders the registered
 * page component — the registry covers every section.
 *
 * The persistent sidebar is the navigation surface; the main column owns the
 * active section heading and its content.
 */
import {
  Component,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Notice, Spinner } from '@piwin/ui-kit';
import { getDesktopCopy } from '../desktop-locale';
import { useDesktopLocale } from '../desktop-locale-context';
import { IconChevronLeft } from '../shell-icons';
import {
  WindowDragRegion,
  handleNativeWindowDragMouseDown,
} from '../native-window-drag';
import { scheduleIdleTask } from '../schedule-idle-task';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  getSettingsSection,
  sectionsForGroup,
  type SettingsSectionId,
} from './section-registry';
import { SettingsProvider, type SettingsContextValue } from './settings-context';
import { ensureSettingsLazyLoaded } from './settings-lazy-load';
// Chromium Basic bundle: first-paint section only.
import './pages/basic.js';

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
  oauth: (
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
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  hooks: (
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
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  agent: (
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
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
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
      <path d="M11 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.69.9H20a2 2 0 0 1 2 2v1" />
      <path d="M17 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="m19 19-2-2" />
      <path d="M20 21a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2" />
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
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  knowledge: (
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
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 11h5" />
      <circle cx="17" cy="17" r="3" />
      <path d="m19 19 3 3" />
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  'cold-storage': (
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
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
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
  archive: (
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
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  ),
};

export type SettingsShellProps = {
  activeSection: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  contextValue: SettingsContextValue;
  /** Callback to leave the settings route. */
  onClose?: (() => void) | undefined;
};

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { activeSection, onSelectSection, contextValue, onClose } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const copy = getDesktopCopy(locale);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const [, bumpLazyGeneration] = useReducer((generation: number) => generation + 1, 0);
  const PageComponent = getSettingsSection(activeSection);

  // Chromium ensureLazyLoaded(): pull Advanced when the active section is not Basic.
  useEffect(() => {
    if (PageComponent) {
      return;
    }
    let cancelled = false;
    void ensureSettingsLazyLoaded().then(() => {
      if (!cancelled) {
        bumpLazyGeneration();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [PageComponent, activeSection]);

  // Chromium settings-idle-load: warm Advanced after Basic has painted.
  useEffect(() => {
    return scheduleIdleTask(() => {
      void ensureSettingsLazyLoaded().then(() => {
        bumpLazyGeneration();
      });
    });
  }, []);

  const query = searchQuery.trim().toLowerCase();
  const activeSectionMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection);
  const activeSectionLabel = activeSectionMeta
    ? translator.settings.nav[activeSectionMeta.labelKey]
    : copy.settings;
  const hasSearchResults = SETTINGS_GROUPS.some((group) =>
    sectionsForGroup(group.id).some((item) => {
      if (!query) return true;
      const label = translator.settings.nav[item.labelKey]?.toLowerCase() ?? '';
      const groupLabel = translator.settings[group.labelKey]?.toLowerCase() ?? '';
      return label.includes(query) || groupLabel.includes(query) || item.id.includes(query);
    }),
  );

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
        {/* Full-width titleband: settings covers the shell chrome, so this is the only window drag surface. */}
        <div
          className="settings-titlebar settings-titlebar-box"
          data-testid="settings-titlebar"
          data-tauri-drag-region
          onMouseDown={handleNativeWindowDragMouseDown}
        >
          {onClose ? (
            <div className="settings-titlebar-leading" data-no-window-drag>
              <button
                type="button"
                className="settings-back-button"
                onClick={onClose}
                data-testid="settings-back-button"
                title={`${translator.settings.backToWorkspace} (Esc)`}
                aria-label={translator.settings.backToWorkspace}
              >
                <IconChevronLeft width={14} height={14} aria-hidden="true" />
                <span className="sr-only">{translator.settings.backToWorkspace}</span>
              </button>
              <span className="settings-titlebar-title">{copy.settings}</span>
            </div>
          ) : null}
          <WindowDragRegion
            className="settings-titlebar-drag"
            data-testid="settings-titlebar-drag"
            aria-label={copy.titlebar.dragWindow}
          />
        </div>
        <aside className="settings-nav shell-nav">
          <div className="settings-search-container shell-search">
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
                  <div className="settings-nav-group-label shell-grp">
                    {translator.settings[group.labelKey]}
                  </div>
                  {groupSections.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        activeSection === item.id
                          ? 'settings-nav-item shell-item active on'
                          : 'settings-nav-item shell-item'
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
            {!hasSearchResults ? (
              <p className="settings-nav-empty">
                {isChinese ? '没有匹配的设置。' : 'No matching settings.'}
              </p>
            ) : null}
          </nav>
          <div className="settings-nav-footer">
            <span className="settings-connection-dot" aria-hidden />
            {contextValue.remoteSettingsReadOnly
              ? translator.settings.remoteHostViewOnly
              : contextValue.hostClient?.getTransport?.() === 'remote'
                ? translator.settings.remoteSavedOnHost
                : translator.settings.configuredLocally}
          </div>
        </aside>
        <div className="settings-main" ref={mainScrollRef} data-testid="settings-main-scroll">
          <header className="settings-main-header">
            <div className="settings-main-heading">
              <h1>{activeSectionLabel}</h1>
            </div>
          </header>
          {contextValue.remoteSettingsReadOnly ? (
            <Notice tone="info" testId="settings-remote-read-only">
              {translator.settings.remoteSettingsViewOnly}
            </Notice>
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
                <SettingsPageErrorBoundary section={activeSection}>
                  <PageComponent />
                </SettingsPageErrorBoundary>
              </SettingsProvider>
            ) : (
              <div className="deferred-surface-fallback" data-testid="settings-section-loading">
                <Spinner
                  label={isChinese ? '正在加载此设置页' : 'Loading this settings page'}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

class SettingsPageErrorBoundary extends Component<
  { children: ReactNode; section: SettingsSectionId },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[piwin] settings page crash', this.props.section, error, info.componentStack);
  }

  componentDidUpdate(previous: { section: SettingsSectionId }): void {
    if (previous.section !== this.props.section && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Notice tone="error" testId="settings-page-error">
          {this.state.error.message}
        </Notice>
      );
    }
    return this.props.children;
  }
}
