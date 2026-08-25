import type { ReactElement } from 'react';
import {
  IconCheck,
  IconChat,
  IconCopy,
  IconExpand,
  IconPlay,
  IconTrash,
} from '../../shell-icons';

export type MediaGalleryCardModel = {
  id: string;
  testId: string;
  /** Poster/thumbnail source (already resolved). */
  imageUrl: string;
  alt: string;
  aspectClass: string;
  badgeTopLeft: string;
  badgeTopRight: string;
  metaPrimary: string;
  metaSecondary: string;
  showPlayOverlay?: boolean;
};

export type MediaGalleryCardActions = {
  copied: boolean;
  onOpen: () => void;
  onCopyPrompt: () => void;
  onRemixInChat: () => void;
  onDelete: () => void;
};

/**
 * One gallery tile in the studio canvas. Hover reveals the action row;
 * clicking anywhere else opens the lightbox/theater.
 */
export function MediaGalleryCard(props: {
  item: MediaGalleryCardModel;
  actions: MediaGalleryCardActions;
}): ReactElement {
  const { item, actions } = props;
  return (
    <figure className="media-card" data-testid={item.testId} onClick={actions.onOpen}>
      <div className={`media-card-thumb ${item.aspectClass}`}>
        <img src={item.imageUrl} alt={item.alt} className="media-card-img" loading="lazy" />
        <span className="media-card-badge is-left">{item.badgeTopLeft}</span>
        <span className="media-card-badge is-right">{item.badgeTopRight}</span>
        {item.showPlayOverlay === true && (
          <span className="media-card-play">
            <IconPlay width={16} height={16} />
          </span>
        )}
        <div
          className="media-card-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="media-card-action-btn"
            onClick={actions.onCopyPrompt}
            title="Copy prompt"
          >
            {actions.copied ? (
              <IconCheck width={13} height={13} />
            ) : (
              <IconCopy width={13} height={13} />
            )}
          </button>
          <button
            type="button"
            className="media-card-action-btn"
            onClick={actions.onRemixInChat}
            title="Remix in chat"
          >
            <IconChat width={13} height={13} />
          </button>
          <button
            type="button"
            className="media-card-action-btn"
            onClick={actions.onOpen}
            title="Expand"
          >
            <IconExpand width={13} height={13} />
          </button>
          <button
            type="button"
            className="media-card-action-btn"
            onClick={actions.onDelete}
            title="Delete"
          >
            <IconTrash width={13} height={13} />
          </button>
        </div>
      </div>
      <figcaption className="media-card-footer">
        <p className="media-card-prompt" title={item.alt}>
          {item.alt}
        </p>
        <div className="media-card-meta">
          <span>{item.metaPrimary}</span>
          <span>{item.metaSecondary}</span>
        </div>
      </figcaption>
    </figure>
  );
}
