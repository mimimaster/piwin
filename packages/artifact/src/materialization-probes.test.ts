import { describe, expect, it } from 'vitest';
import { tryParseHtmlArtifactFence } from './parser.js';
import { evaluateCodeFence } from './evaluate.js';

/**
 * Probe matrix: which "prompts" (fence language + source) materialize an artifact.
 * `materializes: true` means the fence becomes a renderable HTML/SVG artifact,
 * not a plain code block.
 */
const PROBES: Array<{
  label: string;
  language: string;
  source: string;
  htmlUiModeEnabled?: boolean;
  expectMaterialized: boolean;
}> = [
  // 1. Explicit artifact aliases — always materialize.
  {
    label: 'artifact-html alias',
    language: 'artifact-html title="Demo"',
    source: '<button>Hi</button>',
    expectMaterialized: true,
  },
  {
    label: 'ui-html alias',
    language: 'ui-html',
    source: '<div>x</div>',
    expectMaterialized: true,
  },
  {
    label: 'html-artifact alias',
    language: 'html-artifact',
    source: '<section></section>',
    expectMaterialized: true,
  },
  // 2. Fuzzy `artifact*` languages are ordinary code (explicit aliases + native only).
  {
    label: 'artifact alias + html-like source',
    language: 'artifact',
    source: '<div class="card">x</div>',
    expectMaterialized: false,
  },
  {
    label: 'artifact alias + placeholder source',
    language: 'artifact',
    source: 'TODO',
    expectMaterialized: false,
  },
  {
    label: 'artifact alias + non-html source',
    language: 'artifact',
    source: 'const x = 1;',
    expectMaterialized: false,
  },
  // 3. Native html fence — only when htmlUiMode on AND UI-like source.
  {
    label: 'native html + UI-like + mode on',
    language: 'html',
    source: '<div class="card"><button>OK</button></div>',
    htmlUiModeEnabled: true,
    expectMaterialized: true,
  },
  {
    label: 'native html + UI-like + mode off',
    language: 'html',
    source: '<div class="card"><button>OK</button></div>',
    htmlUiModeEnabled: false,
    expectMaterialized: false,
  },
  {
    label: 'native html + non-UI snippet + mode on',
    language: 'html',
    source: '<p>just text</p>',
    htmlUiModeEnabled: true,
    expectMaterialized: false,
  },
  // 4. Native svg fence — needs mode on + svg-shaped source.
  {
    label: 'native svg + svg source + mode on',
    language: 'svg title="Pelican"',
    source: '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"><circle r="5" /></svg>',
    htmlUiModeEnabled: true,
    expectMaterialized: true,
  },
  {
    label: 'native svg + non-svg source',
    language: 'svg',
    source: '<div>not svg</div>',
    htmlUiModeEnabled: true,
    expectMaterialized: false,
  },
  // 5. Plain code fences — never materialize.
  {
    label: 'ts code fence',
    language: 'ts',
    source: 'const x = 1',
    expectMaterialized: false,
  },
  {
    label: 'python code fence',
    language: 'python',
    source: 'print("hi")',
    expectMaterialized: false,
  },
];

describe('artifact materialization probes', () => {
  for (const probe of PROBES) {
    it(`${probe.expectMaterialized ? 'materializes' : 'stays code'}: ${probe.label}`, () => {
      const descriptor = tryParseHtmlArtifactFence({
        language: probe.language,
        source: probe.source,
        id: 'probe',
        htmlUiModeEnabled: probe.htmlUiModeEnabled ?? false,
      });
      const materialized = descriptor !== null;
      expect(materialized).toBe(probe.expectMaterialized);
    });
  }

  it('evaluateCodeFence end-to-end: artifact-html → renderable decision', () => {
    const decision = evaluateCodeFence({
      language: 'artifact-html title="Counter"',
      source:
        '<button id="b">0</button><script>const b=document.getElementById("b");b.onclick=()=>b.textContent=String(+b.textContent+1);</script>',
    });
    expect(decision.kind).toBe('render');
  });

  it('evaluateCodeFence end-to-end: ts fence → code (no materialization)', () => {
    const decision = evaluateCodeFence({
      language: 'ts',
      source: 'const x: number = 1;',
    });
    expect(decision.kind).toBe('code');
  });
});
