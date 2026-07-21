import { useEffect, useState } from 'react';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { resolveMediaPreviewUrl } from './media-utils';

export function MediaPreview(props: {
  attachment: MediaAttachmentRef;
  previewUrl?: string;
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(props.previewUrl ?? null);

  useEffect(() => {
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

  if (!url) {
    return (
      <div className={props.compact ? 'media-chip-fallback' : 'media-preview-fallback'}>
        {props.attachment.mimeType} · {props.attachment.byteSize}B
      </div>
    );
  }

  return (
    <img
      className={props.compact ? 'media-chip-thumb' : 'media-preview-image'}
      src={url}
      alt={props.attachment.path.split('/').pop() ?? 'attachment'}
    />
  );
}
