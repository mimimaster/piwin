import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ARTIFACT_VIZ_ICONS, ARTIFACT_VIZ_KINDS } from '@piwin/contracts';
import { buildHtmlArtifactSrcdoc } from '../../srcdoc.js';
import { configureArtifactKitDelivery, usesArtifactKit } from '../index.js';
import {
  ARTIFACT_VIZ_ICON_NAMES,
  ARTIFACT_VIZ_PATH,
  ARTIFACT_VIZ_VERSION_STRING,
  buildArtifactVizCss,
  buildArtifactVizScript,
  usesArtifactViz,
} from './index.js';

const VIZ = '<figure data-piwin-viz="array"><script type="application/json">{"items":[1,2]}</script></figure>';
const CHART = '<figure data-piwin-chart="bar"><script type="application/json">{"labels":["a"],"series":[{"values":[1]}]}</script></figure>';

describe('artifact viz kit', () => {
  afterEach(() => configureArtifactKitDelivery({ kind: 'inline' }));

  it('detects viz figures, and they count as kit usage', () => {
    expect(usesArtifactViz(VIZ)).toBe(true);
    expect(usesArtifactKit(VIZ)).toBe(true);
    expect(usesArtifactViz(CHART)).toBe(false);
    expect(usesArtifactViz('<p>data-piwin-vizier</p>')).toBe(false);
  });

  it('implements every kind and icon the contract names', () => {
    const script = buildArtifactVizScript();
    const drawn = [...script.matchAll(/\bVIZ\.(\w+) = function/g)].map((match) => match[1]).sort();
    expect(drawn).toEqual([...ARTIFACT_VIZ_KINDS].sort());
    expect([...ARTIFACT_VIZ_ICON_NAMES]).toEqual([...ARTIFACT_VIZ_ICONS]);
  });

  it('stays inside the size budget and has no eval, fetch or parent access', () => {
    const script = buildArtifactVizScript();
    expect(new TextEncoder().encode(script).length).toBeLessThanOrEqual(32 * 1024);
    expect(script).not.toMatch(/\beval\s*\(|new Function|fetch\s*\(|XMLHttpRequest|\bparent\b|\btop\./);
  });

  it('takes every color from theme tokens', () => {
    const css = buildArtifactVizCss();
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it('keeps the served viz.js identical to the source (run scripts/emit-kit.ts)', () => {
    const served = readFileSync(new URL('../../../kit/v1/viz.js', import.meta.url), 'utf8');
    expect(served).toBe(buildArtifactVizScript());
    expect(ARTIFACT_VIZ_PATH).toBe(`/lib/v1/viz-${ARTIFACT_VIZ_VERSION_STRING}.js`);
  });

  it('injects the viz script only into documents that use it', () => {
    const withViz = buildHtmlArtifactSrcdoc({ source: VIZ, channelId: 'c' }).srcdoc;
    expect(withViz).toContain('piwin artifact viz');
    expect(withViz).toContain('.pv-stage');
    const chartOnly = buildHtmlArtifactSrcdoc({ source: CHART, channelId: 'c' }).srcdoc;
    expect(chartOnly).toContain('piwin artifact kit');
    expect(chartOnly).not.toContain('piwin artifact viz');
    expect(chartOnly).not.toContain('.pv-stage');
  });

  it('loads viz.js from the artifact scheme on the desktop path', () => {
    configureArtifactKitDelivery({ kind: 'scheme', origin: 'piwin-artifact://localhost' });
    const { srcdoc, csp } = buildHtmlArtifactSrcdoc({ source: VIZ, channelId: 'c' });
    expect(srcdoc).toContain(`<script data-piwin-artifact-kit src="piwin-artifact://localhost${ARTIFACT_VIZ_PATH}"></script>`);
    expect(csp).toContain('piwin-artifact://localhost/lib/v1/');
  });
});
