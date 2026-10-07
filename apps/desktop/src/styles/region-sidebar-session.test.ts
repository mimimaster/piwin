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

describe('session row status seal vs hover actions', () => {
  it('reserves clearance so archive actions never share the completed/failed seal slot', () => {
    // Completed/failed attention owns the trailing seal; hover actions shift
    // left by --session-status-seal-clearance instead of cross-fading on top
    // (the archive∩check overlap).
    expect(session).toMatch(/--session-status-seal-clearance:\s*0px/);
    expect(session).toMatch(
      /\.session-row--completed,\s*\n\.session-row--failed\s*\{[\s\S]*?--session-status-seal-clearance:\s*26px/,
    );
    expect(session).toMatch(
      /\.session-row-actions\s*\{[\s\S]*?right:\s*calc\(var\(--s-2\)\s*\+\s*var\(--session-status-seal-clearance\)\)/,
    );
    // Working pulse and terminal status seals yield on hover while the action
    // cluster is visible; the clearance variable still reserves their resting
    // slot so neither state can overlap.
    expect(session).toMatch(
      /\.session-row--working:hover\s+\.session-item-activity/,
    );
    expect(session).toMatch(
      /\.session-row:hover\s+\.session-item-completed-mark/,
    );
    expect(session).toMatch(/\.session-row:hover\s+\.session-item-failed-mark/);
    expect(inkstoneSidebar).toMatch(
      /right:\s*calc\(6px\s*\+\s*var\(--session-status-seal-clearance/,
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
