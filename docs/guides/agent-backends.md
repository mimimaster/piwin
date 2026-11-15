# Optional Agent backends

Pi remains built in. Grok Build is an optional ACP adapter extension installed
on the attached Host, not on a separate Desktop authority. Its adapter artifact
is verified before launch; extension installation runs no shell installer or
install hook. CLI binaries are not bundled.

## Install and configure

In Desktop: install and enable the backend extension in Marketplace
(Grok Build ACP, or Claude Code as `mimimaster/claude-code`).
The workbench automatically detects its Host CLI and refreshes the session
picker; opening Settings → Agent Backends or clicking Check again is optional.
Installing an adapter does not mean its CLI or account is ready. Existing Grok
CLI installations are user-owned dependencies.

```sh
# Install the backend extension in Marketplace first.
piwin agents list
# Install the official Grok CLI on the Host if missing, then run its own login.
grok login
piwin agents check --agent grok
piwin chat --agent grok "your task"
# Claude Code / Codex (installed Agent plugins) use the same --agent id.
# One-shot chat cannot answer native questions: it cancels and tells you to use
# Desktop or `piwin tui`. TUI answers a single text/select question by original id.
```

`PIWIN_HOST_URL` makes CLI attach to the same Host used by Desktop. Dependency
installation and login happen on that Host, including when it is remote. The
Grok account is separate from xAI model-provider OAuth. Reading the market or
installed inventory does not launch Grok. Readiness queries automatically perform
a bounded adapter check when no fresh status is cached; the workbench requests
a fresh check after extension changes and when connecting to the Host. Disabled
extensions are not probed. No paid prompt is sent as a hidden readiness test.

Only macOS Host has a reviewed adapter recipe today. Unverified Windows/Linux
installations are refused rather than presented as verified. Official CLI
binary installation remains manual until a verifiable distribution recipe is
available; this does not prevent installing the lightweight adapter.

## Disable and uninstall

```sh
piwin agents disable --agent grok
piwin agents enable --agent grok
piwin agents uninstall --agent grok
```

Disabled/uninstalled adapters reject new Runs, including resident-session
prompts and queued drain. Already running work is not aborted. History,
backend bindings, native Grok sessions, authentication and user-owned CLI are
preserved. Uninstall does not invoke Grok's permanent session delete API.
After reinstalling the same adapter revision, histories remain usable.
Different adapter revisions require explicit migration; no live revision is
silently replaced.

## Plugin file verification failures

If a session entry shows **Plugin Check Failed**, Agent settings explains that
the installed adapter file is missing, unreadable, or differs from the size/SHA-256 recorded in its
manifest (`agent-artifact-integrity`). Enabling the extension does not bypass
this check. This is an installation problem; account login or model-provider
configuration does not repair the artifact.

The session entry shows **View repair steps** and opens Agent settings. From
there, **Manage extensions** opens the existing Extensions page. Reinstall the
adapter from its original source with the matching manifest and artifact, then
click **Check again**. Never replace only `dist/agent.mjs` inside an installed
revision or edit its checksum to accept changed files. Restore the original
verified artifact, or stage a complete new revision through extension install.

Missing CLI and sign-in states keep their own install/sign-in guidance. A
backend with no readiness result yet is shown as **Check Pending**.

Host enablement and installation records use the ordinary extension revision
store under `~/.piwin/extensions/`; there is no separate agent inventory.

## Blank native terminal or a busy Desktop writer

An embedded CLI can still own the conversation while its screen is blank.
Antigravity's startup mode query exposed a release minification defect in the
terminal library: parsing stopped even though CLI output arrived. The frontend
now uses the library's compatible published main entry, with a release-build
regression for the real startup queries. Window resizing does not recover a
parser that has already stalled. Changing the view does not end a running CLI
turn. Desktop sending takes input ownership only after the adapter verifies
that the native conversation is idle.

Antigravity creates no transcript for a brand-new zero-turn conversation. Its
adapter verifies the native database identity and absence of steps before
reporting idle and an empty history snapshot. An older adapter may instead
report unknown and leave Desktop sending blocked. Update the adapter together
with the Desktop startup fix; replacing only the app does not update an
independently installed extension. Do not overwrite an installed revision's
artifact: install a matching artifact and manifest through Extensions.

## Real-CLI probes

`packages/host-runtime/scripts/grok-mcp-smoke.fixture.ts` is an explicit,
non-paid probe of the safe MCP projection against the real Grok CLI on this
machine: handshake, a throwaway session, a redacted status read, no model
prompt. It is never run by tests or by readiness checks.

```sh
# cwd packages/host-runtime
pnpm exec tsx scripts/grok-mcp-smoke.fixture.ts
```

## MCP visibility and distribution

Settings renders only safe MCP status notifications observed during Grok
sessions. No observed status means unknown, not zero configured servers. The
raw server configuration, env, headers, command arguments and raw failure
reasons are never displayed. Manage the server on the Host with `grok mcp`.

The marketplace keeps its offline Grok entry and reads the separate
`https://extension.piwinwin.com/agents.json` when available. The existing
extension `index.json` v1 remains unchanged. Agent manifests require exact
SHA-256 content and matching id/version; remote catalogs cannot supply new
executable recipes. A missing Agent index does not invalidate the extension
catalog. Local site implementation and public publication are separate gates.

## Browser smoke fixture

The fixture uses real Host inventory and WebSocket transport with fake ACP,
not an in-browser simulated installation state. It uses a disposable data root
and sends no real model prompts.

```sh
pnpm build:web
# terminal 1, cwd packages/host-server
pnpm exec tsx scripts/agent-plugin-preview.fixture.ts
# terminal 2, cwd apps/desktop
python3 -m http.server 8877 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8877` and connect to `ws://127.0.0.1:8876`. Test market
install with automatic detection, disable/enable and uninstall confirmation.
