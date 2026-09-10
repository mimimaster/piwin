import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import {
  pickMediaThumbEdge,
  type HostCommand,
  type HostResponse,
  type MediaLibraryItem,
} from '@piwin/contracts';
import { LibraryMediaCard } from './library-media-card';
import { MediaImageContextMenu } from '../../media-image-context-menu';
import { buildLibraryMediaImageTarget } from '../../media-image-target';
import { formatLibraryBytes, formatLibraryItemTitle, formatLibraryType } from './media-format';
import { localThumbPathForItem } from './local-media-tile-src';
import { createPlayableMediaObjectUrl } from '../../playable-media-url';
import { readLibraryMediaViaHost } from './media-library-src';
import { useLocalMediaSrc } from './use-local-media-src';

export type LazyMediaTileProps = {
  item: MediaLibraryItem;
  request: (command: HostCommand) => Promise<HostResponse>;
  locale: string;
  deleteLabel: string;
  /** Receives the click so the caller can branch on ⌘/Ctrl/Shift. */
  onOpen: (event?: ReactMouseEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
  viewMode?: 'grid' | 'list';
  onCopyPrompt?: () => void;
  copyLabel?: string;
  copied?: boolean;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** See {@link import('./library-media-card.js').LibraryMediaCardModel.selectionActive}. */
  selectionActive?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isActive?: boolean;
  onFocus?: () => void;
  onRemix?: () => void;
  onOpenLightbox?: () => void;
  onAfterAddToChat?: () => void;
  favoriteLabel?: string;
  favoritedLabel?: string;
  selectLabel?: string;
  remixLabel?: string;
  fullscreenLabel?: string;
  showModel?: boolean;
  thumbFit?: 'cover' | 'contain';
};

/**
 * Gallery tile that attaches a preview only while on screen.
 * Prefers the vault WebP sidecar; if that is missing or 404s, reads via Host
 * (thumb, then original). Guessing a sidecar path is not treated as success.
 */
export function LazyMediaTile(props: LazyMediaTileProps): ReactElement {
  const { item, request } = props;
  const resolveSrc = useLocalMediaSrc();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const [visible, setVisible] = useState(false);
  const [thumbUrl, setThumbUrl] = useState('');
  const [localFailed, setLocalFailed] = useState(false);
  const ownedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries[0]?.isIntersecting === true);
      },
      { rootMargin: '320px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Workbench passes a new `request` lambda every render. Keep it off the
  // dep list — rebuilding the object URL retargets <video src> and flashes.
  useEffect(() => {
    let cancelled = false;
    const dropOwned = () => {
      if (ownedUrlRef.current) {
        URL.revokeObjectURL(ownedUrlRef.current);
        ownedUrlRef.current = null;
      }
    };
    if (!visible) {
      dropOwned();
      setThumbUrl('');
      return;
    }

    void (async () => {
      const cssPx = rootRef.current?.getBoundingClientRect().width ?? 220;
      const edge = pickMediaThumbEdge(
        cssPx,
        typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      );

      if (item.kind === 'image' && !localFailed) {
        const localPath = localThumbPathForItem(item, edge);
        const local = localPath ? resolveSrc(localPath, '') : '';
        if (local) {
          if (!cancelled) {
            dropOwned();
            setThumbUrl(local);
          }
          return;
        }
      }

      if (item.kind === 'image') {
        const thumb = await readLibraryMediaViaHost(
          { request: (command) => requestRef.current(command) },
          { sessionId: item.sessionId, assetId: item.assetId, variant: 'thumb', thumbEdge: edge },
        );
        if (cancelled) {
          if (thumb) URL.revokeObjectURL(thumb);
          return;
        }
        if (thumb) {
          dropOwned();
          ownedUrlRef.current = thumb;
          setThumbUrl(thumb);
          return;
        }
      }

      const originalPath = item.absolutePath ?? '';
      const original = originalPath ? resolveSrc(originalPath, '') : '';
      if (original && item.kind === 'video') {
        const playable = await createPlayableMediaObjectUrl(original, item.mimeType);
        if (cancelled) {
          if (playable) URL.revokeObjectURL(playable);
          return;
        }
        if (playable) {
          dropOwned();
          ownedUrlRef.current = playable;
          setThumbUrl(playable);
          return;
        }
      } else if (original) {
        if (!cancelled) {
          dropOwned();
          setThumbUrl(original);
        }
        return;
      }

      const full = await readLibraryMediaViaHost(
        { request: (command) => requestRef.current(command) },
        { sessionId: item.sessionId, assetId: item.assetId, variant: 'full' },
      );
      if (cancelled) {
        if (full) URL.revokeObjectURL(full);
        return;
      }
      if (full) {
        dropOwned();
        ownedUrlRef.current = full;
        setThumbUrl(full);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    visible,
    localFailed,
    item.kind,
    item.hasThumb,
    item.absolutePath,
    item.thumbAbsolutePath,
    item.sessionId,
    item.assetId,
    resolveSrc,
  ]);

  useEffect(() => {
    return () => {
      if (ownedUrlRef.current) {
        URL.revokeObjectURL(ownedUrlRef.current);
        ownedUrlRef.current = null;
      }
    };
  }, []);

  const card = (
    <LibraryMediaCard
      item={{
        id: item.assetId,
        testId: `${item.kind}-card-${item.assetId}`,
        imageUrl: thumbUrl,
        alt: item.prompt?.trim()
          ? item.prompt
          : item.kind === 'image'
            ? (props.locale === 'zh-CN' ? '图像素材' : 'Image asset')
            : (props.locale === 'zh-CN' ? '视频素材' : 'Video asset'),
        name: formatLibraryItemTitle(item, props.locale),
        typeLabel: formatLibraryType(item.mimeType),
        size: formatLibraryBytes(item.byteSize),
        showPlayOverlay: item.kind === 'video',
        kind: item.kind,
        prompt: item.prompt,
        model: item.model,
        createdAt: item.createdAt,
        viewMode: props.viewMode,
        favorite: props.favorite,
        selectionActive: props.selectionActive,
        isSelected: props.isSelected,
        isActive: props.isActive,
        showModel: props.showModel,
        thumbFit: props.thumbFit,
      }}
      actions={{
        onOpen: props.onOpen,
        onFocus: props.onFocus,
        onDelete: props.onDelete,
        deleteLabel: props.deleteLabel,
        onCopyPrompt: props.onCopyPrompt,
        copyLabel: props.copyLabel,
        copied: props.copied,
        onToggleFavorite: props.onToggleFavorite,
        favoriteLabel: props.favoriteLabel,
        favoritedLabel: props.favoritedLabel,
        selectLabel: props.selectLabel,
        onToggleSelect: props.onToggleSelect,
        onRemix: props.onRemix,
        remixLabel: props.remixLabel,
        onOpenLightbox: props.onOpenLightbox,
        fullscreenLabel: props.fullscreenLabel,
        onImageError: () => {
          if (!localFailed) {
            setLocalFailed(true);
            setThumbUrl('');
          }
        },
      }}
    />
  );

  return (
    <div ref={rootRef}>
      {item.kind === 'image' ? (
        <MediaImageContextMenu
          target={buildLibraryMediaImageTarget(item)}
          onOpen={props.onOpenLightbox ?? props.onOpen}
          loadOriginalUrl={() =>
            readLibraryMediaViaHost(
              { request: (command) => requestRef.current(command) },
              { sessionId: item.sessionId, assetId: item.assetId, variant: 'full' },
            )
          }
          {...(props.onAfterAddToChat ? { onAfterAddToChat: props.onAfterAddToChat } : {})}
        >
          <div>{card}</div>
        </MediaImageContextMenu>
      ) : (
        card
      )}
    </div>
  );
}
