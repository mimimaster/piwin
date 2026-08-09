# Host egress Stage 1 implementation record

| Field | Value |
|-------|-------|
| Date | 2026-08-09 |
| Base revision | `3f2e56a` |
| Worktree | Shared, intentionally dirty; unrelated user changes preserved |
| Plan | [`../plans/2026-08-08-host-egress-flow-control-execution-plan.md`](../plans/2026-08-08-host-egress-flow-control-execution-plan.md) |
| Decision | [`../adr/0038-host-egress-flow-control-and-recovery.md`](../adr/0038-host-egress-flow-control-and-recovery.md) |

## Landed in this slice

- Run authority revisions and semantic publication suppression.
- Desktop keyed Run projection/no-op handling.
- Batch/cursor contracts, codec validation, and capability negotiation.
- Exhaustive delivery policy, scoped barriers, bounded Hub/channel/journal.
- Payload-free Hub/channel egress metrics, bounded ingress pending buffers,
  diagnostic eviction, and explicit oversized append/control handling.
- Additive public hydration frame with bounded session/transcript projection,
  client cursor replacement, and post-snapshot replay deduplication fence.
- Configurable HostServer Origin admission with wrong-token/disallowed-Origin
  rejection tests.
- CLI JSONL composition through one Hub; the old lossy stream batcher was
  removed.
- Rust response correlation and main-WebView-only push routing.
- Desktop `host-message-batch` consumption with Host-instance cursor handling.
- Synchronous append-burst draining when a full batch threshold is reached, so
  a legitimate producer does not fill a client queue before its timer fires.

## Verification record

The following passed from the shared worktree for this slice:

```text
pnpm typecheck
pnpm test:architecture
NODE_ENV=test node scripts/e2e-host-jsonl.mjs  # 49 assertions
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml host_bridge::tests
```

Rust formatting and compilation pass; the existing `pending_request_count`
dead-code warning is unrelated to this slice. The latest `pnpm test` rerun is
blocked by three unrelated tests in the user's untracked
`apps/desktop/src/resolve-document-content*` work; Host Transport, Host Server,
Host Client, and the touched Desktop Host tests remain green.

## Explicitly pending

Native Gate A evidence is not claimed: a 30-minute macOS run with memory,
Tauri evaluation, queue, and cursor measurements still needs to be captured.
Stage 2 authenticated loopback `@piwin/host-client` as the Desktop default,
and renderer lifecycle/reload wiring remain a separate rollout and are not
silently marked complete here. Dynamic transcript windowing and renderer
retention bounds landed in the follow-up
[`2026-08-09-desktop-renderer-bounds-implementation.md`](./2026-08-09-desktop-renderer-bounds-implementation.md).
The reusable hydration protocol/server/client slice is implemented and tested.
