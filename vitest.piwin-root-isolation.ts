/**
 * Vitest setup file: give every test file its own throwaway piwin root.
 *
 * Why: `getPiwinRoot()` falls back to the developer's real `~/.piwin` when a
 * test forgets `piwinRoot`, and a mock HostRuntime then writes sessions,
 * index rows, leases and notes into the user's product data (hundreds of
 * "/tmp/project" sessions accumulated that way). Setting `PIWIN_ROOT` and
 * `PIWIN_PI_AGENT_DIR` here makes the fallback land in a temp dir instead.
 * Tests that pass an explicit root, or set/restore `PIWIN_ROOT` themselves,
 * are unaffected.
 *
 * Not covered: code that calls `homedir()` directly (doc-rag default root,
 * host-server pairing fallback, browser profile) — those need an explicit
 * root from their callers.
 *
 * Referenced from package vitest configs (`setupFiles`); lives at the repo
 * root because it is shared test infrastructure, not package source.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const isolatedRoot = mkdtempSync(join(tmpdir(), 'piwin-test-root-'));
process.env.PIWIN_ROOT = isolatedRoot;
process.env.PIWIN_PI_AGENT_DIR = join(isolatedRoot, 'pi-agent');
// Styling tests assert exact SGR codes; a developer's NO_COLOR or theme must not change them.
delete process.env.NO_COLOR;
delete process.env.PIWIN_TUI_THEME;

afterAll(() => {
  try {
    rmSync(isolatedRoot, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    // A late async write can race the cleanup; the dir is under tmpdir, so
    // leaking it is harmless — but say so instead of failing the file.
    console.warn(`[piwin-test] could not remove ${isolatedRoot}: ${String(error)}`);
  }
});
