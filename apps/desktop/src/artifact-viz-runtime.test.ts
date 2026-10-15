// @vitest-environment happy-dom
/**
 * Executes viz.js (ADR 0093) in a DOM, the way the sandbox iframe does, over
 * the approved 408 samples, plus the kit v1 line annotations.
 */
import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_VIZ_KINDS } from '@piwin/contracts';
import { buildArtifactKitV1Script, buildArtifactVizScript } from '@piwin/artifact';
import { ARTIFACT_LINE_ANNOTATION_SAMPLE, ARTIFACT_VIZ_EXTRA_SAMPLES, ARTIFACT_VIZ_SAMPLES, artifactVizFigure } from '@piwin/artifact/fixtures';

function mount(body: string): void {
  document.body.innerHTML = body;
  // Run the same bytes the iframe receives; a fresh run hydrates synchronously
  // on load, so the test does not depend on observer/frame timing.
  delete (window as unknown as { __piwinViz?: string }).__piwinViz;
  window.eval(buildArtifactVizScript());
}

/** Waits for the kit's observer-driven hydration instead of a fixed delay. */
async function settle(selector: string): Promise<void> {
  await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull(), { timeout: 2000 });
}

describe('artifact viz runtime', () => {
  it.each(ARTIFACT_VIZ_KINDS.map((kind) => [kind]))('draws the %s sample and rests on its last step', (kind) => {
    const sample = ARTIFACT_VIZ_SAMPLES[kind];
    mount(artifactVizFigure(kind, sample.spec, sample.title));
    const figure = document.querySelector('figure')!;
    expect(figure.hasAttribute('data-piwin-viz-ready')).toBe(true);
    const stage = figure.querySelector('.pv-stage')!;
    expect(stage.innerHTML.length).toBeGreaterThan(40);
    expect(figure.querySelector('figcaption')?.textContent).toBe(sample.title);
    const steps = (sample.spec.steps as unknown[] | undefined)?.length ?? 0;
    if (steps > 1) {
      expect(figure.querySelector('.pv-count')?.textContent).toBe(`${steps}/${steps}`);
    } else {
      expect(figure.querySelector('.pv-bar')).toBeNull();
    }
  });

  it('draws the page-replacement grid and the header bitfield', () => {
    for (const { kind, sample } of ARTIFACT_VIZ_EXTRA_SAMPLES) {
      mount(artifactVizFigure(kind, sample.spec, sample.title));
      expect(document.querySelector('.pv-stage')?.innerHTML.length).toBeGreaterThan(40);
    }
    expect(document.querySelectorAll('.pv-hdr .pv-hf')).toHaveLength(16);
  });

  it('steps back and forth with the player buttons', () => {
    mount(artifactVizFigure('stack', ARTIFACT_VIZ_SAMPLES.stack.spec, '栈'));
    const figure = document.querySelector('figure')!;
    const press = (action: string) => (figure.querySelector(`[data-pv="${action}"]`) as HTMLButtonElement).click();
    press('prev');
    expect(figure.querySelector('.pv-count')?.textContent).toBe('5/6');
    expect(figure.querySelector('.pv-note')?.textContent).toBe('pop → 3');
    press('next');
    press('next');
    expect(figure.querySelector('.pv-count')?.textContent).toBe('6/6');
  });

  it('writes model strings as text, never as markup', () => {
    const evil = '<img src=x onerror="alert(1)">';
    mount(artifactVizFigure('array', { items: [evil], pointers: { 0: evil }, table: { rows: [[evil, evil]] } }, 'x'));
    const figure = document.querySelector('figure')!;
    expect(figure.querySelector('.pv-stage img')).toBeNull();
    expect(figure.querySelector('.pv-cell')?.textContent).toBe(evil);
  });

  it('ignores tones outside the allowlist', () => {
    mount(artifactVizFigure('array', { items: [1], marks: { 0: 'red" onclick="x' } }, 'x'));
    const cell = document.querySelector('.pv-cell')!;
    expect(cell.hasAttribute('data-t')).toBe(false);
    expect(cell.hasAttribute('onclick')).toBe(false);
  });
});

describe('kit v1 line annotations', () => {
  it('draws threshold segments and labelled marks', async () => {
    document.body.innerHTML = `<figure data-piwin-chart="line"><script type="application/json">${JSON.stringify(ARTIFACT_LINE_ANNOTATION_SAMPLE)}</script></figure>`;
    const existing = (window as unknown as { piwin?: { hydrate: (root: ParentNode) => void } }).piwin;
    if (existing) existing.hydrate(document);
    else window.eval(buildArtifactKitV1Script());
    await settle('.piwin-chart-ref');
    expect(document.querySelectorAll('.piwin-chart-ref')).toHaveLength(3);
    const labels = [...document.querySelectorAll('text.piwin-chart-value')].map((node) => node.textContent);
    expect(labels).toContain('超时');
    expect(labels).toContain('3 个重复 ACK');
  });
});
