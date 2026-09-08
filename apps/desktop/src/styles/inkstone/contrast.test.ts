import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast guard for the Inkstone faces.
 *
 * Parses the authored hex tokens out of tokens.css (the source of truth) and
 * computes the relative-luminance contrast ratio for every text/background
 * pairing the UI actually uses. Any pairing that carries text must clear
 * 4.5:1 (WCAG AA). Decorative-only channels (glows, washes) are exempt and
 * listed explicitly so the exemption set can only shrink deliberately.
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

/** Text-bearing pairings per face: [text token, background tokens]. */
const TEXT_TOKENS = ['--t1', '--t2', '--t3', '--t4'] as const;
const TEXT_BACKGROUNDS = ['--void', '--s1', '--s2', '--s3'] as const;
/** Status channels that render as text/icons (not fills behind white text). */
const STATUS_TEXT_TOKENS = ['--lamp', '--zhu'] as const;

const AA_TEXT = 4.5;

function collectFailures(
  face: string,
  block: string,
): Array<{ pair: string; ratio: number }> {
  const failures: Array<{ pair: string; ratio: number }> = [];
  const check = (fgName: string, bgName: string) => {
    const ratio = contrastRatio(hexToken(block, fgName), hexToken(block, bgName));
    if (ratio < AA_TEXT) {
      failures.push({ pair: `${face} ${fgName} on ${bgName}`, ratio });
    }
  };
  for (const fg of TEXT_TOKENS) {
    for (const bg of TEXT_BACKGROUNDS) check(fg, bg);
  }
  // Status text/icons sit on the two lightest content surfaces in practice.
  for (const fg of STATUS_TEXT_TOKENS) {
    for (const bg of ['--s1', '--s2'] as const) check(fg, bg);
  }
  return failures;
}

describe('Inkstone WCAG AA contrast', () => {
  it('keeps every text token ≥ 4.5:1 on its backgrounds (paper face)', () => {
    const failures = collectFailures('paper', PAPER);
    expect(
      failures.map((f) => `${f.pair} = ${f.ratio.toFixed(2)}:1`),
    ).toEqual([]);
  });

  it('keeps every text token ≥ 4.5:1 on its backgrounds (ink face)', () => {
    const failures = collectFailures('ink', INK);
    expect(
      failures.map((f) => `${f.pair} = ${f.ratio.toFixed(2)}:1`),
    ).toEqual([]);
  });

  it('sanity-checks the ratio math against known anchors', () => {
    // WCAG worked examples: black on white = 21:1.
    expect(contrastRatio(parseHex('#000000'), parseHex('#ffffff'))).toBeCloseTo(21, 0);
  });
});