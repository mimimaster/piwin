/**
 * NavRail — the persistent top-level navigation column (deck §7.2).
 *
 * Rendered by the workbench shell and placed in the grid's `rail` area by
 * region-shell.css. It exists so the sidebar can collapse to zero without
 * stranding the user: every top-level destination stays one click away.
 */
import type { ReactElement } from 'react';
import { IconCards, IconChat, IconImage, IconSearch, IconSettings } from './shell-icons';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';

export type NavRailProps = {
  locale: DesktopLocale;
  activeSubPage: 'chat' | 'library' | 'images' | 'videos' | 'flashcards' | null | undefined;
  settingsOpen: boolean;
  /** Return to the primary conversation pane. */
  onNavigateChat: () => void;
  onOpenLibrary: () => void;
  onOpenFlashcards: () => void;
  onOpenSessionSearch: () => void;
  onOpenSettings: () => void;
};

export function NavRail(props: NavRailProps): ReactElement {
  const copy = getDesktopCopy(props.locale);
  const libraryPages: ReadonlyArray<'library' | 'images' | 'videos'> = [
    'library',
    'images',
    'videos',
  ];
  const isLibrary = libraryPages.includes(
    props.activeSubPage as (typeof libraryPages)[number],
  );
  const onChat = (): void => props.onNavigateChat();

  return (
    <nav className="nav-rail" data-testid="nav-rail" aria-label={copy.titlebar.shellNavigation}>
      <button
        type="button"
        className={`nav-rail-btn${(!props.activeSubPage || props.activeSubPage === 'chat') ? ' active' : ''}`}
        data-testid="nav-rail-chat-btn"
        title={copy.titlebar.sessions}
        aria-label={copy.titlebar.sessions}
        onClick={onChat}
      >
        <IconChat />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${isLibrary ? ' active' : ''}`}
        data-testid="nav-rail-library-btn"
        title={props.locale === 'en' ? 'Library' : '资料库'}
        aria-label={props.locale === 'en' ? 'Library' : '资料库'}
        onClick={props.onOpenLibrary}
      >
        <IconImage />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${props.activeSubPage === 'flashcards' ? ' active' : ''}`}
        data-testid="nav-rail-flashcards-btn"
        title={copy.sidebar.flashcards}
        aria-label={copy.sidebar.flashcards}
        onClick={props.onOpenFlashcards}
      >
        <IconCards />
      </button>
      <button
        type="button"
        className="nav-rail-btn"
        data-testid="nav-rail-search-btn"
        title={copy.searchSessions}
        aria-label={copy.searchSessions}
        onClick={props.onOpenSessionSearch}
      >
        <IconSearch />
      </button>
      <div className="nav-rail-spacer" aria-hidden="true" />
      <button
        type="button"
        className={`nav-rail-btn${props.settingsOpen ? ' active' : ''}`}
        data-testid="nav-rail-settings-btn"
        title={copy.settings}
        aria-label={copy.settings}
        aria-pressed={props.settingsOpen}
        onClick={props.onOpenSettings}
      >
        <IconSettings />
      </button>
    </nav>
  );
}
