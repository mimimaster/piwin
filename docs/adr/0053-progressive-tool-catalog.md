# ADR 0053: Progressive tool catalog

| Field | Value |
| ----- | ----- |
| Status | Accepted |
| Date | 2026-08-17 |
| Related | ADR 0014, ADR 0033, ADR 0044 |
| Plan | [`../plans/2026-08-17-progressive-tool-catalog.md`](../plans/2026-08-17-progressive-tool-catalog.md) |

## Context

The model-visible tool surface had two low-frequency shells:

- `piwin_toolbox` — Host process/notes/flashcards/image/video, `describe`/`call`, target enum, no search
- `mcp_gateway` — MCP only, `search`/`describe`/`call`/`status`

Gateway-first exposure (ADR 0014 / 0033) still holds: adding MCP servers must not dump every schema into `tools[]`. The failure was the *ritual*: two wrappers, MCP search without inline schemas, and a Host enum that could not name MCP selectors. Prompt Cache still requires a stable `tools` prefix per generation. Pi does not expose Anthropic `defer_loading` or Kimi-style mid-turn tool injection.

## Decision

One client-side catalog shell: keep the name `piwin_toolbox`.

1. **Model-visible actions** are `search | describe | call | status`. `target` is a string, not an enum. Host ids have no `.`; MCP selectors do (`server.tool`).
2. **`mcp_gateway` is not a model-visible tool.** Its executor (lazy discovery, cache search, describe, call, status) moves into `packages/host-runtime/src/tool-catalog/`. Pinned `mcp__server__tool` entries stay first-class.
3. **Search** merges frozen Host toolbox targets with the live MCP Supervisor catalog, ranks exact > prefix > keyword hits, inlines compacted schemas for top K (K=3, drop to 1 under a 12k-character budget), and returns exact ids so the next step can be `call`.
4. **Admission is unchanged.** Host `call` uses the target registration's `permissionSpec`. MCP `call` stays trusted (ADR 0033). `search`/`describe`/`status` do not admit the target.
5. **Conversation sessions keep `mcp: false`.** The catalog WeakMap may exist from composition; `SessionHostToolExecutionPort.restrictGeneration(..., mcpCatalogEnabled)` is the gate, taken from compiled `enabledFamilies`.
6. **MCP family without a dedicated MCP tool.** After dropping `mcp_gateway`, a generation with toolbox + `mcp: true` still enables the `mcp` family so Agent sessions can search unpinned tools even with zero pins and zero enabled servers.
7. **Presentation.** `AgentEvent.toolName` remains `piwin_toolbox`. `call` unwraps to `routedToolName`. Catalog `search`/`describe`/`status` render as discovery. Historical `mcp_gateway` events keep their fallback.

This is article route 3 (client search + invoke). Routes 1 and 4 stay future delivery adapters over the same catalog service.

## Consequences

- Resident `tools[]` loses one descriptor (`mcp_gateway`) and replaces the Host target enum with a bounded description. Discovery often drops from three hops to two.
- Host targets stay generation-frozen; MCP execution stays Supervisor-live (ADR 0033).
- Typo protection moves from JSON Schema enum to Host validation, nearest-id errors, and search returning exact ids.
- Settings copy and MCP briefs refer to `piwin_toolbox`, not `mcp_gateway`.

## Supersedes

- ADR 0014 §3 “one stable `mcp_gateway` tool” as a **model-visible** surface. Gateway-first, lazy-connect, and metadata cache remain.
- ADR 0033 §7 default “always expose `mcp_gateway`”. Catalog-first through `piwin_toolbox` is the default; pinned direct tools are unchanged.
- ADR 0044’s describe/call-only Host toolbox. Search/status and MCP ids share that shell; high-frequency Host tools stay direct.
