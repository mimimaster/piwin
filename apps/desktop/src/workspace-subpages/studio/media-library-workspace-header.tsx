import type { RefObject, ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@piwin/ui-kit';
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconClose,
  IconGrid,
  IconMenuList,
  IconPanelRight,
  IconSearch,
  IconSliders,
  IconStar,
} from '../../shell-icons';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from '../../native-window-drag';
import { KIND_TABS, type ActiveKind } from './media-library-workspace-model';

export type MediaLibraryWorkspaceHeaderProps = {
  translate: (english: string, chinese: string) => string;
  kind: ActiveKind;
  onKindChange: (kind: ActiveKind) => void;
  clientFilterActive: boolean;
  visibleCount: number;
  catalogTotal: number;
  modelOptions: ReadonlyArray<{ model: string; count: number }>;
  modelFilter: string;
  onModelFilterChange: (model: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  search: string;
  onSearchChange: (search: string) => void;
  sortDir: 'newest' | 'oldest';
  onSortDirChange: (sortDir: 'newest' | 'oldest') => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (viewMode: 'grid' | 'list') => void;
  inspectorOpen: boolean;
  onInspectorToggle: () => void;
  onClose: () => void;
};

export function MediaLibraryWorkspaceHeader(
  props: MediaLibraryWorkspaceHeaderProps,
): ReactElement {
  const t = props.translate;

  return (
    <header className="studio-chrome">
      <div
        className="vault-bar is-page"
        data-testid="studio-topbar"
        data-tauri-drag-region
        onMouseDown={handleNativeWindowDragMouseDown}
      >
        {/* Left: Back + Title & Badge (with traffic light clearance) */}
        <div className="vault-bar-leading" data-no-window-drag>
          <button
            type="button"
            className="vault-back is-icon"
            data-testid="library-back-btn"
            onClick={props.onClose}
            aria-label={t('Back', '返回')}
          >
            <IconChevronLeft width={16} height={16} aria-hidden="true" />
          </button>
          <div className="vault-bar-context">
            <span>{t('Library', '资料库')}</span>
            <span
              className={`vault-bar-count${props.clientFilterActive ? ' is-filtered' : ''}`}
              data-testid="library-asset-count"
            >
              {props.clientFilterActive
                ? `${props.visibleCount} / ${props.catalogTotal}`
                : props.catalogTotal}{' '}
              {t('assets', '项资产')}
            </span>
          </div>
        </div>

        <WindowDragRegion
          className="vault-titleband-drag"
          data-testid="studio-topbar-drag"
          aria-label={t('Drag window', '拖拽窗口')}
        />
      </div>

      <div className="vault-filters" data-no-window-drag>
        <div className="vault-filters-leading">
          <nav className="lib-segmented-tabs" aria-label={t('Library type', '资料类型')}>
            {KIND_TABS.map((tab) => {
              const active = props.kind === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`lib-segmented-tab${active ? ' is-active' : ''}`}
                  data-testid={`library-tab-${
                    tab.id === 'image'
                      ? 'images'
                      : tab.id === 'video'
                        ? 'videos'
                        : tab.id === 'file'
                          ? 'files'
                          : 'favorites'
                  }`}
                  aria-pressed={active}
                  onClick={() => props.onKindChange(tab.id)}
                >
                  {tab.id === 'favorite' ? (
                    <IconStar width={12} height={12} aria-hidden="true" />
                  ) : null}
                  <span>{t(tab.en, tab.zh)}</span>
                </button>
              );
            })}
          </nav>

          {/* One model in the catalog means the filter can only ever be a no-op. */}
          {props.modelOptions.length > 1 ? (
            <div className="lib-filter-pill-wrap">
              <select
                className="lib-filter-select"
                data-testid="library-model-filter"
                value={props.modelFilter}
                onChange={(event) => props.onModelFilterChange(event.target.value)}
                aria-label={t('Filter by model', '按模型筛选')}
              >
                <option value="all">{t('All Models', '全部模型')}</option>
                {props.modelOptions.map((option) => (
                  <option key={option.model} value={option.model}>
                    {option.model} ({option.count})
                  </option>
                ))}
              </select>
              <IconChevronDown
                className="lib-filter-chevron"
                width={11}
                height={11}
                aria-hidden="true"
              />
            </div>
          ) : null}

          <label className="vault-search">
            <IconSearch width={13} height={13} aria-hidden="true" />
            <input
              ref={props.searchInputRef}
              type="search"
              data-testid="library-search"
              placeholder={t('Search assets…', '搜索素材…')}
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              aria-label={t('Search', '搜索')}
            />
            <kbd className="vault-search-kbd">⌘K</kbd>
            {Boolean(props.search) ? (
              <button
                type="button"
                className="vault-search-clear"
                onClick={() => props.onSearchChange('')}
                aria-label={t('Clear', '清空')}
              >
                <IconClose width={11} height={11} aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>

        <div className="vault-filters-trailing">
          <div className="lib-view-toggle" role="group" aria-label={t('View mode', '视图模式')}>
            <DropdownMenu
              align="end"
              testId="library-sort-menu"
              trigger={
                <button
                  type="button"
                  className="lib-view-btn"
                  title={
                    props.sortDir === 'newest'
                      ? t('Sort: Newest first', '排序：最新优先')
                      : t('Sort: Oldest first', '排序：最早优先')
                  }
                  aria-label={
                    props.sortDir === 'newest'
                      ? t('Sort: Newest first', '排序：最新优先')
                      : t('Sort: Oldest first', '排序：最早优先')
                  }
                  data-testid="library-sort-btn"
                >
                  <IconSliders width={13} height={13} aria-hidden="true" />
                </button>
              }
            >
              <DropdownMenuItem
                testId="library-sort-newest"
                onSelect={() => props.onSortDirChange('newest')}
                icon={
                  props.sortDir === 'newest' ? (
                    <IconCheck width={12} height={12} aria-hidden="true" />
                  ) : (
                    <span className="lib-menu-check-spacer" aria-hidden="true" />
                  )
                }
              >
                {t('Newest first', '最新优先')}
              </DropdownMenuItem>
              <DropdownMenuItem
                testId="library-sort-oldest"
                onSelect={() => props.onSortDirChange('oldest')}
                icon={
                  props.sortDir === 'oldest' ? (
                    <IconCheck width={12} height={12} aria-hidden="true" />
                  ) : (
                    <span className="lib-menu-check-spacer" aria-hidden="true" />
                  )
                }
              >
                {t('Oldest first', '最早优先')}
              </DropdownMenuItem>
            </DropdownMenu>

            <button
              type="button"
              className={`lib-view-btn${props.viewMode === 'grid' ? ' is-active' : ''}`}
              onClick={() => props.onViewModeChange('grid')}
              title={t('Grid view', '网格视图')}
              aria-label={t('Grid view', '网格视图')}
            >
              <IconGrid width={13} height={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`lib-view-btn${props.viewMode === 'list' ? ' is-active' : ''}`}
              onClick={() => props.onViewModeChange('list')}
              title={t('List view', '列表视图')}
              aria-label={t('List view', '列表视图')}
            >
              <IconMenuList width={13} height={13} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`lib-view-btn${props.inspectorOpen ? ' is-active' : ''}`}
              onClick={props.onInspectorToggle}
              title={t('Toggle Inspector', '切换属性面板')}
              aria-label={t('Toggle Inspector', '切换属性面板')}
            >
              <IconPanelRight width={13} height={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
