/**
 * One 资料库 grid cell: poster frame, title, date/size, and a star.
 *
 * The tile itself is the button; the star is a sibling so a nested-interactive
 * control never sits inside another button.
 */
import type { ReactElement } from 'react';
import type { MediaLibraryItem } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Icon, type InkstoneIconName } from '../icons.js';
import { libraryItemMeta, libraryItemTitle } from './library-model.js';
import { useLibraryThumb } from './use-media-reads.js';

export type LibraryTileProps = {
  client: HostClient | undefined;
  item: MediaLibraryItem;
  favorited: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
};

export function LibraryTile(props: LibraryTileProps): ReactElement {
  const { item } = props;
  const title = libraryItemTitle(item);
  const thumb = useLibraryThumb(props.client, item);
  const iconName: InkstoneIconName = item.kind === 'file' ? 'file' : 'image';

  return (
    <article className="lib-card" data-kind={item.kind}>
      <button
        type="button"
        className="lib-card-open"
        onClick={props.onOpen}
        aria-label={`打开 ${title}`}
      >
        <span className="lib-thumb" ref={thumb.attachRef}>
          {thumb.src !== undefined ? (
            <img src={thumb.src} alt="" decoding="async" />
          ) : (
            <span className="lib-thumb-placeholder" data-loading={thumb.loading ? 'true' : 'false'}>
              <Icon name={iconName} />
            </span>
          )}
          {item.kind === 'video' ? <span className="lib-badge">视频</span> : null}
          {item.kind === 'file' ? (
            <span className="lib-badge">{shortMime(item.mimeType)}</span>
          ) : null}
        </span>
        <span className="lib-card-body">
          <strong>{title}</strong>
          <small>{libraryItemMeta(item)}</small>
        </span>
      </button>
      <button
        type="button"
        className="lib-star"
        aria-pressed={props.favorited}
        aria-label={props.favorited ? `取消收藏 ${title}` : `收藏 ${title}`}
        onClick={props.onToggleFavorite}
      >
        <Icon name="star" />
      </button>
    </article>
  );
}

/** `application/pdf` → PDF; anything unknown keeps its subtype. */
function shortMime(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? mimeType;
  const cleaned = subtype.replace(/^.*\+/u, '').toUpperCase();
  return cleaned.length > 0 ? cleaned.slice(0, 6) : 'FILE';
}
