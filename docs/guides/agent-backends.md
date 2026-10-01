# Optional Agent backends

Pi remains built in. Grok Build is an optional declarative ACP adapter installed
on the attached Host, not on a separate Desktop authority. The adapter contains
no JS module, shell installer or install hook. CLI binaries are not bundled.

## Install and configure

In Desktop: Marketplace → Agent → Grok Build → Install, then
Settings → Agent Backends. Installing an adapter does not mean its CLI or
account is ready. Existing Grok CLI installations are user-owned dependencies.

```sh
piwin agents install --agent grok
piwin agents list
# Install the official Grok CLI on the Host if missing, then run its own login.
grok login
piwin agents check --agent grok
# Optional explicit Host-local runtime path; never falls back to another binary.
piwin agents check --agent grok --path /absolute/path/to/grok
piwin chat --agent grok "your task"
```

`PIWIN_HOST_URL` makes CLI attach to the same Host used by Desktop. Dependency
installation and login happen on that Host, including when it is remote. The
Grok account is separate from xAI model-provider OAuth. Reading the market or
installed inventory does not launch Grok; explicit Check and session activation
perform bounded ACP handshakes. No paid prompt is sent as a hidden readiness test.

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

Host records are under `~/.piwin/agents/inventory.json`, serialized with the
existing file lock and atomically replaced. Corrupt inventory fails closed;
it is not overwritten with a fake empty installation list.

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
install, explicit detection, disable/enable and uninstall confirmation.
