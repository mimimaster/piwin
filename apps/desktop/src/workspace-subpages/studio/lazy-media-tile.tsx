import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  pickMediaThumbEdge,
  type HostCommand,
  type HostResponse,
  type MediaLibraryItem,
} from '@piwin/contracts';
import { LibraryMediaCard } from './library-media-card';
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
  onOpen: () => void;
  onDelete: () => void;
  viewMode?: 'grid' | 'list';
  onCopyPrompt?: () => void;
  copyLabel?: string;
  copied?: boolean;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  isBatchMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isActive?: boolean;
  onRemix?: () => void;
  onOpenLightbox?: () => void;
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
          { request },
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
      }
      if (original) {
        if (!cancelled) {
          dropOwned();
          setThumbUrl(original);
        }
        return;
      }

      const full = await readLibraryMediaViaHost(
        { request },
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
    request,
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

  return (
    <div ref={rootRef}>
      <LibraryMediaCard
        item={{
          id: item.assetId,
          testId: `${item.kind}-card-${item.assetId}`,
          imageUrl: thumbUrl,
          alt: item.prompt?.trim()
            ? item.prompt
            : item.kind === 'image'
              ? '图像素材'
              : '视频素材',
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
          isBatchMode: props.isBatchMode,
          isSelected: props.isSelected,
          isActive: props.isActive,
        }}
        actions={{
          onOpen: props.onOpen,
          onDelete: props.onDelete,
          deleteLabel: props.deleteLabel,
          onCopyPrompt: props.onCopyPrompt,
          copyLabel: props.copyLabel,
          copied: props.copied,
          onToggleFavorite: props.onToggleFavorite,
          onToggleSelect: props.onToggleSelect,
          onRemix: props.onRemix,
          onOpenLightbox: props.onOpenLightbox,
          onImageError: () => {
            if (!localFailed) {
              setLocalFailed(true);
              setThumbUrl('');
            }
          },
        }}
      />
    </div>
  );
}
