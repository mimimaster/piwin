/**
 * Bounded media byte reads for the phone library.
 *
 * The phone never gets a vault path: thumbnails and previews come back as
 * base64 through `media/read`, which is why every read here is either the
 * thumb sidecar or an original already inside the wire-safe budget. Video
 * playback is NOT part of the public contract — a video tile shows its poster
 * frame and says so instead of pretending to play.
 */
import {
  MEDIA_READ_WIRE_SAFE_BYTES,
  type HostResponse,
  type MediaLibraryItem,
  type MediaReadData,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';

/** Grid cells are ~170 CSS px wide; 384 covers a 2x phone screen. */
const THUMB_EDGE = 384;
/** ~40 KB per cached WebP: enough for a few phone screens of tiles. */
const THUMB_CACHE_LIMIT = 160;

const thumbCache = new Map<string, string>();

export type LibraryMediaRead =
  | { status: 'ready'; src: string }
  | { status: 'unavailable'; reason: LibraryMediaUnavailable };

export type LibraryMediaUnavailable = 'too-large' | 'missing' | 'disconnected' | 'video';

/**
 * One `media/read` at a time. Each reply is a base64 frame on the same Host
 * socket as pushes and run events, so a grid scroll must not queue 24 reads.
 */
let mediaReadChain: Promise<unknown> = Promise.resolve();

function serializeMediaRead<T>(task: () => Promise<T>): Promise<T> {
  const run = mediaReadChain.then(task, task);
  mediaReadChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function libraryThumbKey(item: Pick<MediaLibraryItem, 'assetId' | 'sessionId' | 'mimeType'>): string {
  return `${item.sessionId}:${item.assetId}:${item.mimeType}`;
}

export function peekLibraryThumb(item: MediaLibraryItem): string | undefined {
  return thumbCache.get(libraryThumbKey(item));
}

function rememberThumb(key: string, src: string): void {
  thumbCache.set(key, src);
  while (thumbCache.size > THUMB_CACHE_LIMIT) {
    const oldest = thumbCache.keys().next();
    if (oldest.done === true) break;
    thumbCache.delete(oldest.value);
  }
}

/** Grid poster: the 384px WebP sidecar, else a small original as fallback. */
export async function readLibraryThumb(
  client: HostClient | undefined,
  item: MediaLibraryItem,
): Promise<LibraryMediaRead> {
  const key = libraryThumbKey(item);
  const cached = thumbCache.get(key);
  if (cached !== undefined) return { status: 'ready', src: cached };
  if (client === undefined) return { status: 'unavailable', reason: 'disconnected' };

  const thumb = await readMedia(client, item, 'thumb');
  if (thumb.status === 'ready') {
    rememberThumb(key, thumb.src);
    return thumb;
  }
  if (canPreviewOriginal(item)) {
    const original = await readMedia(client, item, 'full');
    if (original.status === 'ready') {
      rememberThumb(key, original.src);
      return original;
    }
    return original;
  }
  return thumb;
}

/**
 * Full preview for the viewer. Videos stay poster-only (no playback channel),
 * and an original over the wire budget keeps its thumb with an explicit note.
 */
export async function readLibraryFull(
  client: HostClient | undefined,
  item: MediaLibraryItem,
): Promise<LibraryMediaRead> {
  if (item.kind === 'video') return { status: 'unavailable', reason: 'video' };
  if (client === undefined) return { status: 'unavailable', reason: 'disconnected' };
  if (!canPreviewOriginal(item)) {
    const thumb = await readLibraryThumb(client, item);
    return thumb.status === 'ready' ? thumb : { status: 'unavailable', reason: 'too-large' };
  }
  return readMedia(client, item, 'full');
}

/** Originals larger than the wire cap cannot travel whole; the Host says `too-large`. */
export function canPreviewOriginal(item: MediaLibraryItem): boolean {
  return item.kind !== 'video' && item.byteSize > 0 && item.byteSize <= MEDIA_READ_WIRE_SAFE_BYTES;
}

async function readMedia(
  client: HostClient,
  item: MediaLibraryItem,
  variant: 'thumb' | 'full',
): Promise<LibraryMediaRead> {
  return serializeMediaRead(async () => {
    let response: HostResponse;
    try {
      response = await client.request({
        type: 'media/read',
        input: {
          sessionId: item.sessionId,
          assetId: item.assetId,
          variant,
          ...(variant === 'thumb' ? { thumbEdge: THUMB_EDGE } : {}),
        },
      });
    } catch {
      return { status: 'unavailable', reason: 'disconnected' } as const;
    }
    return parseMediaRead(response);
  });
}

function parseMediaRead(response: HostResponse): LibraryMediaRead {
  if (!response.success) return { status: 'unavailable', reason: 'missing' };
  const data = response.data as MediaReadData | undefined;
  if (data === undefined || data.status !== 'ready') return { status: 'unavailable', reason: 'missing' };
  if (typeof data.base64Data !== 'string' || data.base64Data.length === 0) {
    return { status: 'unavailable', reason: 'missing' };
  }
  if (typeof data.mimeType !== 'string' || data.mimeType.length === 0) {
    return { status: 'unavailable', reason: 'missing' };
  }
  return { status: 'ready', src: `data:${data.mimeType};base64,${data.base64Data}` };
}

export function describeLibraryMediaUnavailable(reason: LibraryMediaUnavailable): string {
  if (reason === 'video') return 'Host 暂不提供视频播放，这里显示封面。';
  if (reason === 'too-large') return '原图超出单帧传输上限，这里显示缩略图。';
  if (reason === 'disconnected') return '与 Host 的连接已断开，重新连上后再打开。';
  return 'Host 上已读不到这个素材，可能已被删除。';
}
