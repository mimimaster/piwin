# Desktop renderer bounds implementation record

| Field | Value |
|-------|-------|
| Date | 2026-08-09 |
| Scope | Desktop renderer retention, dynamic transcript projection, and pet overlay entry isolation |
| Plan | [`../plans/2026-08-08-host-egress-flow-control-execution-plan.md`](../plans/2026-08-08-host-egress-flow-control-execution-plan.md) Tasks 9–10 |
| Decision | [`../adr/0038-host-egress-flow-control-and-recovery.md`](../adr/0038-host-egress-flow-control-and-recovery.md) |

## Landed architecture

- The pet overlay has its own HTML/React/CSS entry. Rust opens
  `pet-overlay.html`; the overlay no longer starts the main Desktop composition
  root and then branches by window label.
- Collapsed thinking and completed historical tool detail are not retained in
  the DOM.
- Visible tool output uses one incremental redacted UTF-8 accumulator capped
  at 256 KiB. Canonical card output and structured presentation project the
  same capped string, avoiding a hidden second 10 MiB copy.
- Streaming code fences do not launch Shiki. Static/terminal Markdown retains
  highlighting.
- Messages are grouped into stable turn units. At more than 40 turns, one
  dynamic-height virtualizer mounts the viewport plus four-turn overscan.
- TranscriptViewport, follow-tail, History Ticks, and virtualization share one
  scroll port. History jumps use message-to-turn indexes and mount before
  highlighting.
- Scroll offset and measured turn height use bounded 20-session presentation
  caches, with at most 2,000 measured turns per session; deletion clears both.
- A focused historical editor is pinned into the virtual range so tail updates
  cannot unmount its draft or keyboard focus.

## Automated evidence

- A 500-turn fixture mounts fewer than 20 turn rows and jumps to initially
  unmounted first, middle, and last turns.
- Follow-tail tracks a growing transcript; after scroll-away, the same offset
  survives 100 updates and the jump control remains available.
- A late height change from 120 px to 520 px triggers virtual-window
  remeasurement through `ResizeObserver`.
- Many-small-delta and 10 MiB tool fixtures remain within the exact 256 KiB
  visible cap, including `ToolPresentation.output.text` and hydrated history.
- Pet bundle output is 13,993 bytes JS and 4,067 bytes CSS plus a 224,577-byte
  shared leaf chunk. Its HTML does not reference the 3,012,490-byte main JS or
  621,776-byte main CSS assets.

## Native development spot sample — not Gate A

After the separate overlay entry was loaded in the current development run,
`footprint` reported two piwin WebContent processes at approximately 393 MB and
44 MB. The smaller overlay process was previously approximately 131 MB when it
booted the main Desktop entry. The main process had already accumulated HMR and
long-session history, so this is directional evidence only; it is not a clean
baseline or a release gate.

No 30-minute clean-start native matrix was run in this slice. Gate A therefore
remains open and no claim is made that the original incident is fully closed.
The required rerun must record memory slope, Tauri batch evaluation count,
queue/cursor metrics, Stop latency, and absence of WebKit termination.

## Verification commands

```text
pnpm --dir apps/desktop test -- bounded-text-accumulator chat-reducer
pnpm --dir apps/desktop test -- pet-overlay-entry turn-tool-group chat-thread MarkdownView
pnpm --dir apps/desktop test -- transcript-scroll-memory transcript-turn-list transcript-viewport
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop build
pnpm typecheck
pnpm test:architecture
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Targeted tests, workspace typecheck, package-boundary checks, the production
Vite build, Rust formatting/compilation, and all 14 Rust tests passed. The full
Desktop Vitest run passed 145 test files / 919 tests and stopped only on the
three pre-existing failures in the user's untracked
`resolve-document-content*` work (one test file); no renderer-bound test failed.
The final focused renderer run passed 10 test files / 141 tests.
The existing Rust `pending_request_count` dead-code warning remains unrelated.

## Still pending

- Gate A 30-minute clean native containment evidence.
- Native/Playwright checks for permission reachability and scroll anchoring
  during thinking/tool expansion and theme/font changes.
- Stage 2 authenticated loopback Desktop composition and forced renderer
  reload/replay/hydration evidence.
