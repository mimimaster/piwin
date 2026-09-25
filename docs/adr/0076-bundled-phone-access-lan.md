# ADR 0076: Bundled app phone access listens on the LAN by default

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-09-26 |
| Related | [0037-mobile-remote-shell.md](./0037-mobile-remote-shell.md), [0075-operator-host-pairing.md](./0075-operator-host-pairing.md), [hybrid mobile continuity spec](../superpowers/specs/2026-08-13-hybrid-host-mobile-continuity-design.md) |

## Context

The bundled Desktop app runs its Host as a JSONL sidecar. Phone access was a
separate `HostServer` owned by `MobileAccessController`, bound to
`127.0.0.1:8787` only (the "loopback" profile). A phone cannot dial loopback,
so the QR was useless without a hand-built Tailscale Serve / SSH tunnel, the
switch was off by default, and a dev Host on 8787 made it fail with
`EADDRINUSE`. The hybrid continuity spec (§ controller refusals) had
deliberately forbidden wildcard binds and automatic LAN address selection.

Owner direction (2026-09-26): the bundled app must let a phone scan a QR and
connect with no Host configuration; phone access is on by default and a single
switch turns it off.

## Decision

1. **LAN profile.** `@piwin/contracts` adds `MOBILE_ACCESS_LAN_PROFILE_ID =
   'lan'`; the controller binds it to `0.0.0.0`. `loopback` stays for tunnel
   setups. Admission is unchanged: off loopback there is no anonymous hello,
   only a one-time pairing token or a paired device credential.
2. **The QR names a dialable address, not the bind.** The wildcard check moved
   from the bind host (`assertPairingBindIsAdvertisable`, removed) to the QR
   endpoint (`assertPairingEndpointIsDialable`, enforced inside
   `createPairingQrPayload`). The endpoint defaults to the best detected
   candidate (`listMobileAccessEndpointCandidates`): private IPv4 on `en*`
   first, other private LAN, VM bridges, then Tailscale (100.64/10). Public,
   link-local and IPv6 addresses are never offered. It is re-read on each
   status/mint, so a Wi-Fi change shows up in the next QR. The operator can
   pin a candidate or a custom `ws://`/`wss://` URL.
3. **On by default, remembered.** `~/.piwin/devices/mobile-access.json`
   (`MobileAccessSettingsFileStore`) holds `enabled` (default `true`), the last
   bound `port`, and an optional address override. The CLI sidecar calls
   `resume()` at start (not in `--mock`), so paired phones reconnect without
   the operator opening settings. `stop` persists `enabled: false`; app quit
   does not. A corrupt file is reported and treated as off.
4. **Own port, stable across restarts.** Default 8790 (not the standalone
   Host's 8787: on macOS a wildcard bind silently coexists with a dev Host on
   `127.0.0.1:8787`). A busy port walks upward up to 10 ports
   (`startWithPortFallback`); the bound port is persisted and preferred next
   time, so the endpoint saved on the phone stays valid.
5. **Desktop shows a real QR.** `@piwin/ui-kit` gains `QrCode` (encoder: `uqr`,
   MIT, zero deps; always dark-on-white for scanners). The local panel mints a
   code automatically while listening and re-mints when the address changes,
   the code expires, or a device pairs (codes are single use). The panel polls
   status every 4 s while open.
6. **Standalone Host** keeps pairing on by default (`PIWIN_HOST_PAIRING=0`
   disables) and prints a startup QR only when its advertised URL is dialable.

## Consequences

- Phones on the same Wi-Fi or tailnet connect by scanning; nothing to configure.
- The LAN listener speaks cleartext `ws://`. A device credential sent on an
  untrusted network can be observed and replayed. The UI says so; Tailscale
  (encrypted) is the recommended path off the home network. TLS for the LAN
  listener is future work.
- The hybrid spec's refusal of wildcard binds and automatic LAN selection is
  superseded for the bundled app by this ADR.
- The Desktop localStorage key `piwin.desktop.mobile-access.advertisedEndpoint`
  is no longer read; the sidecar settings file is the single authority.

## Addendum 2026-09-26 — anonymous admission behind proxies

Reviewing public deployment exposed two admission holes, both fixed:

- **Loopback bind ≠ local client.** Anonymous hello was allowed whenever the
  Host *bound* loopback. A reverse proxy on the same machine also connects
  from 127.0.0.1, so a public `wss://` in front of a token-less Host admitted
  anyone as operator. Now it is per connection (`isDirectLoopbackRequest`):
  loopback peer **and** no proxy headers. `apps/host` additionally refuses to
  start when `PIWIN_HOST_ADVERTISED_URL` is non-loopback and
  `PIWIN_HOST_TOKEN` is unset, covering TCP forwarders that add no headers.
- **Keyless fall-through.** `authenticateHostHello` returned success for a
  keyless hello when anonymous was disallowed but no token or pairing was
  configured — reachable once `host/pairing-set-enabled` turned pairing off on
  an exposed bind. A keyless hello is now always rejected unless anonymous
  admission applies.
