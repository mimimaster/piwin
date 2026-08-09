# piwin Product Status

| Field | Value |
|-------|-------|
| Updated | 2026-08-09 |
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
| Pin + search | green | Pinned group in sidebar |
| Project rail density | green | Project section folds; recent projects are capped in the rail with a searchable all-project picker |
| Skills / MCP panels | green | stdio lifecycle |
| Permissions | green | Host-owned policy |
| Media prompt routing | green/transitioning | Native vision uses ImageContent; path text is explicit text-only fallback only |
| Markdown + KaTeX/Mermaid | green | Soft-fail fences |
| Artifact HTML | green | Sandbox iframe |
| Git status/commit | green | No force-push |
| Composer branch chip | green | Local branches list + checkout confirm; project sessions only |
| Memory / process tools | green | Feature-flagged config |
| Shell dock | yellow→green on Tauri | **Tauri PTY + xterm** when running desktop; Node shell preview is removed by Runtime Refactor Phase 1 |
| Runtime target chip (Local / Remote Host) | yellow | **Stub shipped:** 本机 active; 远程 Host grey + tooltip「未连接到远程服务器」; real switch after Host Server multi-client slice (D-CTX-01b) |
| RPC isolation | yellow | SDK fallback is transitional; Runtime Refactor Phase 3 requires one isolated worker per runtime generation |
| Hooks / cron | yellow | Thin post-event; cron needs host up |
| Interactive PTY (xterm) | green (Tauri) | portable-pty + xterm; no second Node shell-preview architecture in the target state |
| Host Server / multi-client | red | Target defined by ADR 0036; Host Server, private transport, auth, replay, and second-client connection are not shipped |
| Personal Gateway / tunnel | red | Optional W4 transport layer after Host Server; ADR 0027 protocol seams retained |

## Architecture health

| Area | Status |
|------|--------|
| Package boundary (apps ↛ Pi) | green |
| App shell modularity | green | App ~800 lines orchestration + hooks/components |
| host-client mock isolation | green | `host-client-mock.ts` |
| HostRuntime modularity | transition | target extraction to `@piwin/host-runtime`; `@piwin/agent-host` narrows to the Pi boundary |
| Host deployment | red | Local sidecar exists; standalone Host Server and multi-client transport are planned by ADR 0036 |
| ui-kit primitives | green | Menu/Popover/Confirm/Notice/Status/Tabs/Field + Button/Dialog |
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
pnpm typecheck
pnpm test
pnpm e2e:desktop
```
