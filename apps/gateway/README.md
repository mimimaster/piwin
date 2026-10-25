# piwin gateway (relay)

Self-hosted, content-blind relay for ADR 0101 remote access. Hosts and remote
shells both dial out to it; it authenticates Hosts, assigns peer ids and
forwards end-to-end encrypted frames. It never imports Pi, never parses Host
commands and holds no traffic key (AGENTS.md §1.13). It depends only on
`@piwin/contracts` and `@piwin/host-transport`
(`scripts/check-package-boundaries.mjs` enforces this).

Operator guide: [docs/guides/remote-relay.md](../../docs/guides/remote-relay.md).

```bash
pnpm --filter @piwin/gateway dev            # tsx src/main.ts serve
pnpm --filter @piwin/gateway bundle         # dist/piwin-gateway.mjs
docker build -f apps/gateway/Dockerfile -t piwin-gateway .
```

| Module | Responsibility |
|--------|----------------|
| `relay-user-registry.ts` | `users.json` schema and in-memory registry |
| `relay-registry-store.ts` / `relay-registry-watch.ts` | atomic load/save, hot reload |
| `relay-host-session.ts` | challenge, double signature, enrollment, Host frame routing |
| `relay-peer-session.ts` | client admission (ambiguous 4404), peer-id stamping |
| `relay-rooms.ts` | `(userId, hostId)` → Host socket and peers |
| `relay-limits.ts` | defaults, per-user limits, per-IP rate limit |
| `relay-server.ts` | HTTP, upgrade routing, ping, registry reconcile |
| `relay-static.ts` | optional browser shell at `/` |
| `relay-admin-cli.ts` / `main.ts` | `user …` / `host …` admin and `serve` |
