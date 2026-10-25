# Remote relay guide

| Field | Value |
|-------|-------|
| Status | Living document — relay, Host side and every shell shipped; legacy cutover follows the timeline in §7 |
| Related | [ADR 0101](../adr/0101-content-blind-relay-per-device-e2ee.md), [apps/gateway](../../apps/gateway/README.md) |

The piwin relay (`apps/gateway`) lets every remote shell — phone, Desktop thin
shell, CLI/TUI, browser — reach your Host from any network. Both sides dial
out to the relay; the Host opens no port. Traffic is end-to-end encrypted with
Noise IK between the shell and the Host, so the relay forwards ciphertext it
cannot read.

piwin runs no public relay. You host your own.

## 1. Run the relay

Build the image from the repository root and run it with a data volume:

```bash
docker build -f apps/gateway/Dockerfile -t piwin-gateway .
docker run -d --name piwin-gateway --restart unless-stopped \
  -p 127.0.0.1:7466:7466 \
  -v piwin-relay:/data \
  -e PIWIN_RELAY_ENROLL_TOKEN="$(openssl rand -hex 24)" \
  piwin-gateway serve --host 0.0.0.0 --trust-proxy
```

Without Docker: `pnpm --filter @piwin/gateway bundle`, then
`node apps/gateway/dist/piwin-gateway.mjs serve`.

| Option | Meaning |
|--------|---------|
| `--port` / `PORT` | Listen port (default 7466) |
| `--host` | Bind address (default 0.0.0.0) |
| `--users` / `PIWIN_RELAY_USERS` | Registry file (Docker: `/data/users.json`) |
| `--web-root <dir>` | Serve the browser shell at `/` |
| `--trust-proxy` | Rate-limit by `X-Forwarded-For`; only behind your own proxy |
| `--log-ips` | Include client IPs in logs (off by default) |
| `PIWIN_RELAY_ENROLL_TOKEN` | Lets a Host register its user on first connect (≥ 16 chars) |

## 2. Put TLS in front

The relay speaks plain `ws://`. Terminate TLS with a reverse proxy. Caddy:

```caddyfile
relay.example.com {
  reverse_proxy 127.0.0.1:7466
}
```

Caddy forwards WebSocket upgrades and sets `X-Forwarded-For`; run the relay
with `--trust-proxy` behind it. Your relay URL is `wss://relay.example.com`.

## 3. Register users

A relay user stands in for an account: it decides who may attach Hosts and
keeps users on a shared relay invisible to each other. Its id is derived from
a key, never from the name.

- **Enrollment token (one person).** Start the relay with
  `PIWIN_RELAY_ENROLL_TOKEN` and give the token to your Host once. Its first
  connection registers your user. Remove the variable afterwards if you like.
- **Paste (shared relay).** The Host shows a line
  `piwin-user:v1:<key>:<name>`. On the relay:

  ```bash
  docker exec piwin-gateway node /app/piwin-gateway.mjs user add 'piwin-user:v1:…'
  ```

Admin commands (the running relay reloads within a few seconds):

```bash
piwin-gateway user list
piwin-gateway user add '<line>' [--max-hosts N] [--max-peers N]
piwin-gateway user disable|enable|remove <userId>
piwin-gateway host deny|allow <hostId>
```

Disabling a user or denying a Host closes its live connections.

Defaults per user: 8 Hosts, 32 connected shells per Host.

## 4. Point your Host at the relay

Standalone Host (`apps/host`):

| Variable | Meaning |
|----------|---------|
| `PIWIN_HOST_RELAY_URL` | Relay address (`wss://relay.example.com`) |
| `PIWIN_RELAY_ENROLL_TOKEN` | One-time enroll token; forgotten once the relay admits the Host |
| `PIWIN_HOST_USER_NAME` | Name of the relay user created on first start (default: OS user) |
| `PIWIN_HOST_LEGACY_ACCESS` | `full` (default), `migrate-only` or `off` for pre-relay clients |

On first start the Host creates its identity under `~/.piwin/devices/`
(`host-identity.json`, `relay-user.json`, `remote-access.json`). While no
operator device exists it prints an operator pairing link
(`piwin://pair?v=3…`): open it on the shell that should administer the Host.

The bundled Desktop serves the same channel on its phone-access listener and
connects to the relay while phone access is on. Configure it under
**Settings → Phone access → Remote access**:

- relay address and enroll token, with the relay's state and a hint for the
  last close code;
- the relay user: rename it, copy its `piwin-user:v1:…` line for a shared relay;
- the policy for pre-relay clients (`legacyAccess`, see §7);
- **Admin pairing code**: a one-time code whose device may manage pairing and
  relay settings. The normal code pairs a member device.

From a terminal, an operator shell (`PIWIN_HOST` naming an admin device, or a
loopback `PIWIN_HOST_URL`) does the same:

```bash
piwin relay status
piwin relay configure --url wss://relay.example.com [--enroll-token <token>]
piwin relay configure --off
piwin relay legacy full|migrate-only|off
piwin relay user rename "New name"
piwin relay user enrollment-line
piwin host pair [--operator]
```

`piwin relay user create|export|import` moves the relay user between machines
so several Hosts share one user. Export and import read the passphrase from
`--passphrase-file` or `PIWIN_RELAY_PASSPHRASE`.

## 5. Pair your shells

Every remote shell pairs the same way: a one-time `piwin://pair?v=3…` code
from the Host (QR or link) or the browser form
`https://relay.example.com/#pair=…`. Pairing pins the Host's key; the shell
keeps a host book (no secrets) and, per Host, a device key and credential in
the platform's secret store.

| Shell | Pair | Secrets |
|-------|------|---------|
| Phone | scan the QR, or paste the link | iOS / Android keystore |
| Desktop thin shell | paste the link on the connect wall | Keychain / Credential Manager / Secret Service |
| Browser | open the `#pair=` link (cleared from the address bar at once), or paste it | IndexedDB of the relay's origin |
| CLI / TUI | `piwin pair '<link>' [--alias <name>]` | owner-only files under `~/.piwin/client/` |

The connect wall lists every paired Host to switch to or remove. In the CLI:

```bash
piwin hosts list
piwin hosts use <alias|hostId|name>  # default for later commands
piwin hosts use --local              # back to an in-process Host
piwin hosts alias <alias|hostId|name> <alias>
piwin hosts forget <alias|hostId|name>
PIWIN_HOST=<alias|hostId> piwin tui
```

Shells dial the relay first and fall back to the Host's direct address when
the relay cannot be reached, then return to the relay after a reconnect or
wake. When the Host's relay or address changes it pushes the new one, and the
host book follows.

## 6. What the relay can and cannot see

| Sees | Cannot |
|------|--------|
| user and Host ids, connection counts, frame sizes and timing | read or change prompts, files, commands or credentials |
| client IPs (logged only with `--log-ips`) | impersonate your Host (shells pin its key) or a paired shell |
| | let a stranger pair without a live pairing code |

Users on one relay cannot attach a Host under another user, connect to
another user's Host, or tell whether it is online: every such attempt gets the
same `4404`.

The browser shell is the one exception to "the relay cannot read": a browser
runs whatever JavaScript the relay serves. On a relay you run yourself that is
you. Native shells do not depend on it.

## 7. Moving existing shells

Shells paired before the relay keep working and move themselves onto the
encrypted channel; nobody scans again.

- **Phone, Desktop thin shell, browser**: after startup, a saved address with
  a device credential or access token runs `host/channel-migrate` once over
  the old connection, checks the new channel, then forgets the old
  credential. An older Host or a failure keeps the old connection and the
  next launch tries again. Loopback addresses are the Host's own admin door
  and are left alone.
- **CLI**: a non-loopback `PIWIN_HOST_URL` with `PIWIN_HOST_TOKEN` or
  `PIWIN_HOST_DEVICE_*` migrates on first use and prints the `PIWIN_HOST=`
  to use instead.

The Host's `legacyAccess` setting closes the old path in steps across
releases (N = the release that ships the relay):

| Release | Default | Old connections |
|---------|---------|-----------------|
| N | `full` | work as before and migrate |
| N+1 | `migrate-only` | may only migrate; other commands are refused with "pair again" |
| N+2 | removed | the old path, access tokens, `{ token }` and v1/v2 codes are gone |

`off` refuses old connections now; they are told to pair again.
Set it early with `PIWIN_HOST_LEGACY_ACCESS`, `piwin relay legacy`, or the
Remote access settings once every shell shows as migrated in the device list.

## 8. Close codes

| Code | Meaning | Shell behavior |
|------|---------|----------------|
| 4400 | Malformed request | stop |
| 4401 | Host authentication failed | stop (Host) |
| 4403 | User disabled or Host denied | stop (Host) |
| 4404 | Not available (Host offline, unknown, or not yours) | retry; "Host is offline or not on this relay" |
| 4409 | Replaced by a newer connection of the same Host | — |
| 4413 | Frame too large | stop |
| 4429 | Limit reached (Hosts, shells, rate, send buffer) | retry later |
| 4004 | Channel handshake failed: the Host key does not match the pinned one (shell-side) | stop; pair again |
| 4007 | Channel broke after the handshake (shell-side) | reconnect with a new handshake |

HTTP `429` on upgrade means the client IP opened too many connections in a
minute; `400` means the URL is not a channel route.
