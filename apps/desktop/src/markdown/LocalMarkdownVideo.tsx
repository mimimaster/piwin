import { useEffect, useState, type ReactElement } from 'react';
import { createPlayableMediaObjectUrl } from '../artifact/playable-media-url.js';

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** Plays a host video referenced from Markdown; asset: URLs lack Range support, so go through a blob. */
export function LocalMarkdownVideo({
  assetSrc,
  path,
  label,
}: {
  assetSrc: string;
  path: string;
  label: string;
}): ReactElement {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    void createPlayableMediaObjectUrl(assetSrc, VIDEO_MIME_BY_EXT[ext] ?? 'video/mp4').then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      created = url;
      if (url) setBlobUrl(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [assetSrc, path]);

  if (failed) {
    return <span className="md-image-fallback">{label || 'Video unavailable'}</span>;
  }
  if (!blobUrl) {
    return <span className="md-image-fallback">{label || 'Loading video…'}</span>;
  }
  return <video src={blobUrl} controls preload="metadata" style={{ maxWidth: '100%' }} />;
}
