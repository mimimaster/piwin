// @vitest-environment happy-dom
/**
 * Executes kit.js v1 in a DOM, the way the sandbox iframe does.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildArtifactKitV1Script } from '@piwin/artifact';

type KitApi = {
  version: string;
  chart: (el: Element, spec: unknown) => Element | null;
  icon: (name: string, size?: number) => string;
  hydrate: (root?: ParentNode) => void;
};

function loadKit(body: string): KitApi {
  document.body.innerHTML = body;
  const existing = (window as unknown as { piwin?: KitApi }).piwin;
  if (existing) {
    // window.piwin is frozen and non-configurable, like in the iframe; reuse it.
    existing.hydrate(document);
    return existing;
  }
  // Same bytes the iframe receives; the browser would run them as a <script>.
  window.eval(buildArtifactKitV1Script());
  return (window as unknown as { piwin: KitApi }).piwin;
}

function chartFigure(kind: string, spec: unknown, caption = 'Caption'): string {
  return `<figure data-piwin-chart="${kind}"><script type="application/json">${JSON.stringify(spec)}</script><figcaption>${caption}</figcaption></figure>`;
}

describe('artifact kit runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hydrates a declarative bar chart and keeps the caption readable', () => {
    const kit = loadKit(chartFigure('bar', { labels: ['一', '二'], series: [{ name: '耗时', values: [212, 198] }] }));
    expect(kit.version).toBe('1.2.0');
    const figure = document.querySelector('figure')!;
    expect(figure.hasAttribute('data-piwin-chart-ready')).toBe(true);
    expect(figure.querySelectorAll('svg .piwin-chart-bar')).toHaveLength(2);
    expect([...figure.querySelectorAll('svg .piwin-chart-label')].map((t) => t.textContent)).toEqual(['一', '二']);
    // Few bars: each prints its value, and the axis is rounded up to a readable maximum.
    expect([...figure.querySelectorAll('svg .piwin-chart-value')].map((t) => t.textContent)).toEqual(['212', '198']);
    expect([...figure.querySelectorAll('svg .piwin-chart-tick')].map((t) => t.textContent)).toEqual(['0', '50', '100', '150', '200', '250']);
    expect(figure.querySelector('figcaption')?.textContent).toBe('Caption');
    expect(figure.querySelector('svg')?.getAttribute('aria-label')).toBe('Caption');
  });

  it('draws line, donut (with center and legend) and spark', () => {
    loadKit(
      chartFigure('line', { labels: ['a', 'b', 'c'], series: [{ values: [1, 3, 2] }, { name: 'B', values: [2, 1, 3] }] }) +
        chartFigure('donut', { labels: ['x', 'y'], series: [{ values: [3, 1] }], center: '75%' }) +
        chartFigure('spark', { series: [{ values: [1, 2, 1, 4] }] }),
    );
    const [line, donut, spark] = [...document.querySelectorAll('figure')];
    expect(line!.querySelectorAll('polyline')).toHaveLength(2);
    expect(donut!.querySelector('.piwin-chart-center')?.textContent).toBe('75%');
    expect([...donut!.querySelectorAll('.piwin-chart-legend span')].map((s) => s.textContent)).toEqual(['x75%', 'y25%']);
    expect(spark!.querySelectorAll('polyline')).toHaveLength(1);
    expect(spark!.querySelector('text')).toBeNull();
  });

  it('draws ranked rows and a share bar, and falls back to bar for an unknown kind', () => {
    loadKit(
      chartFigure('hbar', { labels: ['packages/host-runtime', '失败'], series: [{ values: [40, 10] }], unit: 'ms' }) +
        chartFigure('stack', { labels: ['a', 'b', 'none'], series: [{ values: [3, 1, 0] }] }) +
        chartFigure('radar', { labels: ['a'], series: [{ values: [1] }] }),
    );
    const [hbar, stack, unknown] = [...document.querySelectorAll('figure')];
    expect([...hbar!.querySelectorAll('.piwin-chart-label')].map((t) => t.textContent)).toEqual(['packages/host-runtime', '失败']);
    expect([...hbar!.querySelectorAll('.piwin-chart-value')].map((t) => t.textContent)).toEqual(['40ms', '10ms']);
    // A row named like a status takes that tone; the rest share the series color.
    expect([...hbar!.querySelectorAll('.piwin-chart-bar')].map((r) => r.getAttribute('fill'))).toEqual([
      'var(--piwin-artifact-series-1)',
      'var(--piwin-artifact-risk)',
    ]);
    expect(hbar!.querySelector('svg')?.getAttribute('height')).toBe('60');
    expect(stack!.querySelectorAll('.piwin-chart-bar')).toHaveLength(2);
    expect([...stack!.querySelectorAll('.piwin-chart-legend span')].map((s) => s.textContent)).toEqual(['a75%', 'b25%', 'none0%']);
    expect(unknown!.querySelectorAll('path.piwin-chart-bar')).toHaveLength(1);
  });

  it('treats labels and names as text, never markup', () => {
    loadKit(
      chartFigure('bar', {
        labels: ['<img src=x onerror=alert(1)>'],
        series: [{ name: '<b>n</b>', values: [1] }, { name: 'm', values: [2] }],
      }),
    );
    const figure = document.querySelector('figure')!;
    expect(figure.querySelector('img')).toBeNull();
    expect(figure.querySelector('b')).toBeNull();
    expect(figure.querySelector('svg .piwin-chart-label')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('accepts only theme-variable colors', () => {
    loadKit(
      chartFigure('bar', {
        labels: ['a'],
        series: [
          { values: [1], color: 'var(--piwin-artifact-risk)' },
          { values: [1], color: 'red' },
          { values: [1], color: 'url(javascript:alert(1))' },
        ],
      }),
    );
    const fills = [...document.querySelectorAll('figure .piwin-chart-bar')].map((r) => r.getAttribute('fill'));
    expect(fills).toEqual([
      'var(--piwin-artifact-risk)',
      'var(--piwin-artifact-series-2)',
      'var(--piwin-artifact-series-3)',
    ]);
  });

  it('colors status series by tone, by name, and donut slices by tones', () => {
    loadKit(
      chartFigure('bar', {
        labels: ['a'],
        series: [
          { name: '成功', values: [3] },
          { name: '失败', values: [1] },
          { name: 'Flaky', values: [1] },
          { name: 'p95', values: [2], tone: 'info' },
          { name: 'neutral', values: [2] },
          { name: 'bogus', values: [2], tone: 'javascript:alert(1)' },
        ],
      }) +
        chartFigure('donut', { labels: ['通过', '建议', 'other'], series: [{ values: [18, 4, 1] }], tones: [null, null, 'risk'] }),
    );
    const [bar, donut] = [...document.querySelectorAll('figure')];
    expect([...bar!.querySelectorAll('.piwin-chart-bar')].map((r) => r.getAttribute('fill'))).toEqual([
      'var(--piwin-artifact-ok)',
      'var(--piwin-artifact-risk)',
      'var(--piwin-artifact-warn)',
      'var(--piwin-artifact-info)',
      'var(--piwin-artifact-series-5)',
      'var(--piwin-artifact-series-6)',
    ]);
    const slices = [...donut!.querySelectorAll('circle')].slice(1).map((c) => c.getAttribute('stroke'));
    expect(slices).toEqual([
      'var(--piwin-artifact-ok)',
      'var(--piwin-artifact-warn)',
      'var(--piwin-artifact-risk)',
    ]);
  });

  it('leaves a figure with broken JSON untouched', () => {
    document.body.innerHTML = '';
    loadKit('<figure data-piwin-chart="bar"><script type="application/json">{nope</script><figcaption>Still here</figcaption></figure>');
    const figure = document.querySelector('figure')!;
    expect(figure.hasAttribute('data-piwin-chart-ready')).toBe(false);
    expect(figure.querySelector('svg')).toBeNull();
    expect(figure.textContent).toContain('Still here');
  });

  it('cannot be replaced by artifact code once loaded', () => {
    const kit = loadKit('');
    expect(() => {
      (window as unknown as { piwin: unknown }).piwin = { version: 'evil' };
    }).toThrow();
    window.eval(buildArtifactKitV1Script());
    expect((window as unknown as { piwin: KitApi }).piwin).toBe(kit);
  });

  it('fills icons, ignores unknown names and exposes the imperative API', () => {
    const kit = loadKit('<i data-piwin-icon="check" data-size="14"></i><i data-piwin-icon="nope"></i>');
    const [known, unknown] = [...document.querySelectorAll('i')];
    expect(known!.querySelector('svg')?.getAttribute('width')).toBe('14');
    expect(known!.getAttribute('aria-hidden')).toBe('true');
    expect(unknown!.innerHTML).toBe('');
    expect(kit.icon('alert', 20)).toContain('width="20"');
    expect(kit.icon('<script>')).toBe('');
    const target = document.createElement('figure');
    document.body.append(target);
    kit.chart(target, { kind: 'line', labels: ['a', 'b'], series: [{ values: [1, 2] }] });
    expect(target.querySelector('polyline')).not.toBeNull();
  });
});
