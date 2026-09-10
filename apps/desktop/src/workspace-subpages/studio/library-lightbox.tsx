import type { ReactElement } from 'react';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale';
import { IconFile } from '../../shell-icons';
import { MediaImageContextMenu } from '../../media-image-context-menu';
import { buildLibraryMediaImageTarget } from '../../media-image-target';
import { MediaLightbox } from './media-lightbox';
import { usePlayableLibrarySrc } from './use-playable-library-src';

export type LibraryLightboxProps = {
  item: MediaLibraryItem;
  request: (command: HostCommand) => Promise<HostResponse>;
  locale?: DesktopLocale;
  resolveSrc: (localPath: string, fallbackUrl: string) => string;
  copied: boolean;
  onClose: () => void;
  onCopyPrompt: () => void;
  onDelete: () => void;
  onRemix?: (() => void) | undefined;
  onAfterAddToChat?: (() => void) | undefined;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  currentIndex?: number | undefined;
  totalCount?: number | undefined;
};

export function LibraryLightbox(props: LibraryLightboxProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const localSrc = props.item.absolutePath ? props.resolveSrc(props.item.absolutePath, '') : '';
  const src = usePlayableLibrarySrc({
    item: props.item,
    localSrc,
    request: props.request,
  });
  const fileName = props.item.name?.trim() || props.item.assetId;
  const media =
    props.item.kind === 'video' ? (
      <div className="vault-video-theater-wrapper">
        <video
          key={`${props.item.sessionId}:${props.item.assetId}`}
          src={src || undefined}
          controls
          playsInline
          preload="metadata"
          className="vault-video-theater-player"
        />
      </div>
    ) : props.item.kind === 'image' ? (
      src ? (
        <MediaImageContextMenu
          target={buildLibraryMediaImageTarget(props.item, { inLightbox: true, srcUrl: src })}
          {...(props.onAfterAddToChat ? { onAfterAddToChat: props.onAfterAddToChat } : {})}
        >
          <div className="media-lightbox-image-hit">
            <img
              key={`${props.item.sessionId}:${props.item.assetId}`}
              src={src}
              alt={props.item.prompt ?? props.item.assetId}
              className="vault-image-theater-player"
            />
          </div>
        </MediaImageContextMenu>
      ) : (
        <div className="lib-card-wait" />
      )
    ) : (
      <div className="lib-file-preview">
        <IconFile width={36} height={36} aria-hidden="true" />
        <strong>{fileName}</strong>
        {src ? (
          <a href={src} download={fileName} className="lib-file-download">
            {t('Download file', '下载文件')}
          </a>
        ) : null}
      </div>
    );

  return (
    <MediaLightbox
      testId={
        props.item.kind === 'image'
          ? 'images-lightbox'
          : props.item.kind === 'video'
            ? 'videos-theater'
            : 'library-file-lightbox'
      }
      title={
        props.item.kind === 'image'
          ? t('Image details', '图片详情')
          : props.item.kind === 'video'
            ? t('Video details', '视频详情')
            : t('File details', '文件详情')
      }
      onClose={props.onClose}
      media={media}
      promptLabel={t('Prompt', '提示词')}
      prompt={props.item.prompt ?? fileName}
      stats={[
        { label: t('Created', '时间'), value: formatWhen(props.item.createdAt) },
        { label: t('Model', '模型'), value: props.item.model ?? '—' },
        { label: t('Type', '类型'), value: props.item.mimeType },
      ]}
      copyLabel={t('Copy prompt', '复制提示词')}
      copiedLabel={t('Copied', '已复制')}
      deleteLabel={t('Delete', '删除')}
      {...(props.onRemix !== undefined ? { onRemix: props.onRemix } : {})}
      remixLabel={t('Remix in Chat', '在会话中重绘')}
      copied={props.copied}
      onCopyPrompt={props.onCopyPrompt}
      {...(props.onDelete !== undefined ? { onDelete: props.onDelete } : {})}
      {...(props.onPrev !== undefined ? { onPrev: props.onPrev } : {})}
      {...(props.onNext !== undefined ? { onNext: props.onNext } : {})}
      {...(props.currentIndex !== undefined ? { currentIndex: props.currentIndex } : {})}
      {...(props.totalCount !== undefined ? { totalCount: props.totalCount } : {})}
    />
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString();
}
