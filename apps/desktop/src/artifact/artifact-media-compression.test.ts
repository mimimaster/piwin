// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressArtifactMedia, artifactMediaCharacters } from './artifact-media-compression.js';
import type { ArtifactMediaBudget } from '@piwin/artifact';

const { encode } = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock('../media/media-preview-bitmap.js', () => ({ createLimitedDataUrlFromHref: encode }));

function image(characters: number): string {
  const prefix = 'data:image/jpeg;base64,';
  return prefix + 'A'.repeat(Math.max(0, characters - prefix.length));
}

function mediaId(index: number): string {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, '0')}`;
}

describe('Artifact total image compression', () => {
  beforeEach(() => {
    encode.mockReset();
    encode.mockImplementation(
      async (_url: string, _edge: number, options: { maxCharacters: number }) =>
        image(options.maxCharacters),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps original preview URLs when the complete gallery already fits', async () => {
    const original = image(500);
    const budget: ArtifactMediaBudget = {
      maxCharacters: 2000,
      references: new Map([[mediaId(1), 2]]),
    };
    const urls = await compressArtifactMedia({
      source: '',
      budget,
      readDataUrl: async () => original,
    });
    expect(urls.get(mediaId(1))).toBe(original);
    expect(encode).not.toHaveBeenCalled();
  });

  it('weights repeated references and retains every image within the total allocation', async () => {
    const budget: ArtifactMediaBudget = {
      maxCharacters: 1000,
      references: new Map([
        [mediaId(1), 3],
        [mediaId(2), 1],
      ]),
    };
    const urls = await compressArtifactMedia({
      source: '',
      budget,
      readDataUrl: async () => image(500),
    });
    expect(urls.size).toBe(2);
    expect(artifactMediaCharacters(urls, budget)).toBeLessThanOrEqual(budget.maxCharacters);
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it('keeps later images beyond the raw buffer limit and bounds simultaneous reads', async () => {
    const budget: ArtifactMediaBudget = {
      maxCharacters: 1000000,
      references: new Map(Array.from({ length: 20 }, (_, index) => [mediaId(index), 1])),
    };
    let inFlight = 0;
    let maximumInFlight = 0;
    const urls = await compressArtifactMedia({
      source: '',
      budget,
      readDataUrl: async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return image(500000);
      },
    });
    expect(urls.size).toBe(20);
    expect(urls.has(mediaId(19))).toBe(true);
    expect(artifactMediaCharacters(urls, budget)).toBeLessThanOrEqual(budget.maxCharacters);
    expect(maximumInFlight).toBeLessThanOrEqual(2);
  });

  it('retains readable images if a codec fails instead of silently omitting them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    encode.mockResolvedValue(null);
    const original = image(1000);
    const budget: ArtifactMediaBudget = {
      maxCharacters: 100,
      references: new Map([[mediaId(1), 1]]),
    };
    const urls = await compressArtifactMedia({
      source: '',
      budget,
      readDataUrl: async () => original,
    });
    expect(urls.get(mediaId(1))).toBe(original);
    expect(console.warn).toHaveBeenCalled();
  });

  it('stops gathering more images after its generation is cancelled', async () => {
    let stale = false;
    encode.mockImplementation(async () => {
      stale = true;
      return image(1000);
    });
    const readDataUrl = vi.fn(async () => image(7 * 1024 * 1024));
    const budget: ArtifactMediaBudget = {
      maxCharacters: 2000,
      references: new Map([
        [mediaId(1), 1],
        [mediaId(2), 1],
      ]),
    };
    await compressArtifactMedia({ source: '', budget, readDataUrl, isStale: () => stale });
    expect(readDataUrl).toHaveBeenCalledOnce();
  });
});
