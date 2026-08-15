# Native Tauri Smoke

Status: bounded build/unit evidence only; native product smoke not run.

## Completed

- `pnpm --filter @piwin/desktop build` — PASS.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` — PASS.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` — PASS, 17 tests.

## Not claimed

No Tauri window was driven through a real Provider, no long Run was replaced
or queued across a reconnect, and no second CLI/Desktop client was attached to
the same live Host. Browser mock failures are recorded in `bug-register.md` and
do not count as native evidence.

Native evidence must record the actual backend, isolation capability, transport, provider readiness, session/run identifiers, and observation timestamps. Browser mock results do not belong in this file.
