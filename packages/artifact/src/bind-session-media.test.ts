import { describe, expect, it } from 'vitest';
import {
  bindArtifactSessionMedia,
  isArtifactMediaObjectUrl,
  isBindableArtifactMediaId,
  listArtifactSessionMediaIds,
} from './bind-session-media.js';

const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BLOB_URL = 'blob:http://localhost/media-1';

describe('isBindableArtifactMediaId', () => {
  it('accepts UUID vault ids and rejects paths', () => {
    expect(isBindableArtifactMediaId(MEDIA_ID)).toBe(true);
    expect(isBindableArtifactMediaId(' ../../etc/passwd ')).toBe(false);
    expect(isBindableArtifactMediaId('session-1/asset.png')).toBe(false);
    expect(isBindableArtifactMediaId('')).toBe(false);
  });
});

describe('isArtifactMediaObjectUrl', () => {
  it('accepts blob URLs and rejects other schemes', () => {
    expect(isArtifactMediaObjectUrl(BLOB_URL)).toBe(true);
    expect(isArtifactMediaObjectUrl('javascript:alert(1)')).toBe(false);
    expect(isArtifactMediaObjectUrl('file:///tmp/x.png')).toBe(false);
    expect(isArtifactMediaObjectUrl('https://evil.example/x.png')).toBe(false);
    expect(isArtifactMediaObjectUrl('data:image/png;base64,abc')).toBe(false);
  });
});

describe('listArtifactSessionMediaIds', () => {
  it('collects unique bindable ids from img tags', () => {
    const source = `
      <img data-piwin-media="${MEDIA_ID}" alt="a">
      <img data-piwin-media="${MEDIA_ID}" alt="dup">
      <img data-piwin-media="not-a-uuid" alt="skip">
      <img src="https://cdn.example/x.png" alt="plain">
    `;
    expect(listArtifactSessionMediaIds(source)).toEqual([MEDIA_ID]);
  });
});

describe('bindArtifactSessionMedia', () => {
  it('rewrites known ids to blob src and leaves copy-source attributes', () => {
    const source = `<img data-piwin-media="${MEDIA_ID}" alt="Inkstone slab">`;
    const bound = bindArtifactSessionMedia(source, new Map([[MEDIA_ID, BLOB_URL]]));
    expect(bound).toContain(`src="${BLOB_URL}"`);
    expect(bound).toContain(`data-piwin-media="${MEDIA_ID}"`);
    expect(source).toBe(`<img data-piwin-media="${MEDIA_ID}" alt="Inkstone slab">`);
  });

  it('strips src on unknown ids and does not invent http/file', () => {
    const source = `<img src="https://cdn.example/x.png" data-piwin-media="${MEDIA_ID}" alt="x">`;
    const bound = bindArtifactSessionMedia(source, new Map());
    expect(bound).not.toContain('https://');
    expect(bound).toContain(`data-piwin-media="${MEDIA_ID}"`);
    expect(bound.toLowerCase()).not.toContain('src=');
  });

  it('rejects non-blob map values', () => {
    const source = `<img data-piwin-media="${MEDIA_ID}">`;
    expect(
      bindArtifactSessionMedia(source, new Map([[MEDIA_ID, 'javascript:alert(1)']])),
    ).not.toContain('javascript:');
    expect(
      bindArtifactSessionMedia(source, new Map([[MEDIA_ID, 'file:///tmp/x.png']])),
    ).not.toContain('file:');
    expect(
      bindArtifactSessionMedia(source, new Map([[MEDIA_ID, 'https://evil.example/x.png']])),
    ).not.toContain('https://');
  });

  it('leaves ordinary images untouched', () => {
    const source = '<img src="data:image/png;base64,abc" alt="inline">';
    expect(bindArtifactSessionMedia(source, new Map([[MEDIA_ID, BLOB_URL]]))).toBe(source);
  });
});
