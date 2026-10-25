# piwin Product Status

| Field | Value |
|-------|-------|
| Updated | 2026-10-24 |
| Backlog | [`todo-deferred.md`](./todo-deferred.md) |
| Depth program | [`specs/product-depth-competitive-alignment.md`](./specs/product-depth-competitive-alignment.md) |
| Optimization program | [`specs/product-optimization-program.md`](./specs/product-optimization-program.md) **Active** |
| Runtime program | [`specs/runtime-refactor.md`](./specs/runtime-refactor.md) **Ready, ordered Phases 1-3** |

Legend: **green** usable · **yellow** partial / honest degrade · **red** not shipped

## Main path

| Surface | Status | Notes |
|---------|--------|-------|
| Open workspace + trust | green | Tauri picker + path dialog |
| Chat stream (mock/SDK) | green | Product transcript resume |
| Desktop renderer bounds | green (automated) / native evidence pending | Bounded Host batches, 256 KiB visible tool output, 500-turn virtualization, and a separate pet overlay entry; 30-minute Gate A remains open |
| Session runtime residency (ADR 0040) | green (core) / soak evidence pending | Host-owned cold/activate/suspend; TTL/LRU/memory budgets; Desktop settings + CLI doctor/status aggregate metrics; SQLite transcript store landed with legacy fallback |
| Session rename/archive/delete/duplicate | green | PD-SESS archive-first |
| Session cold storage (ADR 0044) | green (manual R1) | Archive first, then pack / plan+confirm offload / restore; Desktop restore-first; doctor + reconcile; no schedule or force-replace |
| Pin + search | green | Pinned group in sidebar |
| Project rail density | green | Project section folds; recent projects are capped in the rail with a searchable all-project picker |
| Skills / MCP panels | green | stdio + remote (Streamable HTTP / SSE, header auth) lifecycle; remote OAuth via `npx mcp-remote` |
| Permissions | green | Host-owned policy |
| Media prompt routing | green/transitioning | Native vision uses ImageContent; path text is explicit text-only fallback only |
| Markdown + KaTeX/Mermaid | green | Soft-fail fences |
| Artifact HTML | green | Sandbox iframe |
| Git status/commit | green | No force-push |
| Composer branch chip | green | Local branches list + checkout confirm; project sessions only |
| Context menus (CM-*) | green | **P0 + P1 shipped 2026-08-10** — right-click file tree / path chip / code selection → Add to Chat / Ask / Explain / Fix; message / code block / diff / tool card / terminal selection / error menus; Apply (confirm + `project/write-file`); More… submenu; `@` mention → refs; CLI `--ref` parity; composer context-ref chips + `PromptInput.contextRefs`; drag-to-ref |
| Memory / process tools | green | Feature-flagged config |
| Shell dock | yellow→green on Tauri | **Tauri PTY + xterm** when running desktop; Node shell preview is removed by Runtime Refactor Phase 1 |
| Runtime target chip (Local / Remote Host) | yellow→green | Shows the attached Host when Desktop is connected to a remote Host (Settings → Host target); per-session target switching (D-CTX-01b) still open |
| RPC isolation | yellow | SDK fallback is transitional; Runtime Refactor Phase 3 requires one isolated worker per runtime generation |
| Hooks / cron | yellow | Thin post-event; cron needs host up |
| Interactive PTY (xterm) | green (Tauri) | portable-pty + xterm; no second Node shell-preview architecture in the target state |
| Host Server / multi-client | yellow (in tree) | `@piwin/host-server` + `apps/host`: WebSocket transport, device pairing (ADR 0075), LAN phone access (ADR 0076), origin/exposure guards. Desktop can attach to a standalone Host; Mobile (ADR 0084) and CLI TUI (ADR 0086) use the remote protocol. Owner to confirm release status |
| Remote relay (ADR 0101) | yellow (in tree) | Self-hosted content-blind relay (`apps/gateway`, Docker); Noise IK channel per device; Host relay connector + direct channel route; pairing via v3 code / link / `#pair=` on phone, Desktop thin shell, browser, CLI/TUI (`piwin pair`, `piwin hosts`, `PIWIN_HOST`); Desktop settings Remote access; automatic legacy migration. Not run on a real phone or a packaged Desktop build yet; release cadence for `legacyAccess` not started |
| Flashcard study workbench (ADR 0066) | yellow | **In tree, not released.** Desktop page, Mobile catalog+study, CLI `piwin study`, Host rounds/operations, unique CardStore, existing tear-off. Real-device V04/V09/V22 **not run**; visual fixtures **not captured**; root `pnpm typecheck` is green again (2026-10-24). Mobile source is excerpt-only; v1 online-only; CLI has no animation. Do not claim dual-device video or 已上线. |

## Architecture health

| Area | Status |
|------|--------|
| Package boundary (apps ↛ Pi) | green |
| App shell modularity | green | App ~800 lines orchestration + hooks/components |
| host-client mock isolation | green | `host-client-mock.ts` |
| HostRuntime modularity | transition | target extraction to `@piwin/host-runtime`; `@piwin/agent-host` narrows to the Pi boundary |
| Desktop installer (ADR 0017) | yellow | Bundles the Host sidecar and a pinned Node (`pnpm package:desktop`); macOS DMG is signed and notarized, Windows NSIS via `pnpm release:desktop`. Clean-machine smoke (S5) still pending, so do not call it public-ready yet |
| Host deployment | yellow | Local sidecar plus standalone Host (`apps/host`, `pnpm package:host`) with paired remote clients (ADR 0036/0075), reachable through a self-hosted relay (ADR 0101) |
| ui-kit primitives | green | Menu/Popover/Confirm/Notice/Status/Tabs/Field + Button/Dialog |
| Lint / CI gates | green | Real ESLint (typed no-floating-promises, hooks rules, no empty catch); CI runs lint, typecheck incl. mobile, tests, boundaries, host smoke, plus macOS (cargo test, desktop e2e) and Windows (credential store) jobs |
| Desktop UI modernization | green | Shell IA + run strip + palette + confirms + CSS split + viewport e2e + visual baselines (darwin) |

## Product Optimization focus (PO-*)

| Priority | Focus | Status |
|----------|-------|--------|
| P0 | Permission remember manager | **green** |
| P0 | Empty/Loading panel adoption | yellow→green (main panels) |
| P0 | Bundled skills thin pack (≥6) | **green** (11 skills) |
| P0 | Docs/backlog truth | **green** |
| P1 | Automation honesty · sub-agent labels · hubs | yellow→improved |
| P2 | Tauri PTY spike-gated | **green code path** — dual-mode TerminalDock |

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:cold-storage
pnpm e2e:desktop
```
