import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const trayCss = readFileSync(join(here, 'plan-todo-tray.css'), 'utf8');
const inkstoneGatesCss = readFileSync(join(here, 'inkstone/permission-gates.css'), 'utf8');

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
