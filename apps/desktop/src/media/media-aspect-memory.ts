/**
 * Image proportions for first-frame space: a hero image whose height is
 * `auto` is 0px until it decodes, and the turn then grows under the reader.
 * The attachment's own width/height wins; otherwise the size seen on the
 * last load is remembered (in localStorage, so a restart keeps it).
 */
import type { MediaAttachmentRef } from '@piwin/contracts';
import { createPresentationStore } from '../conversation/presentation-storage.js';

export const MEDIA_ASPECT_STORAGE_KEY = 'piwin.desktop.mediaAspect.v1';
export const MAX_REMEMBERED_MEDIA_ASPECTS = 300;
const MAX_ID_LENGTH = 256;

export type MediaAspect = { width: number; height: number };

const store = createPresentationStore('Image sizes');
let remembered: Map<string, MediaAspect> | null = null;

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000;
}

function rememberedAspects(): Map<string, MediaAspect> {
  if (remembered) return remembered;
  remembered = new Map();
  const storage = store.defaultStorage();
  const parsed = storage ? store.readJson(storage, MEDIA_ASPECT_STORAGE_KEY) : undefined;
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        entry[0].length > 0 &&
        entry[0].length <= MAX_ID_LENGTH &&
        isDimension(entry[1]) &&
        isDimension(entry[2])
      ) {
        remembered.set(entry[0], { width: entry[1], height: entry[2] });
      }
    }
  }
  return remembered;
}

export function readMediaAspect(
  attachment: Pick<MediaAttachmentRef, 'id' | 'width' | 'height'>,
): MediaAspect | null {
  if (isDimension(attachment.width) && isDimension(attachment.height)) {
    return { width: attachment.width, height: attachment.height };
  }
  return rememberedAspects().get(attachment.id) ?? null;
}

/** Note a decoded image's natural size for the next time it mounts. */
export function rememberMediaAspect(attachmentId: string, width: number, height: number): void {
  if (!isDimension(width) || !isDimension(height) || attachmentId.length > MAX_ID_LENGTH) return;
  const aspects = rememberedAspects();
  const previous = aspects.get(attachmentId);
  if (previous && previous.width * height === previous.height * width) return;
  aspects.delete(attachmentId);
  aspects.set(attachmentId, { width, height });
  for (const oldest of aspects.keys()) {
    if (aspects.size <= MAX_REMEMBERED_MEDIA_ASPECTS) break;
    aspects.delete(oldest);
  }
  const storage = store.defaultStorage();
  if (storage) {
    store.writeJson(
      storage,
      MEDIA_ASPECT_STORAGE_KEY,
      Array.from(aspects, ([id, aspect]) => [id, aspect.width, aspect.height]),
    );
  }
}

export function clearMediaAspectsForTests(): void {
  remembered = null;
  const storage = store.defaultStorage();
  if (storage) store.writeJson(storage, MEDIA_ASPECT_STORAGE_KEY, null);
}
