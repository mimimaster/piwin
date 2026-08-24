import { describe, expect, it } from 'vitest';
import { STREAMING_ARTIFACT_FENCE_MARKER } from './constants.js';
import { createArtifactFenceRecord } from './fence-index.js';
import { analyzeArtifactFence } from './render-intent.js';
import type { ArtifactFenceAnalysis, ArtifactLayoutIntent, ArtifactRenderMode } from './types.js';
import {
  BLOCKED_EXTERNAL_HTML,
  EXPLICIT_CANVAS_HTML,
  FOUR_EDGE_FIXED_SHELL_HTML,
  FULL_HTML_DOCUMENT_SOURCE,
  INERT_FRAGMENT_HTML,
  NATIVE_SVG_SOURCE,
  SCRIPT_FRAGMENT_HTML,
  VIEWPORT_100VH_HTML,
} from '../fixtures/html.js';

type RoutingExpectation =
  | { kind: 'code' }
  | { kind: 'blocked'; reason: 'blocked-empty' | 'blocked-too-large' | 'blocked-external-resource' }
  | {
      kind: 'intent';
      surface: 'inline' | 'canvas';
      layout: ArtifactLayoutIntent;
      renderer: 'static' | 'sandbox';
    };

type RoutingCase = {
  id: string;
  info: string;
  source: string;
  htmlUiModeEnabled?: boolean;
  mode?: ArtifactRenderMode;
  open?: boolean;
  maxBytes?: number;
  expected: RoutingExpectation;
};

const ROUTING_CASES: readonly RoutingCase[] = [
  {
    id: 'static-flow',
    info: 'artifact-html',
    source: INERT_FRAGMENT_HTML,
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'static' },
  },
  {
    id: 'sandbox-flow-script-fragment',
    info: 'artifact-html',
    source: SCRIPT_FRAGMENT_HTML,
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'native-svg',
    info: 'svg',
    source: NATIVE_SVG_SOURCE,
    htmlUiModeEnabled: true,
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'static' },
  },
  {
    id: 'viewport-100vh-innerHeight',
    info: 'artifact-html',
    source: VIEWPORT_100VH_HTML,
    expected: { kind: 'intent', surface: 'inline', layout: 'viewport', renderer: 'sandbox' },
  },
  {
    id: 'four-edge-fixed-page-shell',
    info: 'artifact-html',
    source: FOUR_EDGE_FIXED_SHELL_HTML,
    expected: { kind: 'intent', surface: 'inline', layout: 'viewport', renderer: 'sandbox' },
  },
  {
    id: 'full-html-document',
    info: 'html',
    source: FULL_HTML_DOCUMENT_SOURCE,
    htmlUiModeEnabled: true,
    expected: { kind: 'intent', surface: 'inline', layout: 'viewport', renderer: 'sandbox' },
  },
  {
    id: 'explicit-canvas',
    info: 'artifact-html title="Wide workspace" surface="canvas"',
    source: EXPLICIT_CANVAS_HTML,
    expected: { kind: 'intent', surface: 'canvas', layout: 'canvas', renderer: 'sandbox' },
  },
  {
    id: 'unknown-surface-defaults-inline',
    info: 'artifact-html surface="sideways"',
    source: '<section>Fallback</section>',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'static' },
  },
  {
    id: 'blocked-external',
    info: 'artifact-html',
    source: BLOCKED_EXTERNAL_HTML,
    expected: { kind: 'blocked', reason: 'blocked-external-resource' },
  },
  {
    id: 'blocked-too-large',
    info: 'artifact-html',
    source: `<div>${'x'.repeat(64)}</div>`,
    maxBytes: 16,
    expected: { kind: 'blocked', reason: 'blocked-too-large' },
  },
  {
    id: 'blocked-empty',
    info: 'artifact-html',
    source: '',
    expected: { kind: 'blocked', reason: 'blocked-empty' },
  },
  {
    id: 'streaming-empty-mounts',
    info: 'artifact-html',
    source: '',
    mode: 'stream-preview',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'streaming-incomplete-native-html',
    info: `html ${STREAMING_ARTIFACT_FENCE_MARKER}`,
    source: '<',
    htmlUiModeEnabled: true,
    mode: 'stream-preview',
    open: true,
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'ts-stays-code',
    info: 'ts',
    source: 'export const x = 1',
    expected: { kind: 'code' },
  },
  {
    id: 'url-text-is-not-external',
    info: 'artifact-html',
    source: '<p>Documentation: https://example.com/reference</p>',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'static' },
  },
  {
    id: 'form-is-sandbox-flow',
    info: 'artifact-html',
    source: '<form><button>Submit</button></form>',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'event-handler-is-sandbox-flow',
    info: 'artifact-html',
    source: '<button onclick="openPanel()">Open</button>',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'css-url-is-sandbox-flow',
    info: 'artifact-html',
    source: '<div style="background-image:url(https://cdn.example.com/card.png)">UI</div>',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'shadow-host-is-sandbox-flow',
    info: 'artifact-html',
    source: '<style>:host { color: red }</style><div>UI</div>',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
  {
    id: 'relative-img-is-sandbox-flow',
    info: 'artifact-html',
    source: '<img src="/generated/chart.png" alt="Chart">',
    expected: { kind: 'intent', surface: 'inline', layout: 'flow', renderer: 'sandbox' },
  },
];

function summarize(analysis: ArtifactFenceAnalysis): RoutingExpectation {
  if (analysis.kind === 'code') {
    return { kind: 'code' };
  }
  if (analysis.kind === 'blocked') {
    return { kind: 'blocked', reason: analysis.reason };
  }
  return {
    kind: 'intent',
    surface: analysis.intent.surface,
    layout: analysis.intent.layout,
    renderer: analysis.intent.renderer,
  };
}

describe('artifact routing table', () => {
  it.each(ROUTING_CASES)('$id', (row) => {
    const record = createArtifactFenceRecord({
      info: row.info,
      source: row.source,
      ...(row.open === true ? { open: true } : {}),
    });
    const analysis = analyzeArtifactFence(record, {
      id: `route-${row.id}`,
      ...(row.htmlUiModeEnabled !== undefined
        ? { htmlUiModeEnabled: row.htmlUiModeEnabled }
        : {}),
      ...(row.mode !== undefined ? { mode: row.mode } : {}),
      ...(row.maxBytes !== undefined ? { maxBytes: row.maxBytes } : {}),
    });
    expect(summarize(analysis)).toEqual(row.expected);
  });
});
