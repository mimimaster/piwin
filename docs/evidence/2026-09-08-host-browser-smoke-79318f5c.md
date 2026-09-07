# Host browser A/B/C smoke — 2026-09-08

## Scope

- Target commit: `79318f5c94322be110e458bae7ebb6e3ca7949b8`
- Host checkout: a detached temporary worktree at that exact commit. The original dirty checkout was not used for the smoke run.
- Runtime: macOS 26.5 (25F71), Node 24.11.1, pnpm 9.15.0, Playwright Core 1.61.1.
- The existing user profile `/Users/yorickjue/.piwin/browser-profile` existed before and after the run and was not used.

The target commit's `BrowserWorkbenchConfig` did not expose a `profileDir` field. I set `PiwinConfig.browser.headless=false` in a temporary config root and isolated the Host's default profile by running the smoke process with a temporary `HOME`. The actual headed profile was therefore:

`/tmp/piwin-browser-home.iC6W5t/.piwin/browser-profile`

No user Chrome process was killed. The only browser process terminated during cleanup was the throwaway Chrome started by the smoke harness.

## Commands actually run

The following were run against the detached worktree:

```text
git worktree add --detach /tmp/piwin-browser-smoke.Y45BWk/repo 79318f5c94322be110e458bae7ebb6e3ca7949b8
pnpm install --offline --frozen-lockfile
node --import tsx /Users/yorickjue/Developer/piwin/scripts/.host-browser-smoke.mts /tmp/piwin-browser-smoke.Y45BWk/repo
pnpm --filter @piwin/browser exec vitest run src/browser-cdp.test.ts src/browser-cdp-connect.test.ts src/browser-session.test.ts
pnpm --filter @piwin/host-runtime exec vitest run src/browser-tools-stage-bc.test.ts src/browser-tools.test.ts src/browser-navigate-permission.test.ts src/config-store-browser.test.ts
pnpm --filter @piwin/browser typecheck
pnpm --filter @piwin/host-runtime typecheck
```

The smoke harness was temporary and removed after the run. Temporary profiles, config roots, fixture files, and the local HTTP server were also removed.

## Results

### A — headed Host Chromium

Passed.

- Temporary config: `/tmp/piwin-browser-root.bHUbel/config.json`
- Loaded config: `browser.headless=false`
- Fixture: `http://127.0.0.1:54468/fixture.html`
- Snapshot found the button reference `e6`.
- One click completed; the fixture counter reached `Clicked 1 times`.
- Reported viewport: `1280×800`.
- Screenshot dimensions: `1280×800`.
- The launched Chromium process had no headless flag.

### B — loopback CDP

Passed live.

- First exploratory attempt with the bundled Playwright Chrome for Testing binary timed out during the CDP handshake; it was cleaned up and was not treated as the result.
- Final run launched the installed Google Chrome binary at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, version `152.0.7977.77`.
- Throwaway profile: `/tmp/piwin-browser-cdp-profile.rItvkP`
- Launch flags included `--user-data-dir=<temporary profile>` and `--remote-debugging-port=9222`.
- Host config: `browser.cdpEndpoint=http://127.0.0.1:9222`.
- `browser_tabs list` completed; selected page ID `p-1-1`.
- `browser_tabs select` completed.
- One selector click completed; the fixture counter reached `Clicked 1 times`.
- Host session was disposed as an attached session. The throwaway Chrome remained alive and `/json/version` continued to respond after Host disposal.
- `context.close()` was not called.
- The attached tab list returned a blank URL field for the selected page, but page selection, click, and counter verification all succeeded.

No extension or `autoConnect` fallback was used.

### C — URL and metadata protection

Passed.

- `browser_tabs action=new` with `file:///etc/passwd` was rejected with `invalid-input` (`url must be http(s)`).
- `browser_tabs action=new` with `http://169.254.169.254` was rejected with `permission-denied` (`Permission denied for browser_tabs: private-or-local:169.254.169.254`).
- Tab count stayed at `1` before and after both rejected requests, so neither request opened a tab.

## Verification and cleanup

- Browser tests: 54 passed across 3 files.
- Host-runtime browser tests: 69 passed across 4 files.
- `@piwin/browser` typecheck: passed.
- `@piwin/host-runtime` typecheck: passed.
- Port `9222` was free after cleanup.
- The original `/Users/yorickjue/.piwin/browser-profile` still existed after cleanup.
- Original unrelated working-tree changes were preserved.
