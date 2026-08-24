import { describe, expect, it } from 'vitest';
import { indexArtifactFences } from '@piwin/artifact';
import { collectMobileArtifacts, mobileArtifactBlockedCopy } from './mobile-artifact-preview.js';

describe('collectMobileArtifacts', () => {
  it('promotes a safe html fence and leaves ordinary code alone', () => {
    const text = [
      '说明',
      '```artifact-html title="Landing"',
      '<section><h1>Hello</h1></section>',
      '```',
      '```ts',
      'export const x = 1;',
      '```',
    ].join('\n');
    const items = collectMobileArtifacts(text);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Landing');
    expect(indexArtifactFences(text).map((fence) => fence.source)).toEqual([
      '<section><h1>Hello</h1></section>',
      'export const x = 1;',
    ]);
    expect(items[0]?.decision.kind).toBe('render');
    if (items[0]?.decision.kind === 'render') {
      expect(items[0].decision.srcdoc).toContain('<h1>Hello</h1>');
      expect(items[0].decision.csp).toContain("connect-src 'none'");
      expect(items[0].decision.csp).toContain("frame-src 'none'");
    }
  });

  it('keeps Mobile ordinals and source aligned with the shared fence index', () => {
    const text = [
      '```artifact-html title="Inline card"',
      '<section><h1>Hello</h1></section>',
      '```',
      '',
      '```artifact-html title="Workspace" surface="canvas"',
      '<main>workspace</main>',
      '```',
    ].join('\n');
    const fences = indexArtifactFences(text);
    const items = collectMobileArtifacts(text);
    expect(fences.map((fence) => fence.ordinal)).toEqual([0, 1]);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.title)).toEqual(['Inline card', 'Workspace']);
    expect(items.map((item) => item.decision.descriptor.source)).toEqual(
      fences.map((fence) => fence.source),
    );
    expect(items.map((item) => item.decision.descriptor.surface)).toEqual(['inline', 'canvas']);
  });

  it('blocks external resources instead of rendering them', () => {
    const text = [
      '```artifact-html',
      '<script src="https://cdn.example.com/x.js"></script>',
      '```',
    ].join('\n');
    const items = collectMobileArtifacts(text);
    expect(items).toHaveLength(1);
    expect(items[0]?.decision.kind).toBe('blocked');
    if (items[0]?.decision.kind === 'blocked') {
      expect(items[0].decision.reason).toBe('blocked-external-resource');
      expect(mobileArtifactBlockedCopy(items[0].decision.reason)).toContain('外部资源');
    }
  });
});
