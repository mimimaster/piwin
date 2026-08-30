import type { ReactElement } from 'react';
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
  isBatchMode?: boolean | undefined;
  isSelected?: boolean | undefined;
  isActive?: boolean | undefined;
  kind?: 'image' | 'video' | 'file' | undefined;
};

export type LibraryMediaCardActions = {
  onOpen: () => void;
  onDelete?: (() => void) | undefined;
  deleteLabel: string;
  onImageError?: (() => void) | undefined;
  onCopyPrompt?: (() => void) | undefined;
  copyLabel?: string | undefined;
  copied?: boolean | undefined;
  onToggleFavorite?: (() => void) | undefined;
  onToggleSelect?: (() => void) | undefined;
  onRemix?: (() => void) | undefined;
  onOpenLightbox?: (() => void) | undefined;
};

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
        className={`lib-row-card${hasThumb ? '' : ' is-wait'}${item.isActive ? ' is-active' : ''}${isVideo ? ' is-video' : ''}`}
      >
        {item.isBatchMode ? (
          <input
            type="checkbox"
            className="lib-batch-checkbox"
            checked={Boolean(item.isSelected)}
            onChange={(e) => {
              e.stopPropagation();
              actions.onToggleSelect?.();
            }}
            aria-label="Select item"
          />
        ) : null}

        <button
          type="button"
          className="lib-row-open"
          data-testid={item.testId}
          onClick={actions.onOpen}
          aria-label={item.alt}
        >
          <span className="lib-row-thumb">
            {hasThumb ? (
              isVideo ? (
                <video
                  src={`${item.imageUrl}#t=0.001`}
                  className="lib-row-img is-video"
                  preload="metadata"
                  muted
                  playsInline
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
              title={item.favorite ? 'Favorited' : 'Favorite'}
              aria-label={item.favorite ? 'Favorited' : 'Favorite'}
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
      className={`lib-card${hasThumb ? '' : ' is-wait'}${item.isActive ? ' is-active' : ''}${isVideo ? ' is-video' : ''}`}
    >
      <button
        type="button"
        className="lib-card-open"
        data-testid={item.testId}
        onClick={actions.onOpen}
        aria-label={item.alt}
      >
        <span className="lib-card-thumb">
          {hasThumb ? (
            isVideo ? (
              <video
                src={`${item.imageUrl}#t=0.001`}
                className="lib-card-img is-video"
                preload="metadata"
                muted
                playsInline
                loop
                onError={actions.onImageError}
                onMouseEnter={(e) => {
                  e.currentTarget.play().catch(() => {});
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = 0.001;
                }}
              />
            ) : (
              <img
                src={item.imageUrl}
                alt=""
                className="lib-card-img"
                decoding="async"
                loading="lazy"
                onError={actions.onImageError}
              />
            )
          ) : (
            <span className="lib-card-wait" aria-hidden="true" />
          )}

          {item.model ? (
            <span className="lib-card-model-badge">{item.model}</span>
          ) : null}

          {item.showPlayOverlay === true ? (
            <span className="lib-card-play" aria-hidden="true">
              <IconPlay width={12} height={12} />
            </span>
          ) : null}
        </span>

        <span className="lib-card-overlay">
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
                <span>全屏</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>

      {/* Top right floating overlay bar */}
      <div className="lib-card-overlay-bar">
        {item.isBatchMode ? (
          <input
            type="checkbox"
            className="lib-card-batch-cb"
            checked={Boolean(item.isSelected)}
            onChange={(e) => {
              e.stopPropagation();
              actions.onToggleSelect?.();
            }}
            aria-label="Select card"
          />
        ) : actions.onToggleFavorite ? (
          <button
            type="button"
            className={`lib-card-hover-btn${item.favorite ? ' is-favorite' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              actions.onToggleFavorite?.();
            }}
            title={item.favorite ? 'Favorited' : 'Favorite'}
            aria-label={item.favorite ? 'Favorited' : 'Favorite'}
          >
            <IconStar width={13} height={13} aria-hidden="true" />
          </button>
        ) : null}

        {actions.onRemix && item.prompt ? (
          <button
            type="button"
            className="lib-card-hover-btn"
            onClick={(event) => {
              event.stopPropagation();
              actions.onRemix?.();
            }}
            title="在会话中重绘 (Remix)"
            aria-label="在会话中重绘 (Remix)"
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
        ) : null}
      </div>
    </article>
  );
}
