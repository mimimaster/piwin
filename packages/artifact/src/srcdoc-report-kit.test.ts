import { describe, expect, it } from 'vitest';
import { ARTIFACT_REPORT_KIT_CLASSES, ARTIFACT_REPORT_KIT_TONES } from '@piwin/contracts';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { buildArtifactReportKitCss } from './srcdoc-report-kit.js';
import { buildStreamableArtifactPreview } from './streamable-preview.js';

/** Selector lists of every rule, with declarations and comments removed. */
function selectorLists(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((rule) => rule.split('{')[0]?.trim() ?? '')
    .filter((selector) => selector.length > 0);
}

/** Splits `a, b` at the top level only, leaving `:where(a, b)` intact. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
}

/** True when nothing outside a `:where(...)` contributes specificity. */
function hasZeroSpecificity(selector: string): boolean {
  let depth = 0;
  let outside = '';
  for (let index = 0; index < selector.length; index += 1) {
    if (depth === 0 && selector.startsWith(':where(', index)) {
      depth = 1;
      index += ':where('.length - 1;
      continue;
    }
    const character = selector[index];
    if (depth > 0) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      continue;
    }
    outside += character;
  }
  return outside.replace(/[\s>+~]/g, '').length === 0;
}

describe('buildArtifactReportKitCss', () => {
  const css = buildArtifactReportKitCss();

  it('styles every class and tone of the shared vocabulary', () => {
    for (const kitClass of ARTIFACT_REPORT_KIT_CLASSES) {
      expect(css).toContain(`.${kitClass}`);
    }
    for (const tone of ARTIFACT_REPORT_KIT_TONES) {
      expect(css).toContain(`[data-tone="${tone}"]`);
    }
  });

  it('stays a zero-specificity default apart from the page measure and code radius', () => {
    const weighted = selectorLists(css)
      .flatMap(splitSelectorList)
      .filter((selector) => !hasZeroSpecificity(selector));
    expect(weighted).toEqual([
      '.piwin-report code',
      '.piwin-report pre code',
      'html:not([data-frame-mode="inline-flow"]) .piwin-artifact-root > .piwin-report',
      'html:not([data-frame-mode="inline-flow"]) body > .piwin-report',
      'html:not([data-frame-mode="inline-flow"]) .piwin-artifact-root > .piwin-report[data-width="wide"]',
      'html:not([data-frame-mode="inline-flow"]) body > .piwin-report[data-width="wide"]',
    ]);
  });

  it('uses only the host theme variables for color', () => {
    const variables = new Set(css.match(/--piwin-artifact-[a-z-]+/g));
    expect([...variables].sort()).toEqual([
      '--piwin-artifact-accent',
      '--piwin-artifact-border',
      '--piwin-artifact-font',
      '--piwin-artifact-font-mono',
      '--piwin-artifact-muted',
      '--piwin-artifact-surface',
      '--piwin-artifact-text',
    ]);
  });

  it('ships in every sandbox document, before the author source', () => {
    for (const documentKind of ['fragment', 'document'] as const) {
      const source =
        documentKind === 'document'
          ? '<!doctype html><html><head><style>h1{color:red}</style></head><body><main class="piwin-report"><h1>T</h1></main></body></html>'
          : '<main class="piwin-report"><h1>T</h1></main>';
      const { srcdoc } = buildHtmlArtifactSrcdoc({
        source,
        channelId: 'kit',
        surface: 'canvas',
        documentKind,
      });
      const kitIndex = srcdoc.indexOf('data-piwin-artifact-report-kit');
      expect(kitIndex).toBeGreaterThan(-1);
      expect(kitIndex).toBeLessThan(srcdoc.indexOf('<main class="piwin-report">'));
      if (documentKind === 'document') {
        expect(kitIndex).toBeLessThan(srcdoc.indexOf('h1{color:red}'));
      }
    }
  });
});

describe('report kit streaming', () => {
  it('streams a kit report from its first word, with no stylesheet to wait for', () => {
    const preview = buildStreamableArtifactPreview(
      '<main class="piwin-report">\n<header><h1>订阅 OAuth 登录</h1><p class="piwin-meta">排查范',
    );
    expect(preview.canStream).toBe(true);
    expect(preview.previewSource).toContain('订阅 OAuth 登录');
    expect(preview.previewSource).toContain('排查范');
  });

  it('still withholds author classes that have no stylesheet yet', () => {
    const preview = buildStreamableArtifactPreview(
      '<main class="piwin-report"><h1>Title</h1><div class="my-chart"><span>bar',
    );
    expect(preview.canStream).toBe(true);
    expect(preview.previewSource).toContain('Title');
    expect(preview.previewSource).not.toContain('my-chart');
  });
});
