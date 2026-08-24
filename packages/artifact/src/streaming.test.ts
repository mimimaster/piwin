import { describe, expect, it } from 'vitest';
import { STREAMING_ARTIFACT_FENCE_MARKER } from './constants.js';
import { indexArtifactFences } from './fence-index.js';
import { projectArtifactMarkdownForRender } from './markdown-projection.js';

describe('indexArtifactFences (streaming open fences)', () => {
  it('finds an incomplete html fence', () => {
    const content = 'Hello\n```html\n<div class="card">Hi';
    const open = indexArtifactFences(content).find((fence) => fence.open);
    expect(open).toBeDefined();
    expect(open?.info).toBe('html');
  });

  it('finds native artifact fences before structural body tokens arrive', () => {
    expect(indexArtifactFences('```html')[0]?.language).toBe('html');
    expect(indexArtifactFences('```svg\n<')[0]?.language).toBe('svg');
  });

  it('returns no open fence when the fence is closed', () => {
    const content = '```html\n<div>x</div>\n```';
    expect(indexArtifactFences(content).some((fence) => fence.open)).toBe(false);
  });

  it('finds an incomplete svg fence for source-safe projection', () => {
    const open = indexArtifactFences(
      '```svg\n<svg viewBox="0 0 10 10"><circle r="5" />',
    ).find((fence) => fence.open);
    expect(open).toBeDefined();
    expect(open?.info).toBe('svg');
  });
});

describe('projectArtifactMarkdownForRender (streaming closer)', () => {
  it('closes an open artifact fence when not done', () => {
    const content = '```html\n<div class="x">hello';
    const normalized = projectArtifactMarkdownForRender(content, false).markdown;
    expect(normalized.trimEnd().endsWith('```')).toBe(true);
    expect(indexArtifactFences(normalized).some((fence) => fence.open)).toBe(false);
  });

  it('marks an open native fence for first-token stream preview', () => {
    const normalizedHtml = projectArtifactMarkdownForRender('```html\n<', false).markdown;
    const normalizedSvg = projectArtifactMarkdownForRender('```svg', false).markdown;

    expect(normalizedHtml).toContain(`\`\`\`html ${STREAMING_ARTIFACT_FENCE_MARKER}\n<`);
    expect(normalizedSvg).toContain(`\`\`\`svg ${STREAMING_ARTIFACT_FENCE_MARKER}\n\`\`\``);
  });

  it('does not append a closer when done', () => {
    const content = '```html\n<div>x</div>\n```';
    expect(projectArtifactMarkdownForRender(content, true).markdown).toBe(content);
  });
});
