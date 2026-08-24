import { describe, expect, it } from 'vitest';
import { STREAMING_ARTIFACT_FENCE_MARKER } from './constants.js';
import { createArtifactFenceRecord } from './fence-index.js';
import { parseArtifactFenceRecord } from './parser.js';

function parse(
  info: string,
  source: string,
  options: {
    id?: string;
    htmlUiModeEnabled?: boolean;
    allowIncompleteSource?: boolean;
    open?: boolean;
  } = {},
) {
  return parseArtifactFenceRecord(
    createArtifactFenceRecord({
      info,
      source,
      ...(options.open === true ? { open: true } : {}),
    }),
    {
      id: options.id ?? 'a1',
      ...(options.htmlUiModeEnabled !== undefined
        ? { htmlUiModeEnabled: options.htmlUiModeEnabled }
        : {}),
      ...(options.allowIncompleteSource !== undefined
        ? { allowIncompleteSource: options.allowIncompleteSource }
        : {}),
    },
  );
}

describe('parseArtifactFenceRecord', () => {
  it('promotes artifact-html fences', () => {
    const descriptor = parse('artifact-html title="Demo"', '<button>Hi</button>');
    expect(descriptor?.type).toBe('html');
    expect(descriptor?.title).toBe('Demo');
    expect(descriptor?.surface).toBe('inline');
    expect(descriptor?.declaration).toBe('explicit');
    expect(descriptor?.documentKind).toBe('fragment');
  });

  it('parses an explicit Canvas surface and safely defaults unknown values', () => {
    const canvas = parse(
      'artifact-html title="Workspace" surface="canvas"',
      '<main>Workspace</main>',
      { id: 'canvas-1' },
    );
    const unknown = parse('artifact-html surface="sideways"', '<main>Fallback</main>', {
      id: 'canvas-2',
    });

    expect(canvas?.surface).toBe('canvas');
    expect(unknown?.surface).toBe('inline');
  });

  it('promotes native html when UI-like and mode on', () => {
    const descriptor = parse('html', '<div class="card"><button>OK</button></div>', {
      id: 'a2',
      htmlUiModeEnabled: true,
    });
    expect(descriptor?.type).toBe('html');
    expect(descriptor?.declaration).toBe('native');
  });

  it('promotes marked native HTML from its first streaming token', () => {
    const descriptor = parse(`html ${STREAMING_ARTIFACT_FENCE_MARKER}`, '<', {
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

  it('promotes an open native HTML fence without the stream marker', () => {
    const descriptor = parse('html', '<', {
      id: 'native-html-open',
      htmlUiModeEnabled: true,
      allowIncompleteSource: true,
      open: true,
    });
    expect(descriptor).toMatchObject({
      type: 'html',
      declaration: 'native',
      source: '<',
    });
  });

  it('keeps unmarked pre-structure native HTML as code during stream preview', () => {
    expect(
      parse('html', '<', {
        id: 'native-html-closed-stream',
        htmlUiModeEnabled: true,
        allowIncompleteSource: true,
      }),
    ).toBeNull();
  });

  it('preserves a native full document byte-for-byte and marks it as code-origin', () => {
    const source =
      '<!DOCTYPE html><html class="app"><head><title>Demo</title></head><body data-page="true"><main>UI</main></body></html>';
    const descriptor = parse('html', source, {
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
    const descriptor = parse('html', '<div class="card"><button>OK</button></div>', {
      id: 'a3',
      htmlUiModeEnabled: false,
    });
    expect(descriptor).toBeNull();
  });

  it('keeps plain code fences as non-artifacts', () => {
    expect(parse('ts', 'const x = 1', { id: 'a4' })).toBeNull();
  });

  it('does not promote fuzzy artifact* languages', () => {
    expect(parse('artifact', '<div class="card">x</div>', { id: 'ambiguous' })).toBeNull();
  });

  it('promotes a valid svg fence when Artifact parsing is enabled', () => {
    const descriptor = parse(
      'svg title="Pelican"',
      '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"><circle r="5" /></svg>',
      {
        id: 'svg-1',
        htmlUiModeEnabled: true,
      },
    );
    expect(descriptor).toMatchObject({
      type: 'svg',
      title: 'Pelican',
      rawLanguage: 'svg title="Pelican"',
      alias: 'svg',
    });
    expect(descriptor?.source).toContain('<svg');
  });

  it('promotes marked native SVG before its root tag arrives', () => {
    const descriptor = parse(`svg ${STREAMING_ARTIFACT_FENCE_MARKER}`, '<', {
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
      parse('svg', '<svg><circle r="5" /></svg>', {
        id: 'svg-2',
        htmlUiModeEnabled: false,
      }),
    ).toBeNull();
  });

  it('rejects a non-svg source in an svg fence', () => {
    expect(
      parse('svg', '<div>not an SVG</div>', {
        id: 'svg-3',
        htmlUiModeEnabled: true,
      }),
    ).toBeNull();
  });
});
