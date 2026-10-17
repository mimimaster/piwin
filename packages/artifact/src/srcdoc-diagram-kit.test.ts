import { describe, expect, it } from 'vitest';
import { ARTIFACT_DIAGRAM_KIT_CLASSES } from '@piwin/contracts';
import { buildArtifactDiagramKitCss } from './srcdoc-diagram-kit.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { buildStreamableArtifactPreview } from './streamable-preview.js';

describe('buildArtifactDiagramKitCss', () => {
  const css = buildArtifactDiagramKitCss();

  it('styles every class of the shared vocabulary', () => {
    for (const kitClass of ARTIFACT_DIAGRAM_KIT_CLASSES) {
      expect(css).toContain(`.${kitClass}`);
    }
  });

  it('keeps every selector inside :where() so author rules win', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((rule) => rule.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector.length > 0);
    for (const selector of selectors) {
      // Only the arrow / rail pseudo-elements may sit outside.
      expect(selector.replace(/::(?:before|after)$/, '')).toMatch(/^:where\(.*\)$/s);
    }
  });

  it('takes color only from the host theme variables', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    const variables = new Set(css.match(/--piwin-artifact-[a-z0-9-]+/g));
    expect([...variables].sort()).toEqual([
      '--piwin-artifact-border',
      '--piwin-artifact-font',
      '--piwin-artifact-info',
      '--piwin-artifact-muted',
      '--piwin-artifact-ok',
      '--piwin-artifact-risk',
      '--piwin-artifact-surface',
      '--piwin-artifact-text',
      '--piwin-artifact-warn',
    ]);
  });

  it('draws diagrams flat: no drop shadow anywhere', () => {
    expect(css).not.toContain('shadow-1');
    expect(css).not.toMatch(/box-shadow:\s*0\s+[0-9.]+px\s+[0-9.]+px/);
  });

  it('writes lane steps as text on the lane and prints each handoff target', () => {
    expect(css).toContain('content: "→ " attr(data-to)');
    expect(css).toContain(':where(.piwin-lanes td > [data-to])::after');
    // A lane step carries a status dot, not a card border.
    expect(css).toMatch(/:where\(\.piwin-lanes td > p, \.piwin-lanes td > div\) \{\s*position: relative;\s*margin: 0;\s*padding: 0 0 0 0\.95em;/);
  });

  it('numbers phase headers across, or phase rows when the lanes run down', () => {
    expect(css).toContain(':where(.piwin-lanes:not([data-dir="down"]) thead th:not(:first-child))::before');
    expect(css).toContain(':where(.piwin-lanes[data-dir="down"] tbody th)::before');
    expect(css).toContain(':where(.piwin-lanes[data-dir="down"] tbody tr:not(:last-child) th)::after');
  });


  it('marks toned steps with a straight left accent, not a curved inset shadow', () => {
    expect(css).toContain('linear-gradient(');
    expect(css).toContain('0 0 / 3px 100% no-repeat');
    // Fail closed: inset left shadows bend into a concave arc on rounded cards.
    expect(css).not.toMatch(/box-shadow:\s*inset\s+[0-9.]+px\s+0\s+0/);
  });

  it('ships in every sandbox document after the report kit', () => {
    const { srcdoc } = buildHtmlArtifactSrcdoc({
      source: '<main class="piwin-report"><table class="piwin-lanes"></table></main>',
      channelId: 'diagram',
      surface: 'canvas',
    });
    const reportIndex = srcdoc.indexOf('data-piwin-artifact-report-kit');
    const diagramIndex = srcdoc.indexOf('data-piwin-artifact-diagram-kit');
    expect(reportIndex).toBeGreaterThan(-1);
    // Equal weight: the lanes table only beats the report's `table` by order.
    expect(diagramIndex).toBeGreaterThan(reportIndex);
    expect(diagramIndex).toBeLessThan(srcdoc.indexOf('<main class="piwin-report">'));
  });
});

describe('diagram kit streaming', () => {
  it('streams a flow as it is written, with no stylesheet to wait for', () => {
    const preview = buildStreamableArtifactPreview(
      '<ol class="piwin-flow"><li><b>解析</b></li><li data-tone="ok">渲',
    );
    expect(preview.canStream).toBe(true);
    expect(preview.previewSource).toContain('piwin-flow');
    expect(preview.previewSource).toContain('解析');
  });
});
