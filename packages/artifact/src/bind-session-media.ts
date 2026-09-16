/**
 * Bind session-vault images into Artifact HTML at materialize time.
 * Stored descriptor source keeps `data-piwin-media`; only renderSource/srcdoc
 * receive render URLs. The iframe never fetches file: or Host HTTP.
 *
 * Render URLs must be `data:` images, never `blob:`. The sandbox iframe runs
 * on an opaque origin (`sandbox="allow-scripts"` with no `allow-same-origin`),
 * and a blob URL belongs to the host origin, so the frame cannot read it —
 * the image errors instead of painting. `img-src data:` is in the strict CSP.
 */

const IMG_TAG_PATTERN = /<img\b[^>]*>/gi;
const MEDIA_ID_ATTR_PATTERN = /\bdata-piwin-media\s*=\s*(["'])([^"']*)\1/i;
const SRC_ATTR_PATTERN = /\s*\bsrc\s*=\s*(["'])(?:(?!\1).)*\1/i;
const BINDABLE_MEDIA_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i;

export function isBindableArtifactMediaId(value: string): boolean {
  return BINDABLE_MEDIA_ID_PATTERN.test(value.trim());
}

/** Only a self-contained base64 image survives the sandbox's opaque origin. */
export function isArtifactMediaRenderUrl(value: string): boolean {
  return MEDIA_DATA_URL_PATTERN.test(value);
}

export function listArtifactSessionMediaIds(source: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  IMG_TAG_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(IMG_TAG_PATTERN)) {
    const mediaId = readMediaIdAttribute(match[0] ?? '');
    if (mediaId === undefined || seen.has(mediaId)) {
      continue;
    }
    seen.add(mediaId);
    ids.push(mediaId);
  }
  return ids;
}

export function bindArtifactSessionMedia(
  source: string,
  mediaDataUrls: ReadonlyMap<string, string> = new Map(),
): string {
  IMG_TAG_PATTERN.lastIndex = 0;
  return source.replace(IMG_TAG_PATTERN, (tag) => {
    const mediaId = readMediaIdAttribute(tag);
    if (mediaId === undefined) {
      return tag;
    }
    const withoutSrc = tag.replace(SRC_ATTR_PATTERN, '');
    const boundUrl = mediaDataUrls.get(mediaId);
    if (boundUrl === undefined || !isArtifactMediaRenderUrl(boundUrl)) {
      return withoutSrc;
    }
    return withoutSrc.replace(/^<img\b/i, `<img src="${boundUrl}"`);
  });
}

function readMediaIdAttribute(tag: string): string | undefined {
  const match = MEDIA_ID_ATTR_PATTERN.exec(tag);
  const mediaId = match?.[2]?.trim();
  if (mediaId === undefined || !isBindableArtifactMediaId(mediaId)) {
    return undefined;
  }
  return mediaId;
}
