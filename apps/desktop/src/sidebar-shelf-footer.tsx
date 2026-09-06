import type { DesktopLocale } from './desktop-locale';
import { IconCards, IconImage, IconSettings } from './shell-icons';

export interface SidebarShelfFooterProps {
  activeSubPage?: 'chat' | 'library' | 'images' | 'videos' | 'flashcards' | null | undefined;
  onOpenLibrary?: (() => void) | undefined;
  onOpenImages?: (() => void) | undefined;
  onOpenFlashcards?: (() => void) | undefined;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onPrefetchSettings?: (() => void) | undefined;
  hostReady: boolean;
  hostMock: boolean;
  transportLabel: string;
  locale?: DesktopLocale | undefined;
  flashcardsTitle: string;
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
          className={`shelf-btn${props.activeSubPage === 'flashcards' ? ' active' : ''}`}
          data-testid="sidebar-flashcards-shelf-btn"
          onClick={() => props.onOpenFlashcards?.()}
          title={props.flashcardsTitle}
          aria-label={props.flashcardsTitle}
        >
          <IconCards width={16} height={16} />
          <span>{props.flashcardsTitle}</span>
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
      </footer>

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
        <span className="sr-only" data-testid="agent-mode-pill">
          {props.hostMock ? 'mock' : 'live'}
        </span>
      </div>
    </>
  );
}
