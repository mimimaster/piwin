import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES,
  MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES,
  clearMermaidDiagramCacheForTests,
  getMermaidDiagramCacheStats,
  getOrCreateMermaidDiagramRender,
  readMermaidDiagramHeight,
  readMermaidDiagramSvg,
  rememberMermaidDiagramHeight,
  rememberMermaidDiagramSvg,
  trimMermaidDiagramCache,
} from './mermaid-diagram-cache.js';

describe('mermaid diagram cache', () => {
  beforeEach(() => {
    clearMermaidDiagramCacheForTests();
  });

  it('returns a remembered svg for the same source and theme', () => {
    rememberMermaidDiagramSvg('graph TD\nA-->B', 'dark', '<svg id="one"></svg>');
    expect(readMermaidDiagramSvg('graph TD\nA-->B', 'dark')).toBe('<svg id="one"></svg>');
    expect(readMermaidDiagramSvg('graph TD\nA-->B', 'light')).toBeNull();
  });

  it('evicts the least-recent svg once the LRU is full', () => {
    for (let index = 0; index < MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES; index += 1) {
      rememberMermaidDiagramSvg(`source-${index}`, 'dark', `<svg id="${index}"></svg>`);
    }
    expect(readMermaidDiagramSvg('source-0', 'dark')).toBe('<svg id="0"></svg>');

    rememberMermaidDiagramSvg('source-overflow', 'dark', '<svg id="overflow"></svg>');

    expect(readMermaidDiagramSvg('source-1', 'dark')).toBeNull();
    expect(readMermaidDiagramSvg('source-0', 'dark')).toBe('<svg id="0"></svg>');
    expect(readMermaidDiagramSvg('source-overflow', 'dark')).toBe('<svg id="overflow"></svg>');
  });

  it('keeps measured heights after the svg LRU evicts that source', () => {
    rememberMermaidDiagramSvg('source-0', 'dark', '<svg id="0"></svg>');
    rememberMermaidDiagramHeight('source-0', 'dark', 420);
    for (let index = 1; index <= MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES; index += 1) {
      rememberMermaidDiagramSvg(`source-${index}`, 'dark', `<svg id="${index}"></svg>`);
    }
    expect(readMermaidDiagramSvg('source-0', 'dark')).toBeNull();
    expect(readMermaidDiagramHeight('source-0', 'dark')).toBe(420);
  });

  it('clamps and rejects unusable heights', () => {
    rememberMermaidDiagramHeight('source-a', 'dark', 512.2);
    expect(readMermaidDiagramHeight('source-a', 'dark')).toBe(513);

    rememberMermaidDiagramHeight('source-a', 'dark', 50_000);
    expect(readMermaidDiagramHeight('source-a', 'dark')).toBe(4_000);

    rememberMermaidDiagramHeight('source-b', 'dark', 0);
    expect(readMermaidDiagramHeight('source-b', 'dark')).toBeNull();
  });

  it('bounds retained height entries with LRU eviction', () => {
    for (let index = 0; index < MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES; index += 1) {
      rememberMermaidDiagramHeight(`source-${index}`, 'dark', 80 + index);
    }
    expect(readMermaidDiagramHeight('source-0', 'dark')).toBe(80);

    rememberMermaidDiagramHeight('source-overflow', 'dark', 240);

    expect(readMermaidDiagramHeight('source-1', 'dark')).toBeNull();
    expect(readMermaidDiagramHeight('source-0', 'dark')).toBe(80);
    expect(readMermaidDiagramHeight('source-overflow', 'dark')).toBe(240);
  });

  it('returns a cached svg without calling render', async () => {
    rememberMermaidDiagramSvg('graph TD', 'dark', '<svg id="cached"></svg>');
    let renderCalls = 0;
    const svg = await getOrCreateMermaidDiagramRender('graph TD', 'dark', async () => {
      renderCalls += 1;
      return '<svg id="fresh"></svg>';
    });
    expect(svg).toBe('<svg id="cached"></svg>');
    expect(renderCalls).toBe(0);
  });

  it('coalesces in-flight renders for the same source and theme', async () => {
    let renderCalls = 0;
    let finish: ((svg: string) => void) | undefined;
    const render = (): Promise<string> => {
      renderCalls += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };

    const first = getOrCreateMermaidDiagramRender('graph TD', 'dark', render);
    const second = getOrCreateMermaidDiagramRender('graph TD', 'dark', render);
    expect(renderCalls).toBe(1);
    finish?.('<svg id="shared"></svg>');

    await expect(first).resolves.toBe('<svg id="shared"></svg>');
    await expect(second).resolves.toBe('<svg id="shared"></svg>');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBe('<svg id="shared"></svg>');
  });

  it('does not cache a rejected render and allows a retry', async () => {
    await expect(
      getOrCreateMermaidDiagramRender('graph TD', 'dark', async () => {
        throw new Error('parse failed');
      }),
    ).rejects.toThrow('parse failed');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBeNull();

    await expect(
      getOrCreateMermaidDiagramRender('graph TD', 'dark', async () => '<svg id="retry"></svg>'),
    ).resolves.toBe('<svg id="retry"></svg>');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBe('<svg id="retry"></svg>');
  });
});

describe('mermaid diagram cache — governor budgets', () => {
  beforeEach(() => {
    clearMermaidDiagramCacheForTests();
  });

  it('trims LRU-first to a byte budget and tracks svgBytes', () => {
    rememberMermaidDiagramSvg('s1', 'dark', 'a'.repeat(100));
    rememberMermaidDiagramSvg('s2', 'dark', 'b'.repeat(100));
    expect(getMermaidDiagramCacheStats().svgBytes).toBe(200);

    trimMermaidDiagramCache({ maxBytes: 150 });
    expect(readMermaidDiagramSvg('s1', 'dark')).toBeNull();
    expect(readMermaidDiagramSvg('s2', 'dark')).toBe('b'.repeat(100));
    expect(getMermaidDiagramCacheStats().svgBytes).toBe(100);
  });

  it('rejects a single oversized svg without evicting older entries first', () => {
    trimMermaidDiagramCache({ maxBytes: 300 });
    rememberMermaidDiagramSvg('small', 'dark', 'x'.repeat(100));
    rememberMermaidDiagramSvg('huge', 'dark', 'y'.repeat(400));
    expect(readMermaidDiagramSvg('huge', 'dark')).toBeNull();
    expect(readMermaidDiagramSvg('small', 'dark')).toBe('x'.repeat(100));
  });

  it('evictAll clears contents while the budget still admits small refills', () => {
    rememberMermaidDiagramSvg('s1', 'dark', '<svg>1</svg>');
    trimMermaidDiagramCache({ evictAll: true, maxBytes: 100 });
    expect(readMermaidDiagramSvg('s1', 'dark')).toBeNull();

    rememberMermaidDiagramSvg('s2', 'dark', 'z'.repeat(80));
    expect(readMermaidDiagramSvg('s2', 'dark')).toBe('z'.repeat(80));
    rememberMermaidDiagramSvg('s3', 'dark', 'w'.repeat(80));
    // 80 + 80 > 100: s2 evicted to fit s3.
    expect(readMermaidDiagramSvg('s2', 'dark')).toBeNull();
    expect(readMermaidDiagramSvg('s3', 'dark')).toBe('w'.repeat(80));
  });

  it('a zero budget admits nothing and drops everything', () => {
    rememberMermaidDiagramSvg('s1', 'dark', '<svg>1</svg>');
    rememberMermaidDiagramHeight('s1', 'dark', 200);
    trimMermaidDiagramCache({ maxEntries: 0, maxBytes: 0 });
    expect(getMermaidDiagramCacheStats().svgEntries).toBe(0);
    rememberMermaidDiagramSvg('s2', 'dark', '<svg>2</svg>');
    rememberMermaidDiagramHeight('s2', 'dark', 200);
    expect(readMermaidDiagramSvg('s2', 'dark')).toBeNull();
    expect(readMermaidDiagramHeight('s2', 'dark')).toBeNull();
  });

  it('a stale completion is returned but not written to the shared cache', async () => {
    let stale = false;
    let finish: ((svg: string) => void) | undefined;
    const pending = getOrCreateMermaidDiagramRender(
      'graph TD',
      'dark',
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      () => stale,
    );
    stale = true;
    finish?.('<svg id="late"></svg>');
    await expect(pending).resolves.toBe('<svg id="late"></svg>');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBeNull();
  });

  it('a live completion still populates the cache', async () => {
    const stale = false;
    await expect(
      getOrCreateMermaidDiagramRender(
        'graph TD',
        'dark',
        async () => '<svg id="live"></svg>',
        () => stale,
      ),
    ).resolves.toBe('<svg id="live"></svg>');
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBe('<svg id="live"></svg>');
  });

  it('a coalesced render stores while any owner is still live', async () => {
    let staleA = false;
    const staleB = false;
    let finish: ((svg: string) => void) | undefined;
    const render = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });
    const first = getOrCreateMermaidDiagramRender('graph TD', 'dark', render, () => staleA);
    const second = getOrCreateMermaidDiagramRender('graph TD', 'dark', render, () => staleB);
    staleA = true; // owner A gone, owner B still live
    finish?.('<svg id="shared"></svg>');
    await Promise.all([first, second]);
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBe('<svg id="shared"></svg>');
  });

  it('a coalesced render is dropped when every owner went stale', async () => {
    let staleA = false;
    let staleB = false;
    let finish: ((svg: string) => void) | undefined;
    const render = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });
    const first = getOrCreateMermaidDiagramRender('graph TD', 'dark', render, () => staleA);
    const second = getOrCreateMermaidDiagramRender('graph TD', 'dark', render, () => staleB);
    staleA = true;
    staleB = true;
    finish?.('<svg id="orphan"></svg>');
    await Promise.all([first, second]);
    expect(readMermaidDiagramSvg('graph TD', 'dark')).toBeNull();
  });
});
