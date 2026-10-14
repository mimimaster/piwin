import { describe, expect, it } from 'vitest';
import { ARTIFACT_COMPONENT_KIT_CLASSES, ARTIFACT_COMPONENT_KIT_STATES } from '@piwin/contracts';
import { ARTIFACT_KIT_CHART_KINDS, buildArtifactKitCss, buildArtifactKitV1Script } from './kit/index.js';
import { buildArtifactComponentKitCss } from './srcdoc-component-kit.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { buildStreamableArtifactPreview } from './streamable-preview.js';
import { ARTIFACT_V14_TOKEN_NAMES } from './theme-tokens.js';

describe('buildArtifactComponentKitCss', () => {
  const css = buildArtifactComponentKitCss();

  it('styles every class and state of the shared vocabulary', () => {
    for (const kitClass of ARTIFACT_COMPONENT_KIT_CLASSES) {
      expect(css).toContain(`.${kitClass}`);
    }
    for (const state of ARTIFACT_COMPONENT_KIT_STATES) {
      expect(css).toContain(`[data-state="${state}"]`);
    }
  });

  it('keeps every selector inside :where() so author rules win', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((rule) => rule.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector.length > 0);
    for (const selector of selectors) {
      // Only pseudo-elements and child combinators between :where() groups sit outside.
      expect(selector.replace(/::[a-z-]+$/, '').replace(/\) > :where\(/g, ' ')).toMatch(/^:where\(.*\)$/s);
    }
  });

  it('takes color only from host theme variables that exist', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const base = ['bg', 'surface', 'text', 'muted', 'accent', 'on-accent', 'border', 'font'];
    const known = new Set([...base, ...ARTIFACT_V14_TOKEN_NAMES].map((name) => `--piwin-artifact-${name}`));
    for (const variable of new Set(css.match(/--piwin-artifact-[a-z0-9-]+/g))) {
      expect(known.has(variable), variable).toBe(true);
    }
  });

  it('ships last among the host kits and streams without a stylesheet', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({ source: '<ol class="piwin-steps"></ol>', channelId: 'c' });
    expect(srcdoc.indexOf('data-piwin-artifact-component-kit')).toBeGreaterThan(
      srcdoc.indexOf('data-piwin-artifact-diagram-kit'),
    );
    const preview = buildStreamableArtifactPreview('<ol class="piwin-steps"><li data-state="done"><b>解析</b></li><li>渲');
    expect(preview.canStream).toBe(true);
    expect(preview.previewSource).toContain('piwin-steps');
  });
});

describe('chart kinds', () => {
  it('draws every advertised kind and styles the classes the drawing emits', () => {
    const script = buildArtifactKitV1Script();
    for (const kind of ARTIFACT_KIT_CHART_KINDS) {
      expect(script).toMatch(new RegExp(`\\b${kind}: 1\\b`));
    }
    const kitCss = buildArtifactKitCss();
    for (const emitted of new Set(script.match(/'piwin-chart-[a-z]+'/g))) {
      expect(kitCss, emitted).toContain(emitted.slice(1, -1));
    }
  });
});

describe('chart placeholder', () => {
  it('holds a chart\'s place only while its data is withheld by the stream preview', () => {
    const kitCss = buildArtifactKitCss();
    expect(kitCss).toContain('figure[data-piwin-chart]:not([data-piwin-chart-ready]):not(:has(> script))');
    for (const kind of ARTIFACT_KIT_CHART_KINDS.filter((kind) => kind !== 'bar' && kind !== 'line')) {
      expect(kitCss).toContain(`figure[data-piwin-chart="${kind}"]:not([data-piwin-chart-ready]):not(:has(> script))`);
    }
    // The preview keeps the figure and drops its script: that is the state the rule matches.
    const preview = buildStreamableArtifactPreview(
      '<main class="piwin-report"><figure data-piwin-chart="bar"><script type="application/json">{"labels":["a"],"ser',
    );
    expect(preview.previewSource).toContain('<figure data-piwin-chart="bar">');
    expect(preview.previewSource).not.toContain('<script');
  });
});
