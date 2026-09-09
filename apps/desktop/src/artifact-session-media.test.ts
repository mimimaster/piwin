import { describe, expect, it, vi } from 'vitest';
import {
  resolveArtifactSessionMediaObjectUrls,
  resolveBoundArtifactMediaSessionId,
} from './artifact-session-media';

const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('resolveArtifactSessionMediaObjectUrls', () => {
  it('returns an empty map when there is no session or reader', async () => {
    const source = `<img data-piwin-media="${MEDIA_ID}">`;
    await expect(
      resolveArtifactSessionMediaObjectUrls({
        source,
        sessionId: null,
        readMedia: async () => 'blob:http://localhost/x',
      }),
    ).resolves.toEqual(new Map());
    await expect(
      resolveArtifactSessionMediaObjectUrls({
        source,
        sessionId: 'session-1',
        readMedia: null,
      }),
    ).resolves.toEqual(new Map());
  });

  it('keeps only blob URLs from this session', async () => {
    const readMedia = vi.fn(async (input: { sessionId: string; assetId: string }) => {
      expect(input.sessionId).toBe('session-1');
      expect(input.assetId).toBe(MEDIA_ID);
      return 'blob:http://localhost/icon';
    });
    const urls = await resolveArtifactSessionMediaObjectUrls({
      source: `<img data-piwin-media="${MEDIA_ID}" alt="icon">`,
      sessionId: 'session-1',
      readMedia,
    });
    expect(urls.get(MEDIA_ID)).toBe('blob:http://localhost/icon');
  });

  it('drops non-blob reader results', async () => {
    const urls = await resolveArtifactSessionMediaObjectUrls({
      source: `<img data-piwin-media="${MEDIA_ID}">`,
      sessionId: 'session-1',
      readMedia: async () => 'https://evil.example/x.png',
    });
    expect(urls.size).toBe(0);
  });
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
    expect(
      resolveBoundArtifactMediaSessionId({ providerSessionId: 'session-1' }),
    ).toBe('session-1');
  });
});
