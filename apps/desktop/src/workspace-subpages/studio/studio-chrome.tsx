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
  kind: 'library' | 'flashcards' | 'knowledge';
  /** `page` uses an icon-only back control. Default keeps the back label. */
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

/** Full-window page chrome: titleband (back + title) and optional library-style subbar. */
export function StudioTopbar(props: StudioTopbarProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const locale = props.locale ?? contextLocale;
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const dragWindowLabel = getDesktopCopy(locale).titlebar.dragWindow;
  const title =
    props.kind === 'flashcards'
      ? t('Flashcards', '闪卡')
      : props.kind === 'knowledge'
        ? t('Knowledge', '知识库')
        : t('Library', '资料库');
  const iconBack = props.layout === 'page';

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

  const hasSubbar = searchField !== null || props.filters !== undefined;
  const toolbar =
    props.primaryAction || props.actions ? (
      <>
        {props.primaryAction}
        {props.actions}
      </>
    ) : null;

  return (
    <header className="studio-chrome">
      <div
        className="vault-bar"
        data-testid="studio-topbar"
        data-tauri-drag-region
        onMouseDown={handleNativeWindowDragMouseDown}
      >
        <div className="vault-bar-leading" data-no-window-drag>
          <button
            type="button"
            className={`vault-back${iconBack ? ' is-icon' : ''}`}
            data-testid={props.testId}
            onClick={props.onBack}
            aria-label={props.backLabel}
          >
            <IconChevronLeft width={16} height={16} aria-hidden="true" />
            {iconBack ? null : <span>{props.backLabel}</span>}
          </button>
          <span className="vault-bar-context">
            <span>{title}</span>
            {props.titleCount !== undefined ? (
              <span className="vault-bar-count">
                {props.kind === 'flashcards'
                  ? t(`${props.titleCount}`, `${props.titleCount} 张`)
                  : props.kind === 'library'
                    ? t(`${props.titleCount}`, `${props.titleCount} 项`)
                    : t(`${props.titleCount}`, `${props.titleCount} 个`)}
              </span>
            ) : null}
          </span>
        </div>

        {!hasSubbar && toolbar ? (
          <div className="vault-bar-actions" data-no-window-drag>
            {toolbar}
          </div>
        ) : null}

        <WindowDragRegion
          className="vault-titleband-drag"
          data-testid="studio-topbar-drag"
          aria-label={dragWindowLabel}
        />
      </div>
      {hasSubbar ? (
        <div className="vault-filters" data-no-window-drag>
          <div className="vault-filters-leading">
            {props.filters}
            {searchField}
          </div>
          {toolbar ? <div className="vault-filters-trailing">{toolbar}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
