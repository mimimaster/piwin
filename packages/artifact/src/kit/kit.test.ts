import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeArtifactFence } from '../render-intent.js';
import { createArtifactFenceRecord } from '../fence-index.js';
import { materializeArtifact } from '../materialize.js';
import { buildHtmlArtifactSrcdoc } from '../srcdoc.js';
import {
  ARTIFACT_KIT_V1_ICON_NAMES,
  ARTIFACT_KIT_V1_PATH,
  ARTIFACT_KIT_VERSION_STRING,
  buildArtifactKitV1Script,
  configureArtifactKitDelivery,
  usesArtifactKit,
} from './index.js';

const CHART = '<figure data-piwin-chart="bar"><script type="application/json">{"labels":["a"],"series":[{"values":[1]}]}</script><figcaption>Cap</figcaption></figure>';

afterEach(() => configureArtifactKitDelivery({ kind: 'inline' }));

describe('artifact kit v1', () => {
  it('detects kit markup and API calls only', () => {
    expect(usesArtifactKit(CHART)).toBe(true);
    expect(usesArtifactKit('<i data-piwin-icon="check"></i>')).toBe(true);
    expect(usesArtifactKit('<script>piwin.chart(el, {})</script>')).toBe(true);
    expect(usesArtifactKit('<p>piwin is great</p>')).toBe(false);
    expect(usesArtifactKit('<div data-piwin-media="x"></div>')).toBe(false);
  });

  it('ships the design icon set (≥40) including status and trend shapes', () => {
    expect(ARTIFACT_KIT_V1_ICON_NAMES.length).toBeGreaterThanOrEqual(40);
    for (const name of ['check', 'x', 'alert', 'info', 'clock', 'zap', 'trend-up', 'trend-down', 'shield', 'bug']) {
      expect(ARTIFACT_KIT_V1_ICON_NAMES).toContain(name);
    }
  });

  it('stays inside the size budget and has no eval, fetch or parent access', () => {
    const script = buildArtifactKitV1Script();
    expect(new TextEncoder().encode(script).length).toBeLessThanOrEqual(32 * 1024);
    expect(script).not.toMatch(/\beval\s*\(|new Function|fetch\s*\(|XMLHttpRequest|\bparent\b|\btop\./);
  });

  it('keeps the served kit.js identical to the source (run scripts/emit-kit.ts)', () => {
    const served = readFileSync(new URL('../../kit/v1/kit.js', import.meta.url), 'utf8');
    expect(served).toBe(buildArtifactKitV1Script());
  });

  it('names the kit version in the served path, because the response is cached as immutable', () => {
    expect(ARTIFACT_KIT_V1_PATH).toBe(`/lib/v1/kit-${ARTIFACT_KIT_VERSION_STRING}.js`);
    expect(buildArtifactKitV1Script()).toContain(`var VERSION = '${ARTIFACT_KIT_VERSION_STRING}';`);
  });

  it('inlines the kit only when the source uses it', () => {
    const withKit = buildHtmlArtifactSrcdoc({ source: CHART, channelId: 'c' }).srcdoc;
    expect(withKit).toContain('<script data-piwin-artifact-kit>');
    expect(withKit).toContain('data-piwin-artifact-kit');
    const plain = buildHtmlArtifactSrcdoc({ source: '<p>hi</p>', channelId: 'c' }).srcdoc;
    expect(plain).not.toContain('data-piwin-artifact-kit');
  });

  it('loads from the artifact scheme with a narrow script-src on the desktop path', () => {
    configureArtifactKitDelivery({ kind: 'scheme', origin: 'piwin-artifact://localhost/' });
    const { srcdoc, csp } = buildHtmlArtifactSrcdoc({ source: CHART, channelId: 'c' });
    expect(srcdoc).toContain('<script data-piwin-artifact-kit src="piwin-artifact://localhost/lib/v1/kit-1.1.0.js"></script>');
    expect(srcdoc).not.toContain('if (window.piwin && window.piwin.version) return;');
    expect(csp).toContain("script-src 'unsafe-inline' piwin-artifact://localhost/lib/v1/");
    expect(csp).toContain("connect-src 'none'");
    const plain = buildHtmlArtifactSrcdoc({ source: '<p>hi</p>', channelId: 'c' }).csp;
    expect(plain).toContain("script-src 'unsafe-inline';");
  });

  it('routes kit artifacts to the sandbox renderer and preloads it for v14 streams', () => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({ info: 'artifact-html title="T" style="host"', source: '<p><i data-piwin-icon="check"></i> ok</p>' }),
      { id: 'a', htmlUiModeEnabled: true },
    );
    expect(analysis.kind === 'intent' && analysis.intent.renderer).toBe('sandbox');
    if (analysis.kind !== 'intent') return;
    const stream = materializeArtifact(analysis.intent, { mode: 'stream-preview', source: '<p>', presentation: 'inline' });
    expect(stream.kind === 'render' && stream.document.kind === 'sandbox' && stream.document.srcdoc).toContain('data-piwin-artifact-kit');
  });

  it('does not preload the kit for a legacy stream', () => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({ info: 'artifact-html title="T"', source: '<p>x</p>' }),
      { id: 'a', htmlUiModeEnabled: true, mode: 'stream-preview' },
    );
    if (analysis.kind !== 'intent') throw new Error('expected intent');
    const stream = materializeArtifact(analysis.intent, { mode: 'stream-preview', source: '<p>', presentation: 'inline' });
    expect(stream.kind === 'render' && stream.document.kind === 'sandbox' && stream.document.srcdoc).not.toContain('data-piwin-artifact-kit');
  });
});

describe('kit icon names shared with the prompt', () => {
  it('draws exactly the icon set the contracts reference lists', async () => {
    const { ARTIFACT_KIT_V1_ICONS } = await import('@piwin/contracts');
    expect([...ARTIFACT_KIT_V1_ICON_NAMES].sort()).toEqual([...ARTIFACT_KIT_V1_ICONS].sort());
  });
});
