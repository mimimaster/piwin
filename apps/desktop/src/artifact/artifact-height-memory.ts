/**
 * Inline artifact heights seen last time, so a remounted frame (switching
 * back to a session, a restart) starts at its real height instead of the
 * bootstrap guess and its turn does not grow once the document reports in.
 * Keyed by artifact id (message + fence ordinal) and column width; final
 * documents only — a stream preview is still changing size.
 */
import { createPresentationStore } from '../conversation/presentation-storage.js';

export const ARTIFACT_HEIGHT_STORAGE_KEY = 'piwin.desktop.artifactHeights.v1';
export const MAX_REMEMBERED_ARTIFACT_HEIGHTS = 200;
/** Text inside the frame re-wraps at another width; a pixel of rounding does not. */
const WIDTH_TOLERANCE_PX = 2;
const MAX_ID_LENGTH = 256;
const MAX_HEIGHT_PX = 32_000;

type RememberedHeight = { widthPx: number | null; height: number };

const store = createPresentationStore('Artifact heights');
let remembered: Map<string, RememberedHeight> | null = null;

function isHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_HEIGHT_PX;
}

function rememberedHeights(): Map<string, RememberedHeight> {
  if (remembered) return remembered;
  remembered = new Map();
  const storage = store.defaultStorage();
  const parsed = storage ? store.readJson(storage, ARTIFACT_HEIGHT_STORAGE_KEY) : undefined;
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        entry[0].length > 0 &&
        entry[0].length <= MAX_ID_LENGTH &&
        (entry[1] === null || isHeight(entry[1])) &&
        isHeight(entry[2])
      ) {
        remembered.set(entry[0], { widthPx: entry[1] as number | null, height: entry[2] });
      }
    }
  }
  return remembered;
}

/** `widthPx` null (not measured yet) accepts any stored width. */
export function readRememberedArtifactHeight(
  artifactId: string,
  widthPx: number | null,
): number | null {
  const entry = rememberedHeights().get(artifactId);
  if (!entry) return null;
  if (widthPx !== null && entry.widthPx !== null && Math.abs(entry.widthPx - widthPx) > WIDTH_TOLERANCE_PX) {
    return null;
  }
  return entry.height;
}

export function rememberArtifactHeight(
  artifactId: string,
  widthPx: number | null,
  height: number,
): void {
  if (!isHeight(height) || artifactId.length > MAX_ID_LENGTH) return;
  const heights = rememberedHeights();
  const previous = heights.get(artifactId);
  if (previous && previous.height === height && previous.widthPx === widthPx) return;
  heights.delete(artifactId);
  heights.set(artifactId, { widthPx, height });
  for (const oldest of heights.keys()) {
    if (heights.size <= MAX_REMEMBERED_ARTIFACT_HEIGHTS) break;
    heights.delete(oldest);
  }
  const storage = store.defaultStorage();
  if (storage) {
    store.writeJson(
      storage,
      ARTIFACT_HEIGHT_STORAGE_KEY,
      Array.from(heights, ([id, entry]) => [id, entry.widthPx, entry.height]),
    );
  }
}

export function clearArtifactHeightsForTests(): void {
  remembered = null;
  const storage = store.defaultStorage();
  if (storage) store.writeJson(storage, ARTIFACT_HEIGHT_STORAGE_KEY, null);
}
