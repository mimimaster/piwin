import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import {
  IconCheck,
  IconCopy,
  IconExpand,
  IconPlay,
  IconSpark,
  IconStar,
  IconTrash,
} from '../../shell-icons';

export type LibraryMediaCardModel = {
  id: string;
  testId: string;
  imageUrl: string;
  alt: string;
  name: string;
  typeLabel: string;
  size: string;
  showPlayOverlay?: boolean | undefined;
  prompt?: string | undefined;
  model?: string | undefined;
  createdAt?: string | undefined;
  viewMode?: 'grid' | 'list' | undefined;
  favorite?: boolean | undefined;
  /**
   * True once anything anywhere in the grid is selected — the checkbox then
   * stays visible on every tile instead of only the one being hovered, so
   * continuing to build a selection doesn't mean hunting for the corner.
   * There is no separate "batch mode": selecting *is* the mode.
   */
  selectionActive?: boolean | undefined;
  isSelected?: boolean | undefined;
  isActive?: boolean | undefined;
  kind?: 'image' | 'video' | 'file' | undefined;
  /** False when every visible tile shares one model — the badge is then pure noise. */
  showModel?: boolean | undefined;
  thumbFit?: 'cover' | 'contain' | undefined;
};

export type LibraryMediaCardActions = {
  /**
   * Receives the click so the caller can branch on ⌘/Ctrl/Shift. Optional
   * because the right-click "Open" menu entry calls this with no event.
   */
  onOpen: (event?: ReactMouseEvent<HTMLButtonElement>) => void;
  onFocus?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  deleteLabel: string;
  onImageError?: (() => void) | undefined;
  onCopyPrompt?: (() => void) | undefined;
  copyLabel?: string | undefined;
  copied?: boolean | undefined;
  onToggleFavorite?: (() => void) | undefined;
  favoriteLabel?: string | undefined;
  favoritedLabel?: string | undefined;
  selectLabel?: string | undefined;
  onToggleSelect?: (() => void) | undefined;
  onRemix?: (() => void) | undefined;
  remixLabel?: string | undefined;
  onOpenLightbox?: (() => void) | undefined;
  fullscreenLabel?: string | undefined;
};

function seekPosterFrame(video: HTMLVideoElement): void {
  if (video.paused && video.currentTime === 0) {
    video.currentTime = 0.001;
  }
}

export function LibraryMediaCard(props: {
  item: LibraryMediaCardModel;
  actions: LibraryMediaCardActions;
}): ReactElement {
  const { item, actions } = props;
  const hasThumb = item.imageUrl !== '';
  const isList = item.viewMode === 'list';
  const isVideo = item.kind === 'video' || item.showPlayOverlay === true;

  if (isList) {
    return (
      <article
        className={`lib-row-card${hasThumb ? '' : ' is-wait'}${item.isActive ? ' is-active' : ''}${isVideo ? ' is-video' : ''}${item.isSelected ? ' is-selected' : ''}${item.selectionActive ? ' selection-active' : ''}`}
      >
        {actions.onToggleSelect ? (
          <input
            type="checkbox"
            className="lib-batch-checkbox"
            checked={Boolean(item.isSelected)}
            onChange={(e) => {
              e.stopPropagation();
              actions.onToggleSelect?.();
            }}
            aria-label={actions.selectLabel ?? 'Select item'}
          />
        ) : null}

        <button
          type="button"
          className="lib-row-open"
          data-testid={item.testId}
          onClick={actions.onOpen}
          onFocus={actions.onFocus}
          aria-label={item.alt}
        >
          <span className="lib-row-thumb">
            {hasThumb ? (
              isVideo ? (
                <video
                  src={item.imageUrl}
                  className="lib-row-img is-video"
                  preload="metadata"
                  muted
                  playsInline
                  onLoadedMetadata={(event) => seekPosterFrame(event.currentTarget)}
                  onError={actions.onImageError}
                />
              ) : (
                <img
                  src={item.imageUrl}
                  alt=""
                  className="lib-row-img"
                  decoding="async"
                  loading="lazy"
                  onError={actions.onImageError}
                />
              )
            ) : (
              <span className="lib-card-wait" aria-hidden="true" />
            )}
            {item.showPlayOverlay === true ? (
              <span className="lib-row-play" aria-hidden="true">
                <IconPlay width={10} height={10} />
              </span>
            ) : null}
          </span>
          <div className="lib-row-main">
            <strong className="lib-row-title">{item.name}</strong>
            <div className="lib-row-meta">
              {item.model ? <span className="lib-model-tag">{item.model}</span> : null}
              <span className="lib-row-type">
                {item.typeLabel} · {item.size}
              </span>
              {item.createdAt ? <span className="lib-row-time">{item.createdAt}</span> : null}
            </div>
          </div>
        </button>

        <div className="lib-row-actions">
          {actions.onToggleFavorite ? (
            <button
              type="button"
              className={`lib-action-btn${item.favorite ? ' is-favorite' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                actions.onToggleFavorite?.();
              }}
              title={item.favorite ? (actions.favoritedLabel ?? 'Favorited') : (actions.favoriteLabel ?? 'Favorite')}
              aria-label={item.favorite ? (actions.favoritedLabel ?? 'Favorited') : (actions.favoriteLabel ?? 'Favorite')}
            >
              <IconStar width={14} height={14} aria-hidden="true" />
            </button>
          ) : null}

          {actions.onCopyPrompt ? (
            <button
              type="button"
              className="lib-action-btn"
              onClick={actions.onCopyPrompt}
              title={actions.copied ? 'Copied' : actions.copyLabel || 'Copy prompt'}
              aria-label={actions.copied ? 'Copied' : actions.copyLabel || 'Copy prompt'}
            >
              {actions.copied ? (
                <IconCheck width={14} height={14} aria-hidden="true" />
              ) : (
                <IconCopy width={14} height={14} aria-hidden="true" />
              )}
            </button>
          ) : null}

          {actions.onDelete ? (
            <button
              type="button"
              className="lib-action-btn is-danger"
              data-testid={`media-delete-${item.id}`}
              onClick={actions.onDelete}
              title={actions.deleteLabel}
              aria-label={actions.deleteLabel}
            >
              <IconTrash width={14} height={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article
      className={`lib-card${hasThumb ? '' : ' is-wait'}${item.isActive ? ' is-active' : ''}${isVideo ? ' is-video' : ''}${item.isSelected ? ' is-selected' : ''}${item.selectionActive ? ' selection-active' : ''}`}
    >
      <button
        type="button"
        className="lib-card-open"
        data-testid={item.testId}
        onClick={actions.onOpen}
        onFocus={actions.onFocus}
        aria-label={item.alt}
      >
        <span className="lib-card-thumb">
          {hasThumb ? (
            isVideo ? (
              <video
                src={item.imageUrl}
                className={`lib-card-img is-video${item.thumbFit === 'contain' ? ' is-contain' : ''}`}
                preload="metadata"
                muted
                playsInline
                onLoadedMetadata={(event) => seekPosterFrame(event.currentTarget)}
                onError={actions.onImageError}
                onMouseEnter={(event) => {
                  void event.currentTarget.play().catch(() => undefined);
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.pause();
                  event.currentTarget.currentTime = 0.001;
                }}
              />
            ) : (
              <img
                src={item.imageUrl}
                alt=""
                className={`lib-card-img${item.thumbFit === 'contain' ? ' is-contain' : ''}`}
                decoding="async"
                loading="lazy"
                onError={actions.onImageError}
              />
            )
          ) : (
            <span className="lib-card-wait" aria-hidden="true" />
          )}

          {/* Favourite has to read without hovering, but it does not need a
              whole button's worth of chrome to do it. */}
          {item.favorite ? (
            <span className="lib-card-fav-flag" aria-hidden="true">
              <IconStar width={13} height={13} />
            </span>
          ) : null}

          {item.showPlayOverlay === true ? (
            <span className="lib-card-play" aria-hidden="true">
              <IconPlay width={12} height={12} />
            </span>
          ) : null}
        </span>

        <span className="lib-card-overlay">
          {item.model && item.showModel !== false ? (
            <span className="lib-card-overlay-model">{item.model}</span>
          ) : null}
          {item.prompt ? <span className="lib-card-overlay-prompt">{item.prompt}</span> : null}
          <span className="lib-card-overlay-foot">
            {actions.onOpenLightbox ? (
              <span
                className="lib-card-theater-btn"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onOpenLightbox?.();
                }}
              >
                <IconExpand width={12} height={12} aria-hidden="true" />
                <span>{actions.fullscreenLabel ?? 'Fullscreen'}</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>

      {/* Selection sits top-left, opposite the actions, so a selected card
          never crowds its own toolbar. Always in the DOM — CSS reveals it on
          hover, or on every tile at once as soon as any selection exists
          (.selection-active below). */}
      {actions.onToggleSelect ? (
        <label className="lib-card-select">
          <input
            type="checkbox"
            className="lib-card-batch-cb"
            checked={Boolean(item.isSelected)}
            onChange={(e) => {
              e.stopPropagation();
              actions.onToggleSelect?.();
            }}
            aria-label={actions.selectLabel ?? 'Select card'}
          />
        </label>
      ) : null}

      {/* Top-right chrome: one capsule, not four floating boxes. */}
      <div className="lib-card-overlay-bar">
        <div className="lib-card-toolbar">
        {!actions.onToggleFavorite ? null : (
          <button
            type="button"
            className={`lib-card-hover-btn${item.favorite ? ' is-favorite' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              actions.onToggleFavorite?.();
            }}
            title={item.favorite ? (actions.favoritedLabel ?? 'Favorited') : (actions.favoriteLabel ?? 'Favorite')}
            aria-label={item.favorite ? (actions.favoritedLabel ?? 'Favorited') : (actions.favoriteLabel ?? 'Favorite')}
          >
            <IconStar width={13} height={13} aria-hidden="true" />
          </button>
        )}

        {actions.onRemix && item.prompt ? (
          <button
            type="button"
            className="lib-card-hover-btn"
            onClick={(event) => {
              event.stopPropagation();
              actions.onRemix?.();
            }}
            title={actions.remixLabel ?? 'Remix in Chat'}
            aria-label={actions.remixLabel ?? 'Remix in Chat'}
          >
            <IconSpark width={13} height={13} aria-hidden="true" />
          </button>
        ) : null}

        {actions.onCopyPrompt ? (
          <button
            type="button"
            className="lib-card-hover-btn"
            onClick={(event) => {
              event.stopPropagation();
              actions.onCopyPrompt?.();
            }}
            title={actions.copied ? 'Copied' : actions.copyLabel || 'Copy prompt'}
            aria-label={actions.copied ? 'Copied' : actions.copyLabel || 'Copy prompt'}
          >
            {actions.copied ? (
              <IconCheck width={13} height={13} aria-hidden="true" />
            ) : (
              <IconCopy width={13} height={13} aria-hidden="true" />
            )}
          </button>
        ) : null}

        {actions.onDelete ? (
          <>
            <span className="lib-card-toolbar-sep" aria-hidden="true" />
            <button
              type="button"
              className="lib-card-hover-btn is-danger"
              data-testid={`media-delete-${item.id}`}
              onClick={(event) => {
                event.stopPropagation();
                actions.onDelete?.();
              }}
              title={actions.deleteLabel}
              aria-label={actions.deleteLabel}
            >
              <IconTrash width={13} height={13} aria-hidden="true" />
            </button>
          </>
        ) : null}
        </div>
      </div>
    </article>
  );
}
