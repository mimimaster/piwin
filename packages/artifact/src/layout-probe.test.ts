import { describe, expect, it } from 'vitest';
import { parseArtifactLayoutMessage } from './bridge-protocol.js';
import {
  buildArtifactLayoutProbeRuntime,
  countShatteredText,
  type ArtifactLayoutProbeRoot,
  type ArtifactLayoutProbeView,
} from './layout-probe.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';

type Box = { text: string; width: number; height: number; fontSize?: number; padding?: number; writingMode?: string; hidden?: boolean; inSvg?: boolean };

/** Minimal DOM stand-in: the probe only reads these members. */
function fakeRoot(boxes: Box[]): { root: ArtifactLayoutProbeRoot; view: ArtifactLayoutProbeView } {
  const styles = new Map<object, ReturnType<ArtifactLayoutProbeView['getComputedStyle']>>();
  const elements = boxes.map((box) => {
    const text = { nodeType: 3, nodeValue: box.text, nextSibling: null };
    const element = {
      firstChild: text,
      closest: () => (box.inSvg ? {} : null),
      getBoundingClientRect: () => ({ width: box.width, height: box.height }),
    };
    styles.set(element, {
      visibility: box.hidden ? 'hidden' : 'visible',
      writingMode: box.writingMode ?? 'horizontal-tb',
      fontSize: `${box.fontSize ?? 14}px`,
      lineHeight: 'normal',
      paddingLeft: `${box.padding ?? 0}px`,
      paddingRight: `${box.padding ?? 0}px`,
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
    });
    return element;
  });
  return {
    root: { querySelectorAll: () => elements },
    view: {
      getComputedStyle: (element) => {
        const style = styles.get(element);
        if (!style) throw new Error('unknown element');
        return style;
      },
    },
  };
}

function count(boxes: Box[]): number {
  const { root, view } = fakeRoot(boxes);
  return countShatteredText(root, view);
}

describe('countShatteredText', () => {
  it('flags text laid out one glyph per line, including inside padding', () => {
    expect(count([{ text: 'https', width: 18, height: 170 }])).toBe(1);
    expect(count([{ text: 'www.example.com', width: 28, height: 500, padding: 5 }])).toBe(1);
    expect(count([{ text: '查询字符串', width: 15, height: 110, fontSize: 15 }])).toBe(1);
  });

  it('leaves ordinary and deliberately vertical text alone', () => {
    expect(count([{ text: 'A normal sentence in a paragraph.', width: 420, height: 44 }])).toBe(0);
    expect(count([{ text: 'ok', width: 14, height: 40 }])).toBe(0);
    expect(count([{ text: 'narrow but short', width: 18, height: 40 }])).toBe(0);
    expect(count([{ text: '竖排标题文字', width: 16, height: 120, writingMode: 'vertical-rl' }])).toBe(0);
    expect(count([{ text: 'hidden text', width: 10, height: 200, hidden: true }])).toBe(0);
    expect(count([{ text: 'axis label', width: 10, height: 200, inSvg: true }])).toBe(0);
  });
});

describe('layout probe runtime', () => {
  it('embeds a self-contained copy of the detector', () => {
    const runtime = buildArtifactLayoutProbeRuntime();
    const source = runtime
      .split('var countShatteredText = ')[1]
      ?.split('var scheduleLayoutProbe')[0]
      ?.trim()
      .replace(/;$/, '');
    expect(source).toMatch(/^function/);
    // Evaluated on its own, as in the frame: any module-level reference would throw here.
    const standalone = new Function(`return (${source});`)() as typeof countShatteredText;
    const { root, view } = fakeRoot([{ text: 'https', width: 18, height: 170 }, { text: 'fine text', width: 300, height: 20 }]);
    expect(standalone(root, view)).toBe(1);
  });

  it('runs in final documents only, on every palette', () => {
    const final = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', freezeSource: true }).srcdoc;
    const stream = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c' }).srcdoc;
    expect(final).toContain('piwin-artifact:layout');
    expect(stream).not.toContain('piwin-artifact:layout');
  });

  it('parses only well-formed, positive reports', () => {
    expect(parseArtifactLayoutMessage({ type: 'piwin-artifact:layout', channelId: 'c', shatteredText: 3 })).toEqual({
      type: 'piwin-artifact:layout',
      channelId: 'c',
      shatteredText: 3,
    });
    expect(parseArtifactLayoutMessage({ type: 'piwin-artifact:layout', channelId: 'c', shatteredText: 1e9 })?.shatteredText).toBe(800);
    expect(parseArtifactLayoutMessage({ type: 'piwin-artifact:layout', channelId: 'c', shatteredText: 0 })).toBeNull();
    expect(parseArtifactLayoutMessage({ type: 'piwin-artifact:layout', channelId: 'c', shatteredText: '3' })).toBeNull();
    expect(parseArtifactLayoutMessage({ type: 'piwin-artifact:layout', shatteredText: 3 })).toBeNull();
  });
});
