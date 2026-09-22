# Piwin Host Server

Standalone Host entry point for the initial multi-client slice.

Packaged layout (no source checkout):

```bash
pnpm package:web
./dist/piwin-host/start-host.sh
# http://127.0.0.1:8787 serves the page and the WebSocket
```

`pnpm package:host` builds the Host only. `package:web` builds the browser UI
first and copies it to `dist/piwin-host/web/`. The launcher sets
`PIWIN_HOST_WEB_ROOT` when that directory is present.

Supervised local process (auto-restart on crash):

```bash
chmod +x scripts/supervise-host.sh
./scripts/supervise-host.sh
# or: ./scripts/supervise-host.sh pnpm --dir apps/host dev
```

Defaults:

- bind: `127.0.0.1`
- port: `8787`
- protocol: private WebSocket Host protocol v1 (cleartext `ws://` inside the process)

## TLS / advertised URLs

The Host process itself always creates a **cleartext** `WebSocketServer`.
`PIWIN_HOST_ADVERTISED_URL` only changes what pairing QR / status print — it
does **not** enable TLS in-process.

Typical private deployment:

```bash
# Host binds loopback cleartext
PIWIN_HOST_BIND=127.0.0.1 PIWIN_HOST_PORT=8787 PIWIN_HOST_PAIRING=1 \
  PIWIN_HOST_ADVERTISED_URL=wss://mac.tailnet.ts.net pnpm --dir apps/host dev

# Terminate TLS at Tailscale Serve / Caddy / nginx in front of 127.0.0.1:8787
```

Dialing `wss://host:8787` **directly at the Node process** will fail unless a
TLS proxy is in front. Prefer Tailscale Serve or a reverse proxy.

## Auth on non-loopback

For a private-network bind, set `PIWIN_HOST_BIND` and also set
`PIWIN_HOST_TOKEN`, or enable device pairing (`PIWIN_HOST_PAIRING=1`). A
non-loopback bind without a door token or pairing store is rejected.

Door tokens on cleartext LAN WebSockets are visible to anyone on the path.
Set `PIWIN_HOST_ALLOW_CLEARTEXT=1` only on a trusted private network after you
accept that risk; otherwise terminate TLS in front of Host.

## Browser Origins

Browsers send an `Origin` header. With no allowlist, Host admits loopback and
`tauri://localhost` only, so a page on another host is closed with `4009`.

```bash
PIWIN_HOST_ALLOWED_ORIGINS='https://ui.example.com,http://127.0.0.1:1420' \
  pnpm --dir apps/host dev
```

Values are exact Origins (`scheme://host[:port]`), comma-separated, at most 32.
`PIWIN_HOST_ALLOWED_ORIGINS=*` admits every browser Origin; use it only inside
a private network you already trust. CLI and native clients omit `Origin` and
are unchanged.

Device pairing (mobile enrollment) is operator-local:

```bash
PIWIN_HOST_PAIRING=1 PIWIN_HOST_ADVERTISED_URL=wss://mac.tailnet.ts.net pnpm --dir apps/host dev
```

On start the process mints a one-time token (~10 minutes), persists hashes at
`~/.piwin/devices/pairing.json` (mode 0600), and prints v2 JSON plus a
`piwin://pair?...` URI. The phone must dial **this** Host — Desktop
`pnpm dev:tauri` is a different process holding the same `~/.piwin` lease.
Wildcard binds (`0.0.0.0` / `::`) refuse to print a pairing QR; the listen URL
is rewritten to `ws://127.0.0.1:<port>` for local dialability.

## Build / client version

Optional:

- `PIWIN_HOST_BUILD_ID` — echoed in `host/hello.hostBuildId` and listen logs
- `PIWIN_HOST_MIN_CLIENT_VERSION` — reject shells with older `clientVersion` (close 4002)

The current remote slice admits safe status/project/session reads, text session
control, permission resolution, small image assets, sequenced replay, cursor
batches, automatic reconnect, and Host heartbeat. Large or resumable media
uploads and public Gateway deployment remain follow-up slices.
