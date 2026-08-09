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
`PIWIN_HOST_TOKEN`. A non-loopback bind without a token is rejected.

The current remote slice admits safe status/project/session reads, text session
control, permission resolution, small image assets, sequenced replay, cursor
batches, automatic reconnect, and Host heartbeat. Pairing/Keychain credentials,
large or resumable media uploads, and public Gateway deployment remain follow-up
slices.
