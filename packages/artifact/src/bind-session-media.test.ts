import { describe, expect, it } from 'vitest';
import {
  bindArtifactSessionMedia,
  isArtifactMediaRenderUrl,
  isBindableArtifactMediaId,
  listArtifactSessionMediaIds,
} from './bind-session-media.js';

const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DATA_URL = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAA==';
const BLOB_URL = 'blob:http://localhost/media-1';

describe('isBindableArtifactMediaId', () => {
  it('accepts UUID vault ids and rejects paths', () => {
    expect(isBindableArtifactMediaId(MEDIA_ID)).toBe(true);
    expect(isBindableArtifactMediaId(' ../../etc/passwd ')).toBe(false);
    expect(isBindableArtifactMediaId('session-1/asset.png')).toBe(false);
    expect(isBindableArtifactMediaId('')).toBe(false);
  });
});

describe('isArtifactMediaRenderUrl', () => {
  it('accepts base64 data images and rejects everything the sandbox cannot read', () => {
    expect(isArtifactMediaRenderUrl(DATA_URL)).toBe(true);
    expect(isArtifactMediaRenderUrl('data:image/png;base64,abc')).toBe(true);
    // A blob URL belongs to the host origin; the opaque-origin frame errors on it.
    expect(isArtifactMediaRenderUrl(BLOB_URL)).toBe(false);
    expect(isArtifactMediaRenderUrl('javascript:alert(1)')).toBe(false);
    expect(isArtifactMediaRenderUrl('file:///tmp/x.png')).toBe(false);
    expect(isArtifactMediaRenderUrl('https://evil.example/x.png')).toBe(false);
    expect(isArtifactMediaRenderUrl('data:text/html;base64,abc')).toBe(false);
    expect(isArtifactMediaRenderUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
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
  it('rewrites known ids to a data src and leaves copy-source attributes', () => {
    const source = `<img data-piwin-media="${MEDIA_ID}" alt="Inkstone slab">`;
    const bound = bindArtifactSessionMedia(source, new Map([[MEDIA_ID, DATA_URL]]));
    expect(bound).toContain(`src="${DATA_URL}"`);
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

  it('rejects map values the sandbox cannot read', () => {
    const source = `<img data-piwin-media="${MEDIA_ID}">`;
    expect(bindArtifactSessionMedia(source, new Map([[MEDIA_ID, BLOB_URL]]))).not.toContain(
      'blob:',
    );
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
    expect(bindArtifactSessionMedia(source, new Map([[MEDIA_ID, DATA_URL]]))).toBe(source);
  });
});
