import { describe, expect, it } from 'vitest';
import {
  advanceArtifactDocumentPhase,
  artifactDocumentKey,
  buildArtifactDocumentDataUrl,
  initialArtifactDocumentPhase,
} from './artifact-frame-stream.js';

function decodeDataUrl(url: string): string {
  const separator = url.indexOf(',');
  if (separator < 0) {
    throw new Error('Artifact data URL has no payload');
  }
  const binary = atob(url.slice(separator + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe('Artifact document transport', () => {
  it('round-trips Unicode HTML through an opaque data URL', () => {
    const srcdoc = '<!doctype html><title>鹈鹕</title><div>自然撑开</div>';
    const url = buildArtifactDocumentDataUrl(srcdoc);

    expect(url).toMatch(/^data:text\/html;charset=utf-8;base64,/);
    expect(decodeDataUrl(url)).toBe(srcdoc);
  });
});

describe('artifact document lifecycle', () => {
  it('keeps an empty stream shell until the first stable snapshot, then seeds it', () => {
    expect(initialArtifactDocumentPhase('stream-preview', '')).toBe('empty-stream');
    expect(initialArtifactDocumentPhase('stream-preview', '<div>ready</div>')).toBe(
      'seeded-stream',
    );
    expect(initialArtifactDocumentPhase('interactive', '<div>done</div>')).toBe('final');

    const seeded = advanceArtifactDocumentPhase(
      'empty-stream',
      'stream-preview',
      '<style>.x{}</style><div class="x">ok</div>',
    );
    expect(seeded).toBe('seeded-stream');
    expect(artifactDocumentKey(seeded, 'canvas-1', '<html>seeded</html>')).toBe(
      'stream:canvas-1:seeded',
    );
    expect(
      advanceArtifactDocumentPhase(seeded, 'stream-preview', '<div>more</div>'),
    ).toBe('seeded-stream');
  });

  it('loads the final document on completion instead of freezing the stream shell', () => {
    const completed = advanceArtifactDocumentPhase(
      'seeded-stream',
      'interactive',
      '<div>done</div>',
    );
    expect(completed).toBe('final');
    expect(artifactDocumentKey(completed, 'canvas-1', '<html>final</html>')).toBe(
      'final:canvas-1:<html>final</html>',
    );
  });

  it('starts a new stream document after a completed canvas is updated', () => {
    expect(advanceArtifactDocumentPhase('final', 'stream-preview', '')).toBe('empty-stream');
    expect(advanceArtifactDocumentPhase('final', 'stream-preview', '<div>next</div>')).toBe(
      'seeded-stream',
    );
  });
});
