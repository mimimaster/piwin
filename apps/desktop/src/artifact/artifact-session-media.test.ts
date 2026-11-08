import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS,
  getArtifactMediaDataUrlCacheStats,
  resetArtifactMediaDataUrlCacheForTests,
  resolveArtifactSessionMediaDataUrls,
  resolveBoundArtifactMediaSessionId,
  trimArtifactMediaDataUrlCache,
} from './artifact-session-media';

const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_MEDIA_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const DATA_URL = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAA==';

const { limitedDataUrlFromHref } = vi.hoisted(() => ({
  limitedDataUrlFromHref: vi.fn<(href: string, maxEdgePx: number) => Promise<string | null>>(),
}));

const { localVaultUrl } = vi.hoisted(() => ({
  localVaultUrl:
    vi.fn<
      (input: { sessionId: string; assetId: string; mimeType: string }) => Promise<string | null>
    >(),
}));

vi.mock('../media/media-preview-bitmap', () => ({
  createLimitedDataUrlFromHref: limitedDataUrlFromHref,
}));

vi.mock('../conversation/transcript-media-preview', () => ({
  resolveLocalVaultMediaUrl: localVaultUrl,
}));

describe('resolveArtifactSessionMediaDataUrls', () => {
  beforeEach(() => {
    resetArtifactMediaDataUrlCacheForTests();
    limitedDataUrlFromHref.mockReset();
    localVaultUrl.mockReset();
    // Default: a shell without local file access (browser, remote-only).
    localVaultUrl.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('reads the local vault file first and skips the Host read', async () => {
    localVaultUrl.mockImplementation(
      async ({ mimeType }) => `asset://localhost/vault.${mimeType.split('/')[1]}`,
    );
    limitedDataUrlFromHref.mockImplementation(async (href) =>
      href.endsWith('.jpeg') ? DATA_URL : null,
    );
    const readMedia = vi.fn(async () => 'blob:http://localhost/icon');
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    expect(urls.get(MEDIA_ID)).toBe(DATA_URL);
    expect(localVaultUrl).toHaveBeenCalledWith({
      sessionId: 'session-1',
      assetId: MEDIA_ID,
      mimeType: 'image/jpeg',
    });
    expect(readMedia).not.toHaveBeenCalled();
  });

  it('binds from the local vault without a Host reader', async () => {
    localVaultUrl.mockResolvedValue('asset://localhost/vault.png');
    limitedDataUrlFromHref.mockResolvedValue(DATA_URL);
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: null,
    });
    expect(urls.get(MEDIA_ID)).toBe(DATA_URL);
  });

  it('falls back to Host media/read after every local extension misses', async () => {
    localVaultUrl.mockResolvedValue('asset://localhost/missing');
    limitedDataUrlFromHref.mockImplementation(async (href) =>
      href.startsWith('blob:') ? DATA_URL : null,
    );
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
    });
    expect(urls.get(MEDIA_ID)).toBe(DATA_URL);
    expect(localVaultUrl.mock.calls.map(([input]) => input.mimeType)).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
  });

  it('warns when neither the local vault nor the Host returns the image', async () => {
    limitedDataUrlFromHref.mockResolvedValue(null);
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => null,
    });
    expect(console.warn).toHaveBeenCalledWith(
      '[artifact-media] image not bound: no readable vault copy',
      { sessionId: 'session-1', assetId: MEDIA_ID, hostReader: true },
    );
  });

  it('decodes each vault asset once across repeated stream resolves', async () => {
    limitedDataUrlFromHref.mockResolvedValue(DATA_URL);
    const input = {
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
    };
    await resolveArtifactSessionMediaDataUrls(input);
    await resolveArtifactSessionMediaDataUrls({ ...input, source: `${input.source}<p>more</p>` });
    expect(limitedDataUrlFromHref).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map when there is no session, or no reader and no local copy', async () => {
    const source = `<img data-piwin-media="${MEDIA_ID}">`;
    await expect(
      resolveArtifactSessionMediaDataUrls({
        source,
        sessionId: null,
        readMedia: async () => 'blob:http://localhost/x',
      }),
    ).resolves.toEqual(new Map());
    await expect(
      resolveArtifactSessionMediaDataUrls({
        source,
        sessionId: 'session-1',
        readMedia: null,
      }),
    ).resolves.toEqual(new Map());
  });

  it('inlines this session vault image as a size-capped data URL', async () => {
    limitedDataUrlFromHref.mockResolvedValue(DATA_URL);
    const readMedia = vi.fn(async (input: { sessionId: string; assetId: string }) => {
      expect(input.sessionId).toBe('session-1');
      expect(input.assetId).toBe(MEDIA_ID);
      return 'blob:http://localhost/icon';
    });
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}" alt="icon">`,
      sessionId: 'session-1',
      readMedia,
    });
    // A blob: URL would be unreadable from the sandbox's opaque origin.
    expect(urls.get(MEDIA_ID)).toBe(DATA_URL);
    expect(limitedDataUrlFromHref).toHaveBeenCalledWith('blob:http://localhost/icon', 1024);
  });

  it('drops non-blob reader results without decoding them', async () => {
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'https://evil.example/x.png',
    });
    expect(urls.size).toBe(0);
    expect(limitedDataUrlFromHref).not.toHaveBeenCalled();
  });

  it('leaves an image unbound when the decode fails', async () => {
    limitedDataUrlFromHref.mockResolvedValue(null);
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
    });
    expect(urls.size).toBe(0);
  });

  it('stops binding once the per-artifact inline budget is spent', async () => {
    const prefix = 'data:image/webp;base64,';
    // Exactly the whole budget, so the next image has nothing left to spend.
    const huge = `${prefix}${'A'.repeat(ARTIFACT_MEDIA_TOTAL_BUDGET_CHARS - prefix.length)}`;
    limitedDataUrlFromHref.mockImplementation(async (href) =>
      href.endsWith('huge') ? huge : DATA_URL,
    );
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}"><img data-piwin-media="${OTHER_MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async ({ assetId }) =>
        assetId === MEDIA_ID ? 'blob:http://localhost/huge' : 'blob:http://localhost/small',
    });
    expect(urls.has(MEDIA_ID)).toBe(true);
    expect(urls.has(OTHER_MEDIA_ID)).toBe(false);
  });

  it('a stale completion is returned to the caller but never admitted to the cache', async () => {
    let stale = false;
    limitedDataUrlFromHref.mockImplementation(async () => {
      stale = true; // caller's generation flipped mid-decode
      return DATA_URL;
    });
    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
      isStale: () => stale,
    });
    expect(urls.get(MEDIA_ID)).toBe(DATA_URL);

    // Not cached: a fresh resolve decodes again instead of hitting the entry.
    limitedDataUrlFromHref.mockClear();
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
    });
    expect(limitedDataUrlFromHref).toHaveBeenCalledTimes(1);
  });

  it('a live completion populates the cache normally', async () => {
    limitedDataUrlFromHref.mockResolvedValue(DATA_URL);
    const input = {
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
      isStale: () => false,
    };
    await resolveArtifactSessionMediaDataUrls(input);
    limitedDataUrlFromHref.mockClear();
    await resolveArtifactSessionMediaDataUrls(input);
    expect(limitedDataUrlFromHref).not.toHaveBeenCalled();
  });

  it('budget trim evicts settled entries LRU-first and a zero budget drains all', async () => {
    limitedDataUrlFromHref.mockImplementation(async () => DATA_URL);
    const readMedia = async () => 'blob:http://localhost/icon';
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${OTHER_MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    expect(getArtifactMediaDataUrlCacheStats().entries).toBe(2);

    trimArtifactMediaDataUrlCache({ maxEntries: 1 });
    expect(getArtifactMediaDataUrlCacheStats().entries).toBe(1);

    // The evicted id decodes again; the kept one is a cache hit.
    limitedDataUrlFromHref.mockClear();
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${OTHER_MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    expect(limitedDataUrlFromHref).toHaveBeenCalledTimes(1);

    trimArtifactMediaDataUrlCache({ evictAll: true, maxEntries: 0, maxBytes: 0 });
    expect(getArtifactMediaDataUrlCacheStats().entries).toBe(0);
  });

  it('a single oversized decode is returned but never admitted under the byte budget', async () => {
    const hugeUrl = `data:image/webp;base64,${'A'.repeat(5000)}`;
    limitedDataUrlFromHref.mockImplementation(async (href) =>
      href.endsWith('huge') ? hugeUrl : DATA_URL,
    );
    trimArtifactMediaDataUrlCache({ maxBytes: 1000 });
    const readMedia = async ({ assetId }: { sessionId: string; assetId: string }) =>
      assetId === MEDIA_ID ? 'blob:http://localhost/huge' : 'blob:http://localhost/small';

    const urls = await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}"><img data-piwin-media="${OTHER_MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    expect(urls.get(MEDIA_ID)).toBe(hugeUrl);

    // Oversized entry was not admitted: only the small one is a cache hit.
    limitedDataUrlFromHref.mockClear();
    await resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}"><img data-piwin-media="${OTHER_MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia,
    });
    expect(limitedDataUrlFromHref).toHaveBeenCalledTimes(1);
  });

  it('an inflight decode is leased and survives an evictAll trim', async () => {
    let finish: ((url: string | null) => void) | undefined;
    limitedDataUrlFromHref.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = resolveArtifactSessionMediaDataUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'blob:http://localhost/icon',
    });
    // Let the decode chain reach the deferred.
    await vi.waitFor(() => expect(finish).toBeDefined());
    trimArtifactMediaDataUrlCache({ evictAll: true, maxEntries: 0, maxBytes: 0 });
    // The pending decode kept its lease — the cache still holds the entry.
    expect(getArtifactMediaDataUrlCacheStats().entries).toBe(1);

    finish?.(DATA_URL);
    await expect(pending).resolves.toEqual(new Map([[MEDIA_ID, DATA_URL]]));
    // Zero-budget admission: resolved value was marked unleased, dropped by trim.
    trimArtifactMediaDataUrlCache({ maxEntries: 0, maxBytes: 0 });
    expect(getArtifactMediaDataUrlCacheStats().entries).toBe(0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveBoundArtifactMediaSessionId', () => {
  it('refuses a fence from another session', () => {
    expect(
      resolveBoundArtifactMediaSessionId({
        originSessionId: 'session-child',
        providerSessionId: 'session-parent',
      }),
    ).toBeNull();
  });

  it('binds when origin and provider match', () => {
    expect(
      resolveBoundArtifactMediaSessionId({
        originSessionId: 'session-1',
        providerSessionId: 'session-1',
      }),
    ).toBe('session-1');
  });

  it('falls back to the provider session when origin is omitted', () => {
    expect(resolveBoundArtifactMediaSessionId({ providerSessionId: 'session-1' })).toBe(
      'session-1',
    );
  });
});
