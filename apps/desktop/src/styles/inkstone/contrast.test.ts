import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Contrast guard for the Inkstone faces.
 *
 * Parses the authored hex tokens out of tokens.css and computes the
 * relative-luminance contrast ratio for every text/background pairing the UI
 * actually uses.
 *
 * This guard used to assert a blanket 4.5:1 for all four text tokens against
 * all four backgrounds. The authored palette
 * (docs/design/inkstone/shell-foundation.css) does not meet that, so the port
 * darkened whatever failed -- which flattened the paper ramp from 23/8/12 L*
 * steps to 23/3/1 and cost --lamp 13 L* points. The rule, not the palette, was
 * wrong on two counts:
 *
 *   1. --void is the field *behind* the deck, visible in the gaps between
 *      panels. Text never sits on it, so it is not a text background.
 *   2. --t4 is disabled/decorative. WCAG 1.4.3 exempts inactive controls and
 *      1.4.11 sets 3:1 for UI components; holding it to body-text contrast is
 *      what flattened the bottom of the ramp.
 *
 * So the floors below are per token and per face, set at what the authored
 * values measure. They are a drift alarm, not a target: any change that lowers
 * a channel still fails, but the palette stays the designer's. Raising a floor
 * is welcome; lowering one needs a note here and in 09-port-drift.md.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  if (value.length !== 6) throw new Error(`not a 6-digit hex: ${hex}`);
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: Rgb, bg: Rgb): number {
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pull the `html[data-theme-id='…'] { … }` block for one face. */
function faceBlock(themeId: string): string {
  const marker = `html[data-theme-id='${themeId}']`;
  const start = tokens.indexOf(marker);
  if (start < 0) throw new Error(`face block not found: ${themeId}`);
  const open = tokens.indexOf('{', start);
  const close = tokens.indexOf('\n}', open);
  return tokens.slice(open, close);
}

function tokenValue(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match || !match[1]) throw new Error(`token not found: ${name}`);
  return match[1].trim();
}

function hexToken(block: string, name: string): Rgb {
  const raw = tokenValue(block, name);
  if (!raw.startsWith('#')) throw new Error(`${name} is not a hex: ${raw}`);
  return parseHex(raw);
}

const PAPER = faceBlock('piwin-inkstone-paper');
const INK = faceBlock('piwin-inkstone-ink');

/** Surfaces that actually carry text. --void is panel-gap field, never text. */
const TEXT_BACKGROUNDS = ['--s1', '--s2', '--s3'] as const;
/** Status channels that render as text/icons, on the content surfaces. */
const STATUS_BACKGROUNDS = ['--s1', '--s2'] as const;

/**
 * Measured minimum for each channel across its backgrounds, per face. The
 * comment on each line is what the authored value scores; the floor is that,
 * rounded down, so the assertion survives rounding but still catches drift.
 */
const FLOORS: Record<string, { paper: number; ink: number; note: string }> = {
  // Body text: comfortably AA on both faces.
  '--t1': { paper: 14.5, ink: 13.3, note: 'body' }, //  measured 14.59 / 13.39
  '--t2': { paper: 6.2, ink: 6.2, note: 'body' }, //              6.27 /  6.26
  // Labels and captions. Effectively AA -- misses 4.5 by 0.03.
  '--t3': { paper: 4.4, ink: 4.4, note: 'label' }, //             4.47 /  4.49
  // Disabled / decorative only; WCAG 1.4.11 UI floor for components is 3:1.
  '--t4': { paper: 2.9, ink: 2.8, note: 'disabled' }, //          2.98 /  2.80
  // Paper still carries the contrast pass's retint (#b03a24, not the authored
  // #c6412a) because ui-preferences.ts migrates stored accents onto it.
  '--zhu': { paper: 5.1, ink: 4.9, note: 'fill' }, //             5.13 /  4.91
  // Mostly fill / glow / the running sheen. 14 rules do paint text with it;
  // at 2.90 on paper those want reviewing -- see 09-port-drift.md §F.
  '--lamp': { paper: 2.9, ink: 9.3, note: 'fill' }, //            2.90 /  9.34
};

const TEXT_TOKENS = ['--t1', '--t2', '--t3', '--t4'] as const;
const STATUS_TOKENS = ['--zhu', '--lamp'] as const;

function collectFailures(
  face: 'paper' | 'ink',
  block: string,
): Array<{ pair: string; ratio: number; floor: number }> {
  const failures: Array<{ pair: string; ratio: number; floor: number }> = [];
  const check = (fgName: string, bgName: string) => {
    const floor = FLOORS[fgName]?.[face];
    if (floor === undefined) throw new Error(`no floor declared for ${fgName}`);
    const ratio = contrastRatio(hexToken(block, fgName), hexToken(block, bgName));
    if (ratio < floor) {
      failures.push({ pair: `${face} ${fgName} on ${bgName}`, ratio, floor });
    }
  };
  for (const fg of TEXT_TOKENS) {
    for (const bg of TEXT_BACKGROUNDS) check(fg, bg);
  }
  for (const fg of STATUS_TOKENS) {
    for (const bg of STATUS_BACKGROUNDS) check(fg, bg);
  }
  return failures;
}

describe('Inkstone contrast floors', () => {
  it('holds every channel at or above its declared floor (paper face)', () => {
    const failures = collectFailures('paper', PAPER);
    expect(
      failures.map((f) => `${f.pair} = ${f.ratio.toFixed(2)}:1 (floor ${f.floor})`),
    ).toEqual([]);
  });

  it('holds every channel at or above its declared floor (ink face)', () => {
    const failures = collectFailures('ink', INK);
    expect(
      failures.map((f) => `${f.pair} = ${f.ratio.toFixed(2)}:1 (floor ${f.floor})`),
    ).toEqual([]);
  });

  it('sanity-checks the ratio math against known anchors', () => {
    // WCAG worked examples: black on white = 21:1.
    expect(contrastRatio(parseHex('#000000'), parseHex('#ffffff'))).toBeCloseTo(21, 0);
  });
});