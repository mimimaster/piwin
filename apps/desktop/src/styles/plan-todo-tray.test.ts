import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const trayCss = readFileSync(join(here, 'plan-todo-tray.css'), 'utf8');
const inkstoneGatesCss = readFileSync(join(here, 'inkstone/permission-gates.css'), 'utf8');
const emptyStageCss = readFileSync(join(here, 'transcript-empty-stage.css'), 'utf8');
const inkstoneNavigationCss = readFileSync(join(here, 'inkstone/navigation.css'), 'utf8');

describe('plan todo tray measure column', () => {
  it('uses the composer dock pad then centers the measure child', () => {
    const start = trayCss.indexOf('.composer-plan-stack {');
    const childStart = trayCss.indexOf('.composer-plan-stack > * {');
    const stack = trayCss.slice(start, childStart);
    expect(stack).toContain('align-self: stretch;');
    expect(stack).toContain('width: 100%;');
    expect(stack).toContain('padding: 0 var(--chat-inline-pad);');
    expect(trayCss.slice(childStart, childStart + 280)).toContain(
      'width: min(100%, var(--conversation-width));',
    );
    expect(trayCss.slice(childStart, childStart + 280)).toContain('margin-inline: auto;');
  });

  it('does not let Inkstone recap the tray and left-align it on a wide stage', () => {
    expect(inkstoneGatesCss).not.toMatch(
      /\.plan-todo-tray \{[^}]*max-width:\s*var\(--conversation-width\)/,
    );
  });
});

describe('empty-stage permission stack order', () => {
  function orderOf(css: string, selector: string): string | undefined {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 's').exec(css)?.[1]?.match(/order:\s*(\d+)/)?.[1];
  }

  it('keeps the permission stack with the composer, under the welcome heading', () => {
    expect(orderOf(emptyStageCss, '.chat-column-empty .empty-stage-welcome')).toBe('1');
    expect(orderOf(emptyStageCss, '.chat-column-empty .composer-plan-stack')).toBe('2');
    expect(orderOf(emptyStageCss, '.chat-column-empty .composer-dock.layout-centered')).toBe('3');
    expect(orderOf(emptyStageCss, '.chat-column-empty .empty-stage-landing-history')).toBe('4');
  });

  it('keeps the same order under Inkstone, which restates the empty stage', () => {
    expect(orderOf(inkstoneNavigationCss, '.empty-stage-welcome')).toBe('1');
    expect(orderOf(inkstoneNavigationCss, '.chat-column-empty .composer-plan-stack')).toBe('2');
    expect(orderOf(inkstoneNavigationCss, '.chat-column-empty .composer-dock.layout-centered')).toBe('3');
    expect(orderOf(inkstoneNavigationCss, '.empty-stage-landing-history')).toBe('4');
  });
});

describe('live permission stack is a footer slot', () => {
  it('keeps the stack in normal flow above the composer instead of overlaying it', () => {
    expect(trayCss).not.toMatch(/\.chat-stage > \.composer-plan-stack/);
    expect(trayCss).not.toContain('--composer-lid-offset');
    const stack = trayCss.slice(
      trayCss.indexOf('.composer-plan-stack {'),
      trayCss.indexOf('.composer-plan-stack > * {'),
    );
    expect(stack).toMatch(/position:\s*relative/);
    expect(stack).toMatch(/flex-shrink:\s*0/);
  });
});
