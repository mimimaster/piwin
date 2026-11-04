import { describe, expect, it } from 'vitest';
import {
  MAX_WEB_IMAGE_BYTES,
  fetchWebImage,
  findPageImageUrl,
  formatWebImageOutput,
  normalizeWebImageMimeType,
  pageTitleForImage,
} from './web-image.js';

const PNG_PAYLOAD = 'PNG-PAYLOAD-BYTES';
const PNG_BYTES = new TextEncoder().encode(PNG_PAYLOAD);

function imageResponse(body: string = PNG_PAYLOAD, contentType = 'image/png'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('normalizeWebImageMimeType', () => {
  it('keeps supported bitmaps and normalizes image/jpg', () => {
    expect(normalizeWebImageMimeType('image/png')).toBe('image/png');
    expect(normalizeWebImageMimeType('image/jpg')).toBe('image/jpeg');
    expect(normalizeWebImageMimeType('IMAGE/WEBP; q=1')).toBe('image/webp');
  });

  it('rejects svg and non-image content types', () => {
    expect(normalizeWebImageMimeType('image/svg+xml')).toBeUndefined();
    expect(normalizeWebImageMimeType('text/html')).toBeUndefined();
  });
});

describe('findPageImageUrl', () => {
  it('prefers og:image over the first inline image and resolves it absolutely', () => {
    const html = `
      <html><head>
        <meta content="/img/hero.png" property="og:image" />
      </head><body>
        <img src="/img/logo.png" />
      </body></html>`;
    expect(findPageImageUrl(html, 'https://example.com/spec/b300')).toBe(
      'https://example.com/img/hero.png',
    );
  });

  it('falls back to the first usable img and skips data urls, svg and 1x1 spacers', () => {
    const html = `
      <img src="data:image/gif;base64,R0lGOD" />
      <img src="/sprite.svg" />
      <img srcset="https://cdn.example.com/photo.webp 1x, https://cdn.example.com/photo@2x.webp 2x" />
      <img src="https://cdn.example.com/other.png" />`;
    expect(findPageImageUrl(html, 'https://example.com/')).toBe(
      'https://cdn.example.com/photo.webp',
    );
  });

  it('returns undefined when a page has no usable image', () => {
    expect(findPageImageUrl('<p>no pictures here</p>', 'https://example.com/')).toBeUndefined();
  });
});

describe('pageTitleForImage', () => {
  it('reads the page title', () => {
    expect(pageTitleForImage('<title> NVIDIA B300 </title>')).toBe('NVIDIA B300');
  });
});

describe('fetchWebImage', () => {
  it('passes a direct image URL straight through', async () => {
    const result = await fetchWebImage({
      url: 'https://cdn.example.com/b300.png',
      fetchImpl: async () => imageResponse(),
    });
    expect(result.discovery).toBe('direct');
    expect(result.mimeType).toBe('image/png');
    expect(result.imageUrl).toBe('https://cdn.example.com/b300.png');
    expect(result.bytes.byteLength).toBe(PNG_BYTES.byteLength);
  });

  it('mines the representative image out of an HTML page', async () => {
    const requested: string[] = [];
    const html = `<html><head><title>B300 spec</title>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
      </head><body>b300</body></html>`;
    const result = await fetchWebImage({
      url: 'https://example.com/b300',
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        return url === 'https://example.com/b300'
          ? htmlResponse(html)
          : imageResponse(PNG_PAYLOAD, 'image/jpeg');
      },
    });
    expect(requested).toEqual([
      'https://example.com/b300',
      'https://cdn.example.com/hero.jpg',
    ]);
    expect(result.discovery).toBe('page');
    expect(result.pageUrl).toBe('https://example.com/b300');
    expect(result.pageTitle).toBe('B300 spec');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.imageUrl).toBe('https://cdn.example.com/hero.jpg');
  });

  it('rejects a page without images', async () => {
    await expect(
      fetchWebImage({
        url: 'https://example.com/text-only',
        fetchImpl: async () => htmlResponse('<p>no pictures here</p>'),
      }),
    ).rejects.toThrow('no usable image found on page');
  });

  it('rejects an unsupported image type', async () => {
    await expect(
      fetchWebImage({
        url: 'https://cdn.example.com/logo.svg',
        fetchImpl: async () => imageResponse('svg', 'image/svg+xml'),
      }),
    ).rejects.toThrow('unsupported content-type for image');
  });

  it('rejects private hosts before any fetch', async () => {
    await expect(
      fetchWebImage({
        url: 'http://127.0.0.1/b300.png',
        fetchImpl: async () => {
          throw new Error('must not reach the network');
        },
      }),
    ).rejects.toThrow(/blocked/);
  });

  it('caps the downloaded bytes', () => {
    expect(MAX_WEB_IMAGE_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('formatWebImageOutput', () => {
  it('states that the image is already visible to the user', () => {
    const output = formatWebImageOutput(
      {
        imageUrl: 'https://cdn.example.com/b300.png',
        pageUrl: 'https://example.com/b300',
        mimeType: 'image/png',
        bytes: PNG_BYTES,
        discovery: 'page',
      },
      'asset-1',
    );
    expect(output).toContain('mediaId: asset-1');
    expect(output).toContain('pageUrl: https://example.com/b300');
    expect(output).toContain('visible to the user');
  });
});
