import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const session = readFileSync(join(here, 'region-sidebar-session.css'), 'utf8');
const inkstoneSidebar = [
  'sidebar-chrome.css',
  'sidebar-tree.css',
  'sidebar-sessions.css',
]
  .map((name) => readFileSync(join(here, 'inkstone', name), 'utf8'))
  .join('\n');

describe('session row status marks', () => {
  it('keeps status in the lead slot, not in the trailing action column', () => {
    // Status owns the lead slot, so the trailing edge holds only the time and
    // the hover actions: no seal there, and no clearance reserved for one.
    expect(session).toMatch(/\.session-status-mark\s*\{[\s\S]*?width:\s*14px/);
    expect(session).toMatch(/\.session-status-mark--running::before\s*\{[\s\S]*?animation:\s*session-status-spin/);
    expect(`${session}\n${inkstoneSidebar}`).not.toMatch(
      /session-status-seal-clearance|session-item-activity|session-item-completed-mark|session-item-failed-mark/,
    );
  });

  it('reveals row actions on hover only for a hovering pointer', () => {
    // iOS spends the first tap on a :hover that changes visibility, so an
    // ungated reveal made every session row need two taps to open.
    const withoutHoverMedia = session
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media \(hover: hover\) \{[\s\S]*?\n\}\n/g, '');
    const ungatedHoverReveals = [...withoutHoverMedia.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)].filter(
      (rule) => /visibility|pointer-events/.test(rule[2] ?? ''),
    );
    expect(ungatedHoverReveals.map((rule) => rule[1]?.trim())).toEqual([]);
    expect(session).toMatch(
      /@media \(hover: none\) \{[\s\S]*?\.session-row--active[^{]*\.session-action-btn\s*\{[^}]*visibility:\s*visible/,
    );
  });
});
