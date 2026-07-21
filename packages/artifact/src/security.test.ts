import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_ARTIFACT_BYTES } from './constants.js';
import { createDefaultArtifactIframePolicy } from './iframe-policy.js';
import {
  classifyArtifactSecurity,
  detectExternalArtifactResources,
  getUtf8ByteSize,
} from './security.js';

describe('getUtf8ByteSize', () => {
  it('counts utf8 bytes', () => {
    expect(getUtf8ByteSize('abc')).toBe(3);
    expect(getUtf8ByteSize('你好')).toBe(6);
  });
});

describe('detectExternalArtifactResources', () => {
  it('detects external resource tags', () => {
    const resources = detectExternalArtifactResources(`
      <link href="https://cdn.example.com/app.css">
      <script src="https://cdn.example.com/app.js"></script>
      <img src="https://cdn.example.com/app.png">
      <iframe src="https://example.com"></iframe>
    `);
    expect(resources.map((item) => item.kind).sort()).toEqual(
      ['iframe', 'image', 'link', 'script'].sort(),
    );
  });

  it('ignores data/blob images', () => {
    expect(
      detectExternalArtifactResources(`
        <img src="data:image/png;base64,abc">
        <img src="blob:abc">
      `),
    ).toEqual([]);
  });
});

describe('classifyArtifactSecurity', () => {
  it('allows local inline html', () => {
    expect(classifyArtifactSecurity('<section><button>Click</button></section>')).toMatchObject({
      canRender: true,
      blockReason: null,
    });
  });

  it('blocks empty and placeholders', () => {
    expect(classifyArtifactSecurity('   ').blockReason).toBe('blocked-empty');
    expect(classifyArtifactSecurity('TODO').blockReason).toBe('blocked-empty');
  });

  it('blocks oversized content', () => {
    const result = classifyArtifactSecurity(`<div>${'x'.repeat(DEFAULT_MAX_ARTIFACT_BYTES)}</div>`);
    expect(result.canRender).toBe(false);
    expect(result.blockReason).toBe('blocked-too-large');
  });

  it('blocks external scripts', () => {
    const result = classifyArtifactSecurity(
      '<script src="https://cdn.example.com/chart.js"></script>',
    );
    expect(result.blockReason).toBe('blocked-external-resource');
  });

  it('allows youtube embed under default allowlist', () => {
    const result = classifyArtifactSecurity(
      '<iframe src="https://www.youtube.com/embed/YE7VzlLtp-4"></iframe>',
    );
    expect(result.canRender).toBe(true);
  });

  it('blocks youtube when iframe policy is disabled', () => {
    const result = classifyArtifactSecurity(
      '<iframe src="https://www.youtube.com/embed/YE7VzlLtp-4"></iframe>',
      createDefaultArtifactIframePolicy('disabled'),
    );
    expect(result.blockReason).toBe('blocked-external-resource');
  });

  it('allows inline scripts without external src', () => {
    const result = classifyArtifactSecurity(
      `<button id="btn">Click</button><script>document.getElementById('btn')</script>`,
    );
    expect(result.canRender).toBe(true);
  });
});
