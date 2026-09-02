import { describe, expect, it } from 'vitest';
import {
  isLocalFileMarkdownHref,
  isLocalPathChipCandidate,
  normalizeLocalFileHref,
  rewriteLocalFileMarkdownLinks,
} from './markdown-local-links.js';

describe('isLocalFileMarkdownHref', () => {
  it('accepts file URLs, absolute host paths, and bare deliverables', () => {
    expect(isLocalFileMarkdownHref('file:///Users/me/out.zip')).toBe(true);
    expect(isLocalFileMarkdownHref('/Users/me/out.zip')).toBe(true);
    expect(isLocalFileMarkdownHref('~/Downloads/a.png')).toBe(true);
    expect(isLocalFileMarkdownHref('./dist/app.zip')).toBe(true);
    expect(isLocalFileMarkdownHref('cropped-portraits-16.zip')).toBe(true);
    expect(isLocalFileMarkdownHref('cropped-portraits/')).toBe(true);
    expect(isLocalFileMarkdownHref('exports/faces.png')).toBe(true);
  });

  it('rejects web and special schemes', () => {
    expect(isLocalFileMarkdownHref('https://example.com/a.zip')).toBe(false);
    expect(isLocalFileMarkdownHref('http://example.com/a.zip')).toBe(false);
    expect(isLocalFileMarkdownHref('mailto:a@b.com')).toBe(false);
    expect(isLocalFileMarkdownHref('#section')).toBe(false);
    expect(isLocalFileMarkdownHref('javascript:alert(1)')).toBe(false);
  });

  it('rejects glob patterns even when they start with ~/', () => {
    expect(isLocalFileMarkdownHref('~/.piwin/**')).toBe(false);
    expect(isLocalFileMarkdownHref('~/.piwin/sessions/**')).toBe(false);
    expect(isLocalFileMarkdownHref('~/.piwin/*.json')).toBe(false);
    expect(isLocalFileMarkdownHref('~/Downloads/*.png')).toBe(false);
  });
});

describe('normalizeLocalFileHref', () => {
  it('strips file: and decodes', () => {
    expect(normalizeLocalFileHref('file:///Users/me/a%20b.zip')).toBe('/Users/me/a b.zip');
    expect(normalizeLocalFileHref('<./out.zip>')).toBe('./out.zip');
  });
});

describe('rewriteLocalFileMarkdownLinks', () => {
  it('rewrites bare relative download links to inline code (avoids [blocked])', () => {
    const input =
      '获取结果：\n- 压缩包: [cropped-portraits-16.zip](cropped-portraits-16.zip)\n- 目录: [cropped-portraits/](cropped-portraits/)';
    const out = rewriteLocalFileMarkdownLinks(input);
    expect(out).toContain('`cropped-portraits-16.zip`');
    expect(out).toContain('`cropped-portraits/`');
    expect(out).not.toContain('](cropped-portraits-16.zip)');
    expect(out).not.toContain('](cropped-portraits/)');
  });

  it('keeps absolute paths as markdown links with file: stripped', () => {
    const input = '[包](file:///Users/me/out.zip)';
    expect(rewriteLocalFileMarkdownLinks(input)).toBe('[包](/Users/me/out.zip)');
  });

  it('leaves https links untouched', () => {
    const input = 'see [docs](https://example.com/a.zip)';
    expect(rewriteLocalFileMarkdownLinks(input)).toBe(input);
  });

  it('does not rewrite image markdown', () => {
    const input = '![shot](./shot.png)';
    expect(rewriteLocalFileMarkdownLinks(input)).toBe(input);
  });
});

describe('isLocalPathChipCandidate', () => {
  it('accepts inline-code style deliverable names', () => {
    expect(isLocalPathChipCandidate('cropped-portraits-16.zip')).toBe(true);
    expect(isLocalPathChipCandidate('/Users/me/a.md')).toBe(true);
    expect(isLocalPathChipCandidate('https://example.com/a.zip')).toBe(false);
  });

  it('keeps a `.svg` / `.html` mention clickable so Chat can open the generated markup', () => {
    expect(isLocalPathChipCandidate('.svg')).toBe(true);
    expect(isLocalPathChipCandidate('.html')).toBe(true);
  });

  it('does not chip source-file mentions as if they were deliverables', () => {
    expect(isLocalPathChipCandidate('main.ts')).toBe(false);
    expect(isLocalPathChipCandidate('README.md')).toBe(false);
    expect(isLocalPathChipCandidate('.ts')).toBe(false);
    expect(isLocalPathChipCandidate('.tsx')).toBe(false);
    expect(isLocalPathChipCandidate('.md')).toBe(false);
    expect(isLocalPathChipCandidate('src/utils.ts')).toBe(true);
  });

  it('does not chip glob patterns as folder chips leftover **', () => {
    expect(isLocalPathChipCandidate('~/.piwin/**')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/workspace/**')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/sessions/**')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/sessions-index/**')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/media/**')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/skills/**')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/*.json')).toBe(false);
    expect(isLocalPathChipCandidate('sessions/**')).toBe(false);
    expect(isLocalPathChipCandidate('*.json')).toBe(false);
    expect(isLocalPathChipCandidate('~/.piwin/config.json')).toBe(true);
  });
});
