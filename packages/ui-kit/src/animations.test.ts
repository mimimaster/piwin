import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiteRing, RadialBellow } from './animations.js';

describe('RadialBellow animation geometry', () => {
  it('places each vane inside a static radial slot so paused animations keep ring layout', () => {
    const markup = renderToStaticMarkup(createElement(RadialBellow, { size: 'sm' }));
    const slotMatches = markup.match(/class="ui-anim-radial-bellow__slot"/g) ?? [];
    const vaneMatches = markup.match(/class="ui-anim-radial-bellow__vane"/g) ?? [];
    expect(slotMatches).toHaveLength(8);
    expect(vaneMatches).toHaveLength(8);
  });

  it('keeps radial placement on static slots rather than inside @keyframes', () => {
    const css = readFileSync(new URL('./primitive-animations.css', import.meta.url), 'utf8');
    const slotMatch = css.match(/\.ui-anim-radial-bellow__slot\s*\{([^}]*)\}/);
    expect(slotMatch?.[1]).toContain('rotate(calc(var(--i) * 45deg)) translateX(var(--vane-radius, 20px))');

    const keyframeMatch = css.match(/@keyframes ui-anim-radial-bellow\s*\{([\s\S]*?\n\})/);
    expect(keyframeMatch?.[1]).toBeDefined();
    expect(keyframeMatch?.[1]).not.toContain('var(--i)');
    expect(keyframeMatch?.[1]).not.toContain('rotate(');
    expect(keyframeMatch?.[1]).toContain('transform: scale(');
  });
});

describe('LiteRing low-memory motion primitive', () => {
  it('renders a single non-SVG rotating arc element', () => {
    const markup = renderToStaticMarkup(createElement(LiteRing, { size: 'sm' }));
    const arcMatches = markup.match(/class="ui-anim-lite-ring__arc"/g) ?? [];
    expect(arcMatches).toHaveLength(1);
    expect(markup).not.toContain('<svg');
  });

  it('uses pure transform rotation in @keyframes and respects reduced-motion', () => {
    const css = readFileSync(new URL('./primitive-animations.css', import.meta.url), 'utf8');
    const keyframeMatch = css.match(/@keyframes ui-anim-lite-ring\s*\{([\s\S]*?\n\})/);
    expect(keyframeMatch?.[1]).toContain('transform: rotate(360deg)');

    const reducedMotionMatch = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n\})/);
    expect(reducedMotionMatch?.[1]).toContain('.ui-anim-lite-ring__arc');
    expect(reducedMotionMatch?.[1]).toContain('.ui-anim-radial-bellow__vane');
    expect(reducedMotionMatch?.[1]).toContain('transform: scale(0.55, 0.45)');
  });
});
