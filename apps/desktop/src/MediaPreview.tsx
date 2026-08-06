import { useEffect, useState } from 'react';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { resolveMediaPreviewUrl } from './media-utils';

export function MediaPreview(props: {
  attachment: MediaAttachmentRef;
  previewUrl?: string;
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(props.previewUrl ?? null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
    if (props.previewUrl) {
      setUrl(props.previewUrl);
      return;
    }
    let cancelled = false;
    void resolveMediaPreviewUrl(props.attachment.path).then((resolved) => {
      if (!cancelled) {
        setUrl(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.attachment.path, props.previewUrl]);

  if (!url || loadFailed) {
    return (
      <div className={props.compact ? 'media-chip-fallback' : 'media-preview-fallback'}>
        {props.attachment.mimeType} · {props.attachment.byteSize}B
        {loadFailed ? ' · preview failed' : ''}
      </div>
    );
  }

  if (props.attachment.mimeType.toLowerCase().startsWith('video/')) {
    return (
      <video
        className={props.compact ? 'media-chip-video' : 'media-preview-video'}
        src={url}
        controls
        preload="metadata"
        playsInline
        aria-label={props.attachment.path.split('/').pop() ?? 'video attachment'}
        onError={() => setLoadFailed(true)}
      />
    );
  }

  return (
    <img
      className={props.compact ? 'media-chip-thumb' : 'media-preview-image'}
      src={url}
      alt={props.attachment.path.split('/').pop() ?? 'attachment'}
      onError={() => setLoadFailed(true)}
    />
  );
}
