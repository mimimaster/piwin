import { describe, expect, it } from 'vitest';
import {
  buildArtifactLeftAccentRuntime,
  straightenLeftAccents,
  type ArtifactLeftAccentRoot,
  type ArtifactLeftAccentView,
} from './left-accent-straighten.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';

type Card = {
  radius?: string;
  left?: string;
  leftStyle?: string;
  others?: string;
  boxShadow?: string;
  inSvg?: boolean;
};

type FakeElement = {
  closest(selector: string): unknown;
  style: { setProperty(name: string, value: string, priority: string): void };
  written: Record<string, string>;
};

/** Minimal DOM stand-in: the straightener only reads and writes these members. */
function fakeRoot(cards: Card[]): {
  root: ArtifactLeftAccentRoot;
  view: ArtifactLeftAccentView;
  elements: FakeElement[];
} {
  const styles = new Map<object, ReturnType<ArtifactLeftAccentView['getComputedStyle']>>();
  const elements = cards.map((card) => {
    const written: Record<string, string> = {};
    const element: FakeElement = {
      closest: () => (card.inSvg ? {} : null),
      style: {
        setProperty: (name, value, priority) => {
          written[name] = `${value}${priority ? ` !${priority}` : ''}`;
        },
      },
      written,
    };
    styles.set(element, {
      borderTopLeftRadius: card.radius ?? '0px',
      borderBottomLeftRadius: card.radius ?? '0px',
      borderLeftStyle: card.leftStyle ?? (card.left ? 'solid' : 'none'),
      borderLeftWidth: card.left ?? '0px',
      borderTopWidth: card.others ?? '0px',
      borderRightWidth: card.others ?? '0px',
      borderBottomWidth: card.others ?? '0px',
      boxShadow: card.boxShadow ?? 'none',
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
    elements,
  };
}

describe('straightenLeftAccents', () => {
  it('squares the left corners of rounded cards with a thick left border', () => {
    const { root, view, elements } = fakeRoot([{ radius: '10px', left: '3px', others: '0px' }]);
    expect(straightenLeftAccents(root, view)).toBe(1);
    expect(elements[0]?.written).toEqual({
      'border-top-left-radius': '0 !important',
      'border-bottom-left-radius': '0 !important',
    });
  });

  it('treats a left border thicker than a hairline frame as an accent', () => {
    const { root, view } = fakeRoot([{ radius: '12px', left: '3px', others: '1px' }]);
    expect(straightenLeftAccents(root, view)).toBe(1);
  });

  it('squares rounded cards with an inset left shadow bar', () => {
    const { root, view } = fakeRoot([
      { radius: '8px', boxShadow: 'rgb(176, 58, 36) 3px 0px 0px 0px inset, rgba(0, 0, 0, 0.1) 0px 1px 2px 0px' },
    ]);
    expect(straightenLeftAccents(root, view)).toBe(1);
  });

  it('leaves uniform borders, square cards, hairlines and SVG alone', () => {
    const { root, view, elements } = fakeRoot([
      { radius: '10px', left: '1px', others: '1px' },
      { radius: '10px', left: '2px', others: '2px' },
      { radius: '0px', left: '3px' },
      { radius: '10px', left: '1px' },
      { radius: '10px', left: '3px', leftStyle: 'none' },
      { radius: '10px', boxShadow: 'rgb(0, 0, 0) -3px 0px 0px 0px inset' },
      { radius: '10px', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px' },
      { radius: '10px', left: '3px', inSvg: true },
    ]);
    expect(straightenLeftAccents(root, view)).toBe(0);
    expect(elements.every((element) => Object.keys(element.written).length === 0)).toBe(true);
  });
});

describe('left accent runtime', () => {
  it('embeds a self-contained copy of the straightener', () => {
    const source = buildArtifactLeftAccentRuntime()
      .split('var straightenLeftAccents = ')[1]
      ?.split('var leftAccentTimer')[0]
      ?.trim()
      .replace(/;$/, '');
    expect(source).toMatch(/^function/);
    // Evaluated on its own, as in the frame: any module-level reference would throw here.
    const standalone = new Function(`return (${source});`)() as typeof straightenLeftAccents;
    const { root, view } = fakeRoot([{ radius: '10px', left: '3px' }, { radius: '10px' }]);
    expect(standalone(root, view)).toBe(1);
  });

  it('ships in stream previews and final documents alike', () => {
    const final = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', freezeSource: true }).srcdoc;
    const stream = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c' }).srcdoc;
    expect(final).toContain('var straightenLeftAccents = ');
    expect(stream).toContain('var straightenLeftAccents = ');
  });
});
