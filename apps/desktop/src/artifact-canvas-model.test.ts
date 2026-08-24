import { describe, expect, it } from 'vitest';
import { indexArtifactFences } from '@piwin/artifact';
import { collectMobileArtifacts } from '../../mobile/src/mobile-artifact-preview';
import {
  buildArtifactCanvasTargetId,
  collectArtifactCanvasTargets,
  createArtifactCanvasTarget,
  isSameCanvasTarget,
  appendComposerProposal,
  type ArtifactCanvasTarget,
} from './artifact-canvas-model';
import type { ArtifactDescriptor, ArtifactRenderIntent } from '@piwin/artifact';

function makeDescriptor(overrides: Partial<ArtifactDescriptor> = {}): ArtifactDescriptor {
  return {
    id: 'artifact-sessionA-msg1-2',
    type: 'html',
    title: 'Deployment configurator',
    source: '<div>config</div>',
    rawLanguage: 'artifact-html',
    alias: 'artifact-html',
    declaration: 'explicit',
    documentKind: 'fragment',
    surface: 'canvas',
    ...overrides,
  } as ArtifactDescriptor;
}

function makeIntent(overrides: Partial<ArtifactDescriptor> = {}): ArtifactRenderIntent {
  const descriptor = makeDescriptor(overrides);
  return {
    descriptor,
    capabilities: {
      scripts: false,
      events: false,
      form: false,
      iframe: false,
      externalUrl: false,
      cssUrl: false,
      shadowHost: false,
      viewportDependency: false,
      isolation: false,
      blockReason: null,
      byteSize: descriptor.source.length,
      externalResources: [],
    },
    surface: descriptor.surface,
    layout: descriptor.surface === 'canvas' ? 'canvas' : 'flow',
    renderer: descriptor.surface === 'canvas' ? 'sandbox' : 'static',
  };
}

describe('buildArtifactCanvasTargetId', () => {
  it('is stable for the same session/message/fence triple', () => {
    expect(buildArtifactCanvasTargetId('s1', 'm1', 2)).toBe(
      buildArtifactCanvasTargetId('s1', 'm1', 2),
    );
  });

  it('differs across sessions, messages, or fence indices', () => {
    const base = buildArtifactCanvasTargetId('s1', 'm1', 2);
    expect(buildArtifactCanvasTargetId('s2', 'm1', 2)).not.toBe(base);
    expect(buildArtifactCanvasTargetId('s1', 'm2', 2)).not.toBe(base);
    expect(buildArtifactCanvasTargetId('s1', 'm1', 3)).not.toBe(base);
  });
});

describe('createArtifactCanvasTarget', () => {
  it('carries raw source and origin metadata only (no srcdoc/height/theme)', () => {
    const intent = makeIntent();
    const target = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 2,
      intent,
    });
    expect(target).toEqual<ArtifactCanvasTarget>({
      id: 'canvas:s1:m1:2',
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 2,
      channelId: 'artifact-sessionA-msg1-2',
      surface: 'canvas',
      title: 'Deployment configurator',
      type: 'html',
      declaration: 'explicit',
      documentKind: 'fragment',
      rawLanguage: 'artifact-html',
      source: '<div>config</div>',
      intent,
    });
  });

  it('does not include srcdoc, measured height, or theme fields', () => {
    const target = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 0,
      intent: makeIntent(),
    });
    expect('srcdoc' in target).toBe(false);
    expect('height' in target).toBe(false);
    expect('theme' in target).toBe(false);
  });

  it('preserves the descriptor surface (canvas stays canvas)', () => {
    const target = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 0,
      intent: makeIntent({ surface: 'canvas', type: 'svg' }),
    });
    expect(target.surface).toBe('canvas');
    expect(target.type).toBe('svg');
  });
});

describe('collectArtifactCanvasTargets', () => {
  it('agrees with the fence index and Mobile collector on ordinal, metadata, and source', () => {
    const markdown = [
      '```artifact-html title="Inline card"',
      '<section><h1>Hello</h1></section>',
      '```',
      '',
      '```artifact-html title="Workspace" surface="canvas"',
      '<main>workspace</main>',
      '```',
    ].join('\n');
    const fences = indexArtifactFences(markdown);
    const mobile = collectMobileArtifacts(markdown);
    const canvas = collectArtifactCanvasTargets({
      sessionId: 's1',
      messageId: 'm1',
      markdown,
    });

    expect(fences).toHaveLength(2);
    expect(fences.map((fence) => fence.ordinal)).toEqual([0, 1]);
    expect(fences.map((fence) => fence.source)).toEqual([
      '<section><h1>Hello</h1></section>',
      '<main>workspace</main>',
    ]);
    expect(fences[0]?.info).toContain('title="Inline card"');
    expect(fences[1]?.info).toContain('surface="canvas"');

    expect(mobile).toHaveLength(2);
    expect(mobile.map((item) => item.title)).toEqual(['Inline card', 'Workspace']);
    expect(
      mobile.map((item) =>
        item.plan.kind === 'render' ? item.plan.intent.descriptor.source : '',
      ),
    ).toEqual(fences.map((fence) => fence.source));
    expect(
      mobile.map((item) =>
        item.plan.kind === 'render' ? item.plan.intent.descriptor.surface : 'inline',
      ),
    ).toEqual(['inline', 'canvas']);

    expect(canvas).toHaveLength(1);
    expect(canvas[0]).toMatchObject({
      fenceIndex: 1,
      title: 'Workspace',
      source: '<main>workspace</main>',
      surface: 'canvas',
    });
    expect(canvas[0]?.fenceIndex).toBe(fences[1]?.ordinal);
    expect(canvas[0]?.source).toBe(fences[1]?.source);
  });

  it('uses the shared fence index ordinals and returns only explicit Canvas declarations', () => {
    const markdown = [
      '```ts',
      'const answer = 42;',
      '```',
      '',
      '```artifact-html title="Workspace" surface="canvas"',
      '<main>workspace</main>',
      '```',
      '',
      '```artifact-html title="Inline summary"',
      '<section>summary</section>',
      '```',
    ].join('\n');
    const indexed = indexArtifactFences(markdown);
    const targets = collectArtifactCanvasTargets({
      sessionId: 's1',
      messageId: 'm1',
      markdown,
    });

    expect(indexed.map((fence) => fence.ordinal)).toEqual([0, 1, 2]);
    expect(indexed.map((fence) => fence.source)).toEqual([
      'const answer = 42;',
      '<main>workspace</main>',
      '<section>summary</section>',
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: 'canvas:s1:m1:1',
      channelId: 'm1-artifact-1',
      title: 'Workspace',
      fenceIndex: 1,
      surface: 'canvas',
    });
  });

  it('skips a Canvas declaration rejected by the shared security policy', () => {
    const targets = collectArtifactCanvasTargets({
      sessionId: 's1',
      messageId: 'm1',
      markdown: [
        '```artifact-html title="Remote" surface="canvas"',
        '<iframe src="https://example.com"></iframe>',
        '```',
      ].join('\n'),
    });

    expect(targets).toEqual([]);
  });
});

describe('isSameCanvasTarget', () => {
  it('matches by stable id, not by source content', () => {
    const a = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 1,
      intent: makeIntent({ source: '<div>v1</div>' }),
    });
    const b = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 1,
      intent: makeIntent({ source: '<div>v2 regenerated</div>' }),
    });
    expect(isSameCanvasTarget(a, b)).toBe(true);
  });

  it('rejects different fence indices even in the same message', () => {
    const a = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 1,
      intent: makeIntent(),
    });
    const b = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 2,
      intent: makeIntent(),
    });
    expect(isSameCanvasTarget(a, b)).toBe(false);
  });

  it('treats null current target as not-same', () => {
    const candidate = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 0,
      intent: makeIntent(),
    });
    expect(isSameCanvasTarget(null, candidate)).toBe(false);
  });
});

describe('appendComposerProposal', () => {
  it('replaces an empty draft with the proposal text', () => {
    expect(appendComposerProposal('', 'Use React.')).toBe('Use React.');
  });

  it('replaces a whitespace-only draft with the proposal text', () => {
    expect(appendComposerProposal('   \n\t', 'Use React.')).toBe('Use React.');
  });

  it('appends with a single newline after a non-empty draft', () => {
    expect(appendComposerProposal('Existing note', 'Use React.')).toBe('Existing note\nUse React.');
  });

  it('trims trailing whitespace before appending', () => {
    expect(appendComposerProposal('Existing note   \n\n', 'Use React.')).toBe(
      'Existing note\nUse React.',
    );
  });

  it('never replaces existing draft text', () => {
    expect(appendComposerProposal('Keep me', 'Add me')).toContain('Keep me');
    expect(appendComposerProposal('Keep me', 'Add me')).toContain('Add me');
  });
});
