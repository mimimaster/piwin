import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const session = readFileSync(join(here, 'region-sidebar-session.css'), 'utf8');
const inkstoneSidebar = readFileSync(join(here, 'inkstone/sidebar.css'), 'utf8');

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
});
