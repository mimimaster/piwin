import type { ReactElement, ReactNode } from 'react';
import { getDesktopCopy, type DesktopLocale } from '../../desktop-locale';
import { useDesktopLocale } from '../../desktop-locale-context';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from '../../native-window-drag';
import { IconChevronLeft, IconClose, IconSearch } from '../../shell-icons';

export type StudioTopbarProps = {
  testId: string;
  backLabel: string;
  onBack: () => void;
  locale?: DesktopLocale | undefined;
  kind: 'library' | 'flashcards';
  /** `page` = title | search | primary. `bar` = compact toolbar. */
  layout?: 'bar' | 'page';
  titleCount?: number | undefined;
  searchPlaceholder?: string | undefined;
  searchTestId?: string | undefined;
  searchValue?: string | undefined;
  onSearchChange?: ((value: string) => void) | undefined;
  filters?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  primaryAction?: ReactNode | undefined;
};

/** Full-window page chrome: titleband, back, context, search, filters, actions. */
export function StudioTopbar(props: StudioTopbarProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const locale = props.locale ?? contextLocale;
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const dragWindowLabel = getDesktopCopy(locale).titlebar.dragWindow;
  const title = props.kind === 'flashcards' ? t('Flashcards', '闪卡') : t('Library', '资料库');
  const pageLayout = props.layout === 'page';

  const searchField =
    props.searchPlaceholder !== undefined ? (
      <label className="vault-search">
        <IconSearch width={14} height={14} aria-hidden="true" />
        <span className="sr-only">{props.searchPlaceholder}</span>
        <input
          type="search"
          aria-label={props.searchPlaceholder}
          placeholder={props.searchPlaceholder}
          value={props.searchValue ?? ''}
          onChange={(event) => props.onSearchChange?.(event.target.value)}
          {...(props.searchTestId !== undefined ? { 'data-testid': props.searchTestId } : {})}
        />
        {Boolean(props.searchValue) ? (
          <button
            type="button"
            className="vault-search-clear"
            onClick={() => props.onSearchChange?.('')}
            aria-label={t('Clear search', '清空搜索')}
          >
            <IconClose width={11} height={11} aria-hidden="true" />
          </button>
        ) : null}
      </label>
    ) : null;

  return (
    <header className="studio-chrome">
      <WindowDragRegion
        className="vault-titleband"
        data-testid="studio-topbar-drag"
        aria-label={dragWindowLabel}
      />
      <div
        className={`vault-bar${pageLayout ? ' is-page' : ''}`}
        data-testid="studio-topbar"
        data-tauri-drag-region
        onMouseDown={handleNativeWindowDragMouseDown}
      >
        <div className="vault-bar-leading" data-no-window-drag>
          <button
            type="button"
            className={`vault-back${pageLayout ? ' is-icon' : ''}`}
            data-testid={props.testId}
            onClick={props.onBack}
            aria-label={props.backLabel}
          >
            <IconChevronLeft width={16} height={16} aria-hidden="true" />
            {pageLayout ? null : <span>{props.backLabel}</span>}
          </button>
          <span className="vault-bar-context">
            <span>{title}</span>
            {props.titleCount !== undefined ? (
              <span className="vault-bar-count">
                {props.kind === 'flashcards'
                  ? t(`${props.titleCount}`, `${props.titleCount} 张`)
                  : props.kind === 'library'
                    ? t(`${props.titleCount}`, `${props.titleCount} 项`)
                    : props.titleCount}
              </span>
            ) : null}
          </span>
        </div>

        {pageLayout ? (
          <div className="vault-bar-search" data-no-window-drag>
            {searchField}
          </div>
        ) : null}

        <div
          className={pageLayout ? 'vault-bar-primary' : 'vault-bar-actions'}
          data-no-window-drag
        >
          {pageLayout ? props.primaryAction : searchField}
          {props.filters ? null : props.actions}
        </div>
      </div>
      {props.filters ? (
        <div className="vault-filters" data-no-window-drag>
          <div className="vault-filters-leading">{props.filters}</div>
          {props.actions}
        </div>
      ) : null}
    </header>
  );
}
