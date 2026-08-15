# Command Results

| Time (UTC) | Command | Exit | Layer | Result |
|---|---|---:|---|---|
| 2026-08-15T10:30Z | `pnpm typecheck` | 0 | static/workspace | PASS |
| 2026-08-15T10:30Z | `pnpm test:architecture` | 0 | architecture | PASS |
| 2026-08-15T10:30Z | `pnpm format:check` | 2 | repository formatting | PRE-EXISTING FAIL |
| 2026-08-15T10:31Z | `pnpm test` (restricted loopback) | 1 | unit/integration | ENVIRONMENT FAIL at Agent Host loopback test |
| 2026-08-15T10:34Z | focused `pi-model-runtime.test.ts` | 0 | Agent Host | PASS 12/12 with loopback available |
| 2026-08-15T10:34Z | `pnpm e2e:smoke` | 0 | HostRuntime mock | PASS |
| 2026-08-15T10:34Z | `pnpm e2e:host-jsonl` | 0 | live JSONL sidecar | PASS, 49 assertions |
| 2026-08-15T10:34Z | `pnpm test` (loopback available) | 1 | full workspace | PRE-EXISTING Desktop failure |
| 2026-08-15T10:40Z | focused `steer-queue.test.tsx` | 1 | Desktop unit | Stable pre-existing copy mismatch |

## Stage 4 execution results

| Time (UTC) | Command | Exit | Layer | Result |
|---|---|---:|---|---|
| 2026-08-15T12:08Z | `pnpm typecheck` | 0 | workspace | PASS; all 30 projects |
| 2026-08-15T12:08Z | `pnpm test` | 0 | full workspace | PASS; includes Desktop 207 files / 1,374 tests |
| 2026-08-15T12:09Z | `pnpm test:architecture` | 0 | architecture | PASS; Package boundaries OK |
| 2026-08-15T12:09Z | `pnpm e2e:smoke` | 0 | HostRuntime mock | PASS |
| 2026-08-15T12:09Z | `pnpm e2e:host-jsonl` | 0 | live JSONL sidecar | PASS; 49 assertions |
| 2026-08-15T12:10Z | `pnpm --filter @piwin/desktop build` | 0 | Desktop production build | PASS; Vite emitted only chunk-size warnings |
| 2026-08-15T12:10Z | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | native Rust | PASS; one existing dead-code warning |
| 2026-08-15T12:10Z | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 0 | native Rust | PASS; 17 tests |
| 2026-08-15T12:11Z | `pnpm format:check` | 2 | repository formatting | PRE-EXISTING; two invalid HTML prototype files plus broad drift |
| 2026-08-15T12:12Z | `pnpm e2e:desktop` | 124 | browser E2E | TIMEOUT at 300s; selector/snapshot drift recorded as BASE-003 |
| 2026-08-15T12:13Z | focused `ink-theme.spec.ts` | 1 | browser E2E | missing `primitive-gallery` and screenshot mismatch |
| 2026-08-15T12:14Z | focused shell smoke | 1 | browser E2E | missing `sessions-empty` selector |
| 2026-08-15T12:15Z | `git diff --check` | 0 | diff hygiene | PASS |

## Notes

- `pnpm format:check` fails on broad historic drift and two invalid HTML prototypes. It is not evidence of a Stage 4 regression.
- The full suite reached Desktop after Agent Host passed 248/248, then stopped at one stale `SteerQueue` copy assertion; packages ordered after Desktop were not exercised by that command.
- First-failure evidence is retained even when a focused rerun later passes.

## Interpretation

- The current full `pnpm test` is green after the Stage 4 fixes; the earlier baseline failure remains documented rather than erased.
- Browser E2E is not a Stage 4 green gate: it timed out with existing shell/theme selector and snapshot failures before the queue-specific surface was exercised.
- Native build and Rust unit tests pass, but no real-provider Native Tauri long-session or two-client restart observation was performed.
