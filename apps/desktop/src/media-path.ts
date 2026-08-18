/**
 * Pure media-reference helpers shared by Doc Preview routing and media viewers.
 *
 * Read authority is decided by STORE IDENTITY (piwin media vault path or an
 * opaque remote-asset ref), never by file extension — extensions only pick a
 * renderer inside the media viewer (ADR 0052).
 */

/** Prefix the host-server remote projection substitutes for vault paths. */
export const REMOTE_MEDIA_ASSET_PREFIX = 'remote-asset:';

/**
 * True for paths that live in a piwin media store (`~/.piwin/media/<sessionId>/…`
 * plus test fixtures). Gates which strings may be turned into asset URLs —
 * never convert arbitrary model/path strings.
 */
export function isPiwinMediaPath(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  return (
    normalized.includes('/.piwin/media/') ||
    normalized.includes('/piwin-mock-media/') ||
    /\/media\/[A-Za-z0-9._-]+\//.test(normalized)
  );
}

/** True for opaque `remote-asset:<id>` refs emitted by the remote projection. */
export function isRemoteMediaAssetRef(value: string): boolean {
  return value.startsWith(REMOTE_MEDIA_ASSET_PREFIX) &&
    value.length > REMOTE_MEDIA_ASSET_PREFIX.length;
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);

/**
 * True when a Markdown image/video src is a host filesystem path. Webview will
 * not load these, and generated media is already shown as a message attachment.
 */
export function isLocalFilesystemMarkdownMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) {
    return false;
  }
  const withoutFileScheme = stripFileUrlPrefix(trimmed);
  if (withoutFileScheme.startsWith('~/.piwin/media/') || withoutFileScheme.startsWith('~\\.piwin\\media\\')) {
    return true;
  }
  if (isPiwinMediaPath(withoutFileScheme) || isRemoteMediaAssetRef(withoutFileScheme)) {
    return true;
  }
  const kind = mediaKindForPath(withoutFileScheme);
  if (kind !== 'image' && kind !== 'video') {
    return false;
  }
  if (/^\/(?:Users|home|private|tmp|var)\//.test(withoutFileScheme)) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(withoutFileScheme);
}

function stripFileUrlPrefix(src: string): string {
  if (!src.startsWith('file:')) {
    return src;
  }
  const withoutScheme = src.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

/** Rendering hint only: which media viewer surface should display this path. */
export function mediaKindForPath(path: string): 'image' | 'video' | null {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path.replace(/[#?].*$/, ''));
  const ext = extMatch?.[1]?.toLowerCase();
  if (!ext) {
    return null;
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  return null;
}
