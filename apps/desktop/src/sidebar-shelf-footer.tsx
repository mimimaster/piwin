import type { DesktopLocale } from './desktop-locale';
import { IconBook, IconImage, IconSettings } from './shell-icons';

export interface SidebarShelfFooterProps {
  activeSubPage?:
    | 'chat'
    | 'library'
    | 'images'
    | 'videos'
    | 'flashcards'
    | 'knowledge'
    | 'marketplace'
    | null
    | undefined;
  onOpenLibrary?: (() => void) | undefined;
  onOpenImages?: (() => void) | undefined;
  onOpenFlashcards?: (() => void) | undefined;
  onOpenKnowledge?: (() => void) | undefined;
  knowledgeTitle: string;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onPrefetchSettings?: (() => void) | undefined;
  hostReady: boolean;
  hostMock: boolean;
  transportLabel: string;
  locale?: DesktopLocale | undefined;
  flashcardsTitle?: string | undefined;
  settingsTitle: string;
}

export function SidebarShelfFooter(props: SidebarShelfFooterProps) {
  const libraryTitle = props.locale === 'en' ? 'Library' : '资料库';

  return (
    <>
      <footer className="shelf sidebar-shelf" data-testid="sidebar-shelf">
        <button
          type="button"
          className={`shelf-btn${
            props.activeSubPage === 'library' ||
            props.activeSubPage === 'images' ||
            props.activeSubPage === 'videos'
              ? ' active'
              : ''
          }`}
          data-testid="sidebar-library-shelf-btn"
          onClick={() => (props.onOpenLibrary ?? props.onOpenImages)?.()}
          title={libraryTitle}
          aria-label={libraryTitle}
        >
          <IconImage width={16} height={16} />
          <span>{libraryTitle}</span>
        </button>

        <button
          type="button"
          className={`shelf-btn${
            props.activeSubPage === 'knowledge' || props.activeSubPage === 'flashcards'
              ? ' active'
              : ''
          }`}
          data-testid="sidebar-knowledge-shelf-btn"
          onClick={() => props.onOpenKnowledge?.()}
          title={props.knowledgeTitle}
          aria-label={props.knowledgeTitle}
        >
          <IconBook width={16} height={16} />
          <span>{props.knowledgeTitle}</span>
        </button>

        <button
          type="button"
          className={`shelf-btn${props.settingsOpen ? ' active' : ''}`}
          data-testid="settings-open-shelf-btn"
          onClick={props.onOpenSettings}
          onPointerEnter={props.onPrefetchSettings}
          title={props.settingsTitle}
          aria-label={props.settingsTitle}
        >
          <IconSettings width={16} height={16} />
          <span>{props.settingsTitle}</span>
        </button>
        <div className="host sidebar-host" data-testid="sidebar-host-status">
          <span
            className={`sidebar-host-dot${props.hostReady ? ' on' : ''}`}
            aria-hidden
          />
          <span>{props.transportLabel}</span>
        </div>
      </footer>

      {/* Deck-era footer: CSS shows this instead of .sidebar-shelf for any
          non-Inkstone theme (see styles/inkstone/sidebar.css). Kept for that
          fallback; not reachable under the shipped Inkstone theme. */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-fade" aria-hidden="true" />
        <button
          type="button"
          className={
            props.settingsOpen
              ? 'sidebar-footer-button sidebar-settings-button active'
              : 'sidebar-footer-button sidebar-settings-button'
          }
          title={props.settingsTitle}
          aria-label={props.settingsTitle}
          aria-pressed={props.settingsOpen}
          data-testid="settings-open-btn"
          onClick={props.onOpenSettings}
          onPointerEnter={props.onPrefetchSettings}
          onMouseEnter={props.onPrefetchSettings}
          onFocus={props.onPrefetchSettings}
        >
          <IconSettings />
          <span className="sidebar-footer-label">{props.settingsTitle}</span>
        </button>
      </div>

      {/* Not theme-scoped: the mock/live sentinel e2e waits on must stay in
          the DOM regardless of which footer above is CSS-visible. */}
      <span className="sr-only" data-testid="agent-mode-pill">
        {props.hostMock ? 'mock' : 'live'}
      </span>
    </>
  );
}
