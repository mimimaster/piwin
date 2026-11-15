import { countArtifactSessionMediaReferences, type ArtifactMediaBudget } from '@piwin/artifact';
import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import { createLimitedDataUrlFromHref } from '../media/media-preview-bitmap.js';

export const ARTIFACT_MEDIA_MAX_EDGE_PX = 1024;

/** Bound raw previews while gathering a gallery; exceeding it triggers fitting, never omission. */
export const ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS = 6 * 1024 * 1024;

export function artifactMediaCharacters(
  urls: ReadonlyMap<string, string>,
  budget: ArtifactMediaBudget,
): number {
  let total = 0;
  for (const [assetId, count] of budget.references)
    total += (urls.get(assetId)?.length ?? 0) * count;
  return total;
}

/** Keep small galleries unchanged; fit overflow without dropping a readable image. */
export async function compressArtifactMedia(input: {
  source: string;
  budget?: ArtifactMediaBudget;
  readDataUrl: (assetId: string) => Promise<string | null>;
  isStale?: () => boolean;
}): Promise<ReadonlyMap<string, string>> {
  const budget = input.budget ?? {
    maxCharacters: MAX_ARTIFACT_DOCUMENT_BYTES,
    references: countArtifactSessionMediaReferences(input.source),
  };
  const urls = new Map<string, string>();
  let referenceCount = 0;
  for (const count of budget.references.values()) referenceCount += count;
  const perReferenceLimit = Math.max(
    1,
    Math.floor(budget.maxCharacters / Math.max(1, referenceCount)),
  );
  let rawCharacters = 0;
  let fittedDuringCollection = false;

  async function fit(assetId: string, url: string, maxCharacters: number): Promise<string> {
    if (url.length <= maxCharacters || input.isStale?.()) return url;
    const fitted = await createLimitedDataUrlFromHref(url, ARTIFACT_MEDIA_MAX_EDGE_PX, {
      maxCharacters,
      ...(input.isStale ? { isStale: input.isStale } : {}),
    });
    if (fitted === null && !input.isStale?.()) {
      console.warn('[artifact-media] preview compression failed; keeping the readable image', {
        assetId,
      });
    }
    return fitted ?? url;
  }

  for (const assetId of budget.references.keys()) {
    if (input.isStale?.()) break;
    const url = await input.readDataUrl(assetId);
    if (url === null || !url.startsWith('data:image/')) continue;
    urls.set(assetId, fittedDuringCollection ? await fit(assetId, url, perReferenceLimit) : url);
    rawCharacters += url.length;
    if (!fittedDuringCollection && rawCharacters > ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS) {
      // Reserve a fair share for references that have not been read yet.
      for (const [loadedId, loadedUrl] of urls) {
        if (input.isStale?.()) return urls;
        urls.set(loadedId, await fit(loadedId, loadedUrl, perReferenceLimit));
      }
      fittedDuringCollection = true;
    }
  }
  let remainingCharacters = budget.maxCharacters;
  let remainingCost = artifactMediaCharacters(urls, budget);
  if (remainingCost <= remainingCharacters || input.isStale?.()) return urls;

  // Honor tiny/poorly compressible images first; larger images share the space
  // that remains. Repeat counts weight cost without encoding the same asset twice.
  const ordered = [...urls].sort((first, second) => first[1].length - second[1].length);
  for (const [assetId, url] of ordered) {
    if (input.isStale?.()) break;
    const count = budget.references.get(assetId) ?? 1;
    const target = Math.max(
      1,
      Math.floor((remainingCharacters * url.length) / Math.max(1, remainingCost)),
    );
    const fitted = await fit(assetId, url, target);
    urls.set(assetId, fitted);
    remainingCharacters -= fitted.length * count;
    remainingCost -= url.length * count;
  }
  return urls;
}
