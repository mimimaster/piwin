import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');

describe('Inkstone type tokens', () => {
  it('puts Inter and system Latin ahead of PingFang in --sans', () => {
    expect(tokens).toMatch(
      /--sans:\s*Inter,\s*-apple-system,\s*BlinkMacSystemFont,\s*'PingFang SC'/,
    );
    expect(tokens).not.toMatch(/--sans:\s*Inter,\s*'PingFang SC'/);
  });

  it('leads --mono with JetBrains Mono and tabular-capable system fallbacks', () => {
    expect(tokens).toMatch(
      /--mono:\s*'JetBrains Mono',\s*ui-monospace,\s*'SF Mono',\s*Menlo/,
    );
  });

  it('keeps proto-01 reading measure at 14.5 / 1.72 via --chat-line-height', () => {
    expect(tokens).toContain('--chat-line-height: 1.72');
    expect(tokens).toContain('--fs-ui: 12.5px');
    expect(tokens).toContain('--fs-meta: 11.5px');
  });

  it('floors --fs-micro at 11px — Songti-style hairlines vanish below that', () => {
    const micro = tokens.match(/--fs-micro:\s*([\d.]+)px/);
    expect(micro).not.toBeNull();
    expect(Number(micro?.[1])).toBeGreaterThanOrEqual(11);
  });
});

describe('Inkstone font-size floor across region CSS', () => {
  const cssFiles = readdirSync(here)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ file: f, css: readFileSync(join(here, f), 'utf8') }));

  it('no inkstone stylesheet declares a font size below 11px', () => {
    // Floor targets serif hairlines and body text. Mono at 10–10.5px stays
    // legible (uniform strokes) and the 20px titlebar pills (砚/纸/墨 toggles,
    // mode/origin badges) are sized for it — those three rules are exempt.
    const exemptions = new Set([
      'font: 500 10px/1 var(--mono)',
      'font: 600 10.5px/1 var(--mono) !important',
      'font: 500 10.5px/1 var(--mono) !important',
    ]);
    const offenders: string[] = [];
    const subFloor = /font(?:-size)?:\s*(?:\d{3}\s+)?[\d.]+px[^;]*/g;
    for (const { file, css } of cssFiles) {
      for (const match of css.matchAll(subFloor)) {
        const rule = match[0].replace(/\s+/g, ' ').trim();
        const px = Number(rule.match(/([\d.]+)px/)?.[1]);
        if (px < 11 && !exemptions.has(rule)) offenders.push(`${file}: ${rule}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
