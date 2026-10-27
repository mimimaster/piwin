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
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import { getDesktopCopy } from '../i18n/desktop-locale';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { openExternalUrl } from '../platform/open-external-url.js';
import { IconChevronLeft } from '../tool-cards/shell-icons';

const DOCS_HOME_URL = 'https://docs.piwinwin.com';
import {
  WindowDragRegion,
  handleNativeWindowDragMouseDown,
} from '../platform/native-window-drag';
import { scheduleIdleTask } from '../automation/schedule-idle-task';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  getSettingsSection,
  visibleSettingsSections,
  type SettingsSectionId,
} from './section-registry';
import { matchesSettingsSearch } from './settings-search-index.js';
import { SettingsProvider, type SettingsContextValue } from './settings-context';
import { SettingsFeedbackToast, type SettingsFeedbackTone } from './settings-feedback-toast';
import { ensureSettingsLazyLoaded } from './settings-lazy-load';
import { SETTINGS_SECTION_ICONS } from './settings-section-icons';
// Chromium Basic bundle: first-paint section only.
import './pages/basic.js';

export type SettingsShellProps = {
  activeSection: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  contextValue: SettingsContextValue;
  /** Callback to leave the settings route. */
  onClose?: (() => void) | undefined;
  feedback?: {
    error: string | null;
    info: string | null;
    tone: SettingsFeedbackTone;
  };
};

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { activeSection, onSelectSection, contextValue, onClose, feedback } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const copy = getDesktopCopy(locale);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const [, bumpLazyGeneration] = useReducer((generation: number) => generation + 1, 0);
  const [lazyLoadError, setLazyLoadError] = useState<string | null>(null);
  const PageComponent = getSettingsSection(activeSection);

  // Chromium ensureLazyLoaded(): pull Advanced when the active section is not Basic.
  useEffect(() => {
    if (PageComponent) {
      return;
    }
    let cancelled = false;
    void ensureSettingsLazyLoaded().then(
      () => {
        if (cancelled) return;
        setLazyLoadError(null);
        bumpLazyGeneration();
      },
      (error: unknown) => {
        if (cancelled) return;
        // A silently stuck spinner is indistinguishable from a missing page.
        console.error('[piwin] settings section load failed', activeSection, error);
        setLazyLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [PageComponent, activeSection]);

  function retryLazyLoad(): void {
    setLazyLoadError(null);
    void ensureSettingsLazyLoaded().then(
      () => bumpLazyGeneration(),
      (error: unknown) => {
        console.error('[piwin] settings section load failed', activeSection, error);
        setLazyLoadError(error instanceof Error ? error.message : String(error));
      },
    );
  }

  // Chromium settings-idle-load: warm Advanced after Basic has painted.
  useEffect(() => {
    return scheduleIdleTask(() => {
      void ensureSettingsLazyLoaded().then(() => {
        bumpLazyGeneration();
      }, () => {
        // The active-section effect owns user-visible reporting.
      });
    });
  }, []);

  const query = searchQuery.trim().toLowerCase();
  const activeSectionMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection);
  const activeSectionLabel = activeSectionMeta
    ? translator.settings.nav[activeSectionMeta.labelKey]
    : copy.settings;
  const hasSearchResults = SETTINGS_GROUPS.some((group) =>
    visibleSettingsSections().filter((item) => item.group === group.id).some((item) => {
      if (!query) return true;
      const label = translator.settings.nav[item.labelKey]?.toLowerCase() ?? '';
      const groupLabel = translator.settings[group.labelKey]?.toLowerCase() ?? '';
      return matchesSettingsSearch(query, item, [label, groupLabel]);
    }),
  );

  // Clicking a nav icon/section should always land at the top of the page.
  useEffect(() => {
    const node = mainScrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
    const contentNode = node.querySelector('.settings-main-content');
    if (contentNode instanceof HTMLElement) {
      contentNode.scrollTop = 0;
    }
  }, [activeSection]);

  // On a phone the section list is a horizontal strip; a section opened from
  // search or a deep link may sit off screen, so bring its item into view.
  useEffect(() => {
    const active = document.querySelector<HTMLElement>(
      `[data-testid="settings-nav-${activeSection}"]`,
    );
    active?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
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
        {feedback ? (
          <SettingsFeedbackToast error={feedback.error} info={feedback.info} tone={feedback.tone} />
        ) : null}
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
              const groupSections = visibleSettingsSections()
                .filter((item) => item.group === group.id)
                .filter((item) => {
                  if (!query) return true;
                  const label = translator.settings.nav[item.labelKey]?.toLowerCase() ?? '';
                  const groupLabel = translator.settings[group.labelKey]?.toLowerCase() ?? '';
                  return matchesSettingsSearch(query, item, [label, groupLabel]);
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
                      <span className="settings-nav-icon">{SETTINGS_SECTION_ICONS[item.id]}</span>
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
            <button
              type="button"
              className="settings-docs-tab shell-item"
              onClick={() => {
                void openExternalUrl(DOCS_HOME_URL);
              }}
              data-testid="settings-nav-docs"
              title={`Docs (${DOCS_HOME_URL})`}
              aria-label="Docs"
            >
              <span className="settings-nav-icon" aria-hidden="true">
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
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                  <path d="M6.5 17H20" />
                </svg>
              </span>
              <span className="settings-nav-label">Docs</span>
              <svg
                className="settings-docs-arrow"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17 17 7M7 7h10v10" />
              </svg>
            </button>
          </div>
        </aside>
        <div className="settings-main" ref={mainScrollRef} data-testid="settings-main-scroll">
          <header className="settings-main-header">
            <div className="settings-main-heading">
              <h1>{activeSectionLabel}</h1>
            </div>
            <div
              id="settings-main-header-actions"
              className="settings-main-header-actions"
              data-testid="settings-main-header-actions"
            />
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
            ) : lazyLoadError ? (
              <div className="deferred-surface-fallback" data-testid="settings-section-load-error">
                <Notice
                  tone="error"
                  title={isChinese ? '此设置页加载失败' : 'This settings page failed to load'}
                  testId="settings-section-load-error-notice"
                  action={
                    <Button variant="ghost" onClick={retryLazyLoad}>
                      {isChinese ? '重试' : 'Retry'}
                    </Button>
                  }
                  details={lazyLoadError}
                >
                  {isChinese
                    ? `「${activeSectionLabel}」没有加载成功，所以这里没有任何内容。`
                    : `“${activeSectionLabel}” did not load, so there is nothing to show here.`}
                </Notice>
              </div>
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
