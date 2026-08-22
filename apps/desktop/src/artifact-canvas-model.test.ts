import { describe, expect, it } from 'vitest';
import {
  buildArtifactCanvasTargetId,
  createArtifactCanvasTarget,
  isSameCanvasTarget,
  appendComposerProposal,
  type ArtifactCanvasTarget,
} from './artifact-canvas-model';
import type { ArtifactDescriptor } from '@piwin/artifact';

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
    const target = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 2,
      descriptor: makeDescriptor(),
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
    });
  });

  it('does not include srcdoc, measured height, or theme fields', () => {
    const target = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 0,
      descriptor: makeDescriptor(),
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
      descriptor: makeDescriptor({ surface: 'canvas', type: 'svg' }),
    });
    expect(target.surface).toBe('canvas');
    expect(target.type).toBe('svg');
  });
});

describe('isSameCanvasTarget', () => {
  it('matches by stable id, not by source content', () => {
    const a = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 1,
      descriptor: makeDescriptor({ source: '<div>v1</div>' }),
    });
    const b = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 1,
      descriptor: makeDescriptor({ source: '<div>v2 regenerated</div>' }),
    });
    expect(isSameCanvasTarget(a, b)).toBe(true);
  });

  it('rejects different fence indices even in the same message', () => {
    const a = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 1,
      descriptor: makeDescriptor(),
    });
    const b = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 2,
      descriptor: makeDescriptor(),
    });
    expect(isSameCanvasTarget(a, b)).toBe(false);
  });

  it('treats null current target as not-same', () => {
    const candidate = createArtifactCanvasTarget({
      sessionId: 's1',
      messageId: 'm1',
      fenceIndex: 0,
      descriptor: makeDescriptor(),
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
