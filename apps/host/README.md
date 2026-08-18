# Piwin Host Server

Standalone Host entry point for the initial multi-client slice.

```bash
PIWIN_MOCK=1 pnpm dev:host
```

Defaults:

- bind: `127.0.0.1`
- port: `8787`
- protocol: private WebSocket Host protocol v1

For a private-network bind, set `PIWIN_HOST_BIND` and also set
`PIWIN_HOST_TOKEN`, or enable device pairing (`PIWIN_HOST_PAIRING=1`). A
non-loopback bind without a door token or pairing store is rejected.

Device pairing (mobile enrollment) is operator-local:

```bash
PIWIN_HOST_PAIRING=1 PIWIN_HOST_ADVERTISED_URL=wss://mac.tailnet.ts.net:8787 pnpm --dir apps/host dev
```

On start the process mints a one-time token (~10 minutes), persists hashes at
`~/.piwin/devices/pairing.json` (mode 0600), and prints v2 JSON plus a
`piwin://pair?...` URI. The phone must dial **this** Host — Desktop
`pnpm dev:tauri` is a different process holding the same `~/.piwin` lease.
Wildcard binds (`0.0.0.0` / `::`) refuse to print a pairing QR.

The current remote slice admits safe status/project/session reads, text session
control, permission resolution, small image assets, sequenced replay, cursor
batches, automatic reconnect, and Host heartbeat. Large or resumable media
uploads and public Gateway deployment remain follow-up slices.
