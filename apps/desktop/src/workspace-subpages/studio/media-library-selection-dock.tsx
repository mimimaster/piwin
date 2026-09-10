import type { ReactElement } from 'react';
import { IconClose, IconStar, IconTrash } from '../../shell-icons';

export type MediaLibrarySelectionDockProps = {
  translate: (english: string, chinese: string) => string;
  isZh: boolean;
  selectedIds: ReadonlySet<string>;
  visibleCount: number;
  favorites: ReadonlySet<string>;
  setFavoritesBatch: (keys: readonly string[], favorited: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onOpenBatchDelete: () => void;
  onDeselect: () => void;
  onShowToast: (
    message: string,
    action?: { label: string; onAction: () => void; holdMs?: number },
  ) => void;
};

export function MediaLibrarySelectionDock(
  props: MediaLibrarySelectionDockProps,
): ReactElement | null {
  const t = props.translate;
  if (props.selectedIds.size === 0) return null;

  return (
    <div
      className="lib-batch-bar"
      role="toolbar"
      aria-label={t('Selection actions', '选择操作')}
    >
      <span className="lib-batch-bar-count">
        {props.isZh ? (
          <>
            已选 <strong>{props.selectedIds.size}</strong> 项
          </>
        ) : (
          <>
            <strong>{props.selectedIds.size}</strong> selected
          </>
        )}
      </span>

      <button
        type="button"
        className="lib-batch-link"
        data-testid="library-select-all"
        onClick={() => props.onToggleSelectAll(props.selectedIds.size !== props.visibleCount)}
      >
        {props.selectedIds.size === props.visibleCount
          ? t('Deselect all', '全不选')
          : t('Select all', '全选')}
      </button>

      <span className="lib-batch-bar-sep" aria-hidden="true" />

      <button
        type="button"
        className="lib-batch-act-btn"
        onClick={() => {
          const keys = Array.from(props.selectedIds);
          const shouldFavorite = keys.some((id) => !props.favorites.has(id));
          props.setFavoritesBatch(keys, shouldFavorite);
          props.onShowToast(
            shouldFavorite
              ? t(`Favorited ${keys.length} assets`, `已收藏 ${keys.length} 项`)
              : t(
                  `Removed ${keys.length} assets from favorites`,
                  `已取消收藏 ${keys.length} 项`,
                ),
          );
        }}
      >
        <IconStar width={13} height={13} aria-hidden="true" />
        <span>{t('Favorite', '收藏')}</span>
      </button>

      <button
        type="button"
        className="lib-batch-act-btn is-danger"
        data-testid="library-batch-delete"
        onClick={props.onOpenBatchDelete}
      >
        <IconTrash width={13} height={13} aria-hidden="true" />
        <span>{t('Delete', '删除')}</span>
      </button>

      <span className="lib-batch-bar-sep" aria-hidden="true" />

      <button
        type="button"
        className="lib-batch-close"
        data-testid="library-deselect"
        onClick={props.onDeselect}
        title={t('Deselect', '取消选择')}
        aria-label={t('Deselect', '取消选择')}
      >
        <IconClose width={13} height={13} aria-hidden="true" />
      </button>
    </div>
  );
}
