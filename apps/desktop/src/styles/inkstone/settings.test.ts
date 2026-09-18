import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const settings = readFileSync(join(here, 'settings.css'), 'utf8');

/** Declaration body of the first rule opened by `selector`. Comments are
 *  stripped first so a brace inside one cannot truncate the body. */
function ruleBody(css: string, selector: string): string | null {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectorAt = clean.indexOf(selector);
  if (selectorAt === -1) return null;
  const open = clean.indexOf('{', selectorAt);
  const close = open === -1 ? -1 : clean.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return clean.slice(open + 1, close);
}

function backgroundToken(body: string | null): string | undefined {
  return body?.match(/background:\s*var\((--[\w-]+)\)/)?.[1];
}

describe('Inkstone settings hub chrome', () => {
  it('masks the sticky hub tab strip with the surface it covers', () => {
    // The strip is sticky and opaque so panels cannot scroll into view behind
    // it. An opaque mask has to match the page it floats on: painted with the
    // compact .subtab *track* tone (s1, per
    // docs/design/inkstone/proto-05-settings-ink.html) it reads as a
    // full-bleed band one ramp step darker than .settings-main (s2).
    const pageSurface = backgroundToken(ruleBody(settings, '.settings-main {'));
    expect(pageSurface).toBe('--s2');

    const mask = ruleBody(settings, '.settings-main .settings-hub-tabs,');
    expect(mask).not.toBeNull();
    expect(backgroundToken(mask)).toBe(pageSurface);

    // The session hub shares the rule; both selectors must be covered.
    expect(settings).toContain('.settings-main .session-hub-tabs {');
  });

  it('keeps the heading rhythm scoped to hub pages', () => {
    // proto-05 `.st { margin: 26px auto 14px }` / `.st:first-child { margin-top:
    // 6px }` is the authored title rhythm, and the Deck header rule's 24px
    // `margin-bottom: var(--s-8)` left a 42px hole under a hub heading. It must
    // stay scoped: a non-hub .settings-main-header sits in the page scroller as
    // a shrinkable flex item, so dropping the margin there lets the body ride up
    // over the squeezed heading (12px overlap at an 855x540 viewport).
    const shared = ruleBody(settings, '\n  .settings-main-header {');
    expect(shared).not.toBeNull();
    expect(shared).toMatch(/padding-bottom:\s*18px/);
    expect(shared).not.toMatch(/margin-bottom/);

    const hub = ruleBody(
      settings,
      '.settings-main:has(.settings-hub-page) > .settings-main-header {',
    );
    expect(hub).not.toBeNull();
    expect(hub).toMatch(/padding-bottom:\s*14px/);
    expect(hub).toMatch(/margin-bottom:\s*0/);
  });
});
