import { describe, expect, it } from 'vitest';
import {
  classifyFileTreePreviewUnavailable,
  FILE_TREE_IMAGE_PREVIEW_MAX_BYTES,
  formatPreviewBytes,
  interpretProjectReadPreview,
  previewUnavailableCopy,
} from './preview-unavailable.js';

describe('previewUnavailableCopy', () => {
  it('names the extension for unsupported binaries', () => {
    const zh = previewUnavailableCopy({
      reason: 'binary',
      locale: 'zh-CN',
      fileName: 'Setup.dmg',
    });
    expect(zh.title).toBe('无法预览此文件');
    expect(zh.detail).toBe('不支持预览 .dmg 文件');

    const en = previewUnavailableCopy({
      reason: 'binary',
      locale: 'en',
      fileName: 'Setup.dmg',
    });
    expect(en.title).toBe('Preview unavailable');
    expect(en.detail).toBe('.dmg files can’t be previewed');
  });

  it('states the size limit when both sizes are known', () => {
    const copy = previewUnavailableCopy({
      reason: 'too-large',
      locale: 'en',
      byteSize: 266.6 * 1024 * 1024,
      maxBytes: 256 * 1024 * 1024,
    });
    expect(copy.title).toBe('File is too large to preview');
    expect(copy.detail).toBe('266.6 MB exceeds the 256.0 MB preview limit');
  });

  it('does not dump host reason codes', () => {
    const copy = previewUnavailableCopy({
      reason: 'outside-project',
      locale: 'zh-CN',
    });
    expect(copy.title).toBe('无法预览');
    expect(copy.detail).not.toContain('outside-project');
    expect(copy.detail).toContain('项目');
  });
});

describe('classifyFileTreePreviewUnavailable', () => {
  it('treats oversized images as too-large', () => {
    expect(
      classifyFileTreePreviewUnavailable({
        mimeHint: 'image/png',
        byteSize: FILE_TREE_IMAGE_PREVIEW_MAX_BYTES + 1,
      }),
    ).toBe('too-large');
  });

  it('treats installers as unsupported format', () => {
    expect(
      classifyFileTreePreviewUnavailable({
        mimeHint: 'application/octet-stream',
        byteSize: 80 * 1024 * 1024,
      }),
    ).toBe('binary');
  });
});

describe('formatPreviewBytes', () => {
  it('uses one decimal for megabytes', () => {
    expect(formatPreviewBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
  });
});

describe('interpretProjectReadPreview', () => {
  it('keeps text reads as text', () => {
    expect(
      interpretProjectReadPreview({
        content: '# hi',
        isBinary: false,
      }),
    ).toEqual({ kind: 'text', content: '# hi' });
  });

  it('prefers an inline image data URL over the binary flag', () => {
    const decision = interpretProjectReadPreview({
      content: '',
      isBinary: true,
      mimeHint: 'image/png',
      byteSize: 16,
      previewDataUrl: 'data:image/png;base64,AAAA',
      absolutePath: '/proj/icon.png',
    });
    expect(decision).toMatchObject({
      kind: 'media',
      path: '/proj/icon.png',
      dataUrl: 'data:image/png;base64,AAAA',
    });
  });

  it('classifies a project zip as unsupported, not missing', () => {
    expect(
      interpretProjectReadPreview({
        content: '',
        isBinary: true,
        mimeHint: 'application/octet-stream',
        byteSize: 80 * 1024 * 1024,
        absolutePath: '/proj/out.zip',
      }),
    ).toMatchObject({ kind: 'unavailable', reason: 'binary' });
  });
});
