import { describe, expect, it } from 'vitest';
import { STREAMING_ARTIFACT_FENCE_MARKER } from './constants.js';
import { tryParseHtmlArtifactFence } from './parser.js';

describe('tryParseHtmlArtifactFence', () => {
  it('promotes artifact-html fences', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'artifact-html title="Demo"',
      source: '<button>Hi</button>',
      id: 'a1',
    });
    expect(descriptor?.type).toBe('html');
    expect(descriptor?.title).toBe('Demo');
    expect(descriptor?.surface).toBe('inline');
    expect(descriptor?.declaration).toBe('explicit');
    expect(descriptor?.documentKind).toBe('fragment');
  });

  it('parses an explicit Canvas surface and safely defaults unknown values', () => {
    const canvas = tryParseHtmlArtifactFence({
      language: 'artifact-html title="Workspace" surface="canvas"',
      source: '<main>Workspace</main>',
      id: 'canvas-1',
    });
    const unknown = tryParseHtmlArtifactFence({
      language: 'artifact-html surface="sideways"',
      source: '<main>Fallback</main>',
      id: 'canvas-2',
    });

    expect(canvas?.surface).toBe('canvas');
    expect(unknown?.surface).toBe('inline');
  });

  it('promotes native html when UI-like and mode on', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'html',
      source: '<div class="card"><button>OK</button></div>',
      id: 'a2',
      htmlUiModeEnabled: true,
    });
    expect(descriptor?.type).toBe('html');
    expect(descriptor?.declaration).toBe('native');
  });

  it('promotes marked native HTML from its first streaming token', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: `html ${STREAMING_ARTIFACT_FENCE_MARKER}`,
      source: '<',
      id: 'native-html-stream',
      htmlUiModeEnabled: true,
      allowIncompleteSource: true,
    });

    expect(descriptor).toMatchObject({
      type: 'html',
      declaration: 'native',
      rawLanguage: 'html',
      source: '<',
    });
  });

  it('keeps unmarked pre-structure native HTML as code during stream preview', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'html',
        source: '<',
        id: 'native-html-closed-stream',
        htmlUiModeEnabled: true,
        allowIncompleteSource: true,
      }),
    ).toBeNull();
  });

  it('preserves a native full document byte-for-byte and marks it as code-origin', () => {
    const source =
      '<!DOCTYPE html><html class="app"><head><title>Demo</title></head><body data-page="true"><main>UI</main></body></html>';
    const descriptor = tryParseHtmlArtifactFence({
      language: 'html',
      source,
      id: 'native-document',
      htmlUiModeEnabled: true,
    });

    expect(descriptor).toMatchObject({
      declaration: 'native',
      documentKind: 'document',
      source,
    });
  });

  it('does not promote plain html snippets when mode off', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'html',
      source: '<div class="card"><button>OK</button></div>',
      id: 'a3',
      htmlUiModeEnabled: false,
    });
    expect(descriptor).toBeNull();
  });

  it('keeps plain code fences as non-artifacts', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'ts',
        source: 'const x = 1',
        id: 'a4',
      }),
    ).toBeNull();
  });

  it('does not promote fuzzy artifact* languages', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'artifact',
        source: '<div class="card">x</div>',
        id: 'ambiguous',
      }),
    ).toBeNull();
  });

  it('promotes a valid svg fence when Artifact parsing is enabled', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'svg title="Pelican"',
      source: '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"><circle r="5" /></svg>',
      id: 'svg-1',
      htmlUiModeEnabled: true,
    });
    expect(descriptor).toMatchObject({
      type: 'svg',
      title: 'Pelican',
      rawLanguage: 'svg title="Pelican"',
      alias: 'svg',
    });
    expect(descriptor?.source).toContain('<svg');
  });

  it('promotes marked native SVG before its root tag arrives', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: `svg ${STREAMING_ARTIFACT_FENCE_MARKER}`,
      source: '<',
      id: 'native-svg-stream',
      htmlUiModeEnabled: true,
      allowIncompleteSource: true,
    });

    expect(descriptor).toMatchObject({
      type: 'svg',
      declaration: 'native',
      rawLanguage: 'svg',
      source: '<',
    });
  });

  it('keeps svg source as code when Artifact parsing is disabled', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'svg',
        source: '<svg><circle r="5" /></svg>',
        id: 'svg-2',
        htmlUiModeEnabled: false,
      }),
    ).toBeNull();
  });

  it('rejects a non-svg source in an svg fence', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'svg',
        source: '<div>not an SVG</div>',
        id: 'svg-3',
        htmlUiModeEnabled: true,
      }),
    ).toBeNull();
  });
});
