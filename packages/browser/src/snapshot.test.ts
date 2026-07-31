import { describe, expect, it } from 'vitest';
import { matchRefByPoint, parseAriaSnapshot } from './snapshot.js';

// Real-format fixture captured from Chromium 149 `ariaSnapshot({ mode: 'ai', boxes: true })`
// on a page with a header, nav, main content, and footer (trimmed).
const REAL_FORMAT_FIXTURE = `- document [ref=e1] [box=0,0,1280,308]:
  - generic [active] [ref=e2] [box=8,8,1264,292]:
    - banner [ref=e3] [box=8,8,1264,18]: Site header
    - navigation [ref=e4] [box=8,42,1264,36]:
      - list [ref=e5] [box=8,42,1264,36]:
        - listitem [ref=e6] [box=48,42,1224,18]:
          - link "Home" [ref=e7] [cursor=pointer] [box=48,42,39,18]:
            - /url: /a
        - listitem [ref=e8] [box=48,60,1224,18]:
          - link "About" [ref=e9] [cursor=pointer] [box=48,60,40,18]:
            - /url: /b
    - main [ref=e10] [box=8,99,1264,166]:
      - heading "My page" [level=1] [ref=e11] [box=8,99,1264,37]
      - paragraph [ref=e12] [box=8,158,1264,18]: Hello world this is a paragraph.
      - button "Submit form" [ref=e13] [box=8,193,88,21]
      - checkbox "Agree terms" [checked] [ref=e14] [box=104,195,13,13]
      - text: Agree
      - textbox "Name" [ref=e15] [box=166,193,153,21]
      - list [ref=e16] [box=8,230,1264,36]:
        - listitem [ref=e17] [box=48,230,1224,18]: One
        - listitem [ref=e18] [box=48,248,1224,18]: Two
    - contentinfo [ref=e19] [box=8,282,1264,18]: Footer note
`;

describe('parseAriaSnapshot', () => {
  it('builds the tree with role and nesting', () => {
    const [document] = parseAriaSnapshot(REAL_FORMAT_FIXTURE);
    expect(document).toMatchObject({ role: 'document', ref: 'e1' });
    expect(document?.children).toHaveLength(1);

    const generic = document?.children[0];
    expect(generic).toMatchObject({ role: 'generic', ref: 'e2' });

    const banner = generic?.children[0];
    expect(banner).toMatchObject({ role: 'banner', ref: 'e3', name: 'Site header' });

    const main = generic?.children.find((node) => node.role === 'main');
    expect(main?.children.map((node) => node.role)).toEqual([
      'heading',
      'paragraph',
      'button',
      'checkbox',
      'text',
      'textbox',
      'list',
    ]);
  });

  it('parses ref and box annotations (viewport CSS px)', () => {
    const [document] = parseAriaSnapshot(REAL_FORMAT_FIXTURE);
    const main = document?.children[0]?.children.find((node) => node.role === 'main');
    const button = main?.children.find((node) => node.role === 'button');
    expect(button).toMatchObject({ role: 'button', name: 'Submit form', ref: 'e13' });
    expect(button?.box).toEqual({ x: 8, y: 193, width: 88, height: 21 });
  });

  it('parses name, level, checked and text-mapped name', () => {
    const [document] = parseAriaSnapshot(REAL_FORMAT_FIXTURE);
    const main = document?.children[0]?.children.find((node) => node.role === 'main');

    const heading = main?.children.find((node) => node.role === 'heading');
    expect(heading).toMatchObject({ name: 'My page', level: 1 });

    const checkbox = main?.children.find((node) => node.role === 'checkbox');
    expect(checkbox).toMatchObject({ name: 'Agree terms', checked: true });

    const textNode = main?.children.find((node) => node.role === 'text');
    expect(textNode?.name).toBe('Agree');

    const paragraph = main?.children.find((node) => node.role === 'paragraph');
    expect(paragraph?.name).toBe('Hello world this is a paragraph.');
  });

  it('keeps ARIA property children such as /url', () => {
    const [document] = parseAriaSnapshot(REAL_FORMAT_FIXTURE);
    const homeLink = document?.children[0]?.children.find((node) => node.role === 'navigation')
      ?.children[0]?.children[0]?.children[0];
    expect(homeLink).toMatchObject({ role: 'link', name: 'Home', ref: 'e7' });
    expect(homeLink?.children).toEqual([{ role: '/url', name: '/a', children: [] }]);
  });

  it('tolerates a trailing-newline-less and whitespace-flushed input', () => {
    const nodes = parseAriaSnapshot('  - button "Go" [ref=e1] [box=1,2,3,4]  ');
    expect(nodes).toEqual([
      {
        role: 'button',
        name: 'Go',
        ref: 'e1',
        box: { x: 1, y: 2, width: 3, height: 4 },
        children: [],
      },
    ]);
  });

  it('preserves bracket tokens inside leaf text', () => {
    const [textNode] = parseAriaSnapshot('- text: see [1]');
    expect(textNode?.name).toBe('see [1]');
    expect(textNode?.ref).toBeUndefined();
  });

  it('does not treat brackets in the text part as annotations', () => {
    const [paragraph] = parseAriaSnapshot('- paragraph: ref [ref=e9] x');
    expect(paragraph?.name).toBe('ref [ref=e9] x');
    expect(paragraph?.ref).toBeUndefined();
  });

  it('still extracts annotations that precede the text part', () => {
    const [paragraph] = parseAriaSnapshot('- paragraph [ref=e12] [box=8,158,1264,18]: see [1]');
    expect(paragraph).toMatchObject({ ref: 'e12' });
    expect(paragraph?.box).toEqual({ x: 8, y: 158, width: 1264, height: 18 });
    expect(paragraph?.name).toBe('see [1]');
  });
});

describe('matchRefByPoint', () => {
  const nodes = parseAriaSnapshot(REAL_FORMAT_FIXTURE);

  it('returns the deepest ref whose box contains the point', () => {
    // Inside the button's box -> its ref.
    expect(matchRefByPoint(nodes, 30, 200)).toBe('e13');
    // (60,48) lies inside the nav list, listitem and link boxes -> the deepest (link).
    expect(matchRefByPoint(nodes, 60, 48)).toBe('e7');
  });

  it('returns undefined when the point hits no ref box', () => {
    expect(matchRefByPoint(nodes, 2000, 2000)).toBeUndefined();
  });
});
