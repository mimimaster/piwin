# MCP 可见性模型

| Field | Value |
|---|---|
| Status | Accepted (product owner, 2026-09-07) |
| Surfaces | Settings MCP list/editor; Conversation tool cards (P1) |

## Model

```text
McpVisibilityModel
├── ServerSummary          # list collapsed
├── ServerDetail           # list expanded / editor header
├── ToolCatalogEntry[]     # capability sheet (settings)
└── ToolInvocationRecord   # one live call (transcript, P1)
```

**Catalog ≠ invocation.** Catalog answers “what can this server do?”. Invocation answers “what did the agent call and what came back?”.

## P0 shipped (settings)

- Configured server cards expand in place.
- Detail shows runtime health (status / pid / startedAt / lastError), launch command, env **keys only**, and a tool catalog.
- Each tool row expands to full description + `inputSchema` parameter table (+ raw JSON).
- Live tools come from `mcp/list_tools`; editor reuses the same catalog row.

## P1 shipped (transcript)

- Collapsed and expanded MCP rows keep `server / tool` identity in the header preview (kind chip stays `MCP`).
- Expanded body shows bounded-but-large args (`inputPreview`, up to 32k for MCP) and result text.
- UI hydrate/resume preserves MCP `output` and `presentation.output` (same preserve path as flashcards).

## Constraints

- MCP remains outside the permission layer (ADR 0033).
- Do not dump full schemas into the model tool list (ADR 0053).
- Never render env secret values in UI.
