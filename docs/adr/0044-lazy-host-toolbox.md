# ADR 0044: Lazy Host toolbox for low-frequency tools

## Status

Accepted (2026-08-11) · browser family moved to direct 2026-08-23

## Context

A fresh Agent generation paid for every Host tool's full description and JSON
Schema even when most turns only needed filesystem, shell, search, or MCP.
Browser, process, notes, flashcards, image, and video definitions formed a
large static prompt tax. Simply hiding them behind a dispatcher would be unsafe
if the dispatcher called executors without the original generation and
permission admission.

## Decision

Keep these high-frequency families direct: filesystem, shell, web, browser,
planning, delegation, Artifact instructions, and explicitly pinned MCP tools.
The Browser workbench is a first-class Agent surface (ADR 0020 / 0057): models
must be able to call `browser_*` without a catalog round-trip, and Desktop
opens the right sidebar when the agent acquires the page.

Expose low-frequency process, notes, flashcards, image-generation, and
video-generation tools through one `piwin_toolbox` descriptor. Unpinned MCP
tools share that same shell ([ADR 0053](./0053-progressive-tool-catalog.md)):

- `search(query)` returns ranked Host and MCP ids, with compacted schemas for
  top matches;
- `describe(target)` returns that target's exact descriptor on demand;
- `call(target, arguments)` routes Host ids through the target's original
  `HostToolRegistration` in `SessionHostToolExecutionPort`, and MCP selectors
  through the catalog service / Supervisor;
- `status` reports MCP server health;
- conversation sessions keep MCP closed (`mcp: false`) even when the toolbox exists;
- Host `call` still uses the target registration's immediate safety predicate,
  permission declaration, subject builder, cancellation signal, and generation/run checks;
- the compiler freezes an exact Host target-name allowlist from enabled families;
- the toolbox descriptor and execution allowlist are projected from that same
  set, so trust and subagent ceilings cannot be widened by the routing shell;
- hidden targets are never directly callable through the public session port.

The toolbox registration's fallback executor fails closed. Production
`describe` and `call` handling belongs to the session execution port because
that is the boundary holding the frozen permission gate and generation surface.

## Consequences

- Fresh generations pay for one bounded catalog rather than every low-frequency
  schema.
- Low-frequency Host calls can skip search when the id is listed in the
  toolbox description; MCP and unknown ids should search first.
- Tool pinning remains meaningful because pinned MCP tools are not moved behind
  the toolbox.
- Adding a new toolbox family requires updating the explicit family set and
  tests; name-pattern inference is forbidden.

## Acceptance criteria

- direct and toolbox-only names are disjoint per generation;
- an uncompiled target returns `tool-not-available`;
- describe causes no target permission admission;
- call admits the original target registration, not the toolbox shell;
- SDK and RPC use the same compiled descriptor and Host execution port.

## Client presentation status (2026-08-13)

Desktop consumes `ToolPresentation.routedToolName` and renders routed calls with
the target tool's card (see the activity presentation spec §6.5). The CLI is an
intentional degradation for now: it prints the wrapper name
(`[tool:piwin_toolbox]`) without resolving the routed target. Routing,
permission admission, and execution behave identically in both shells; only the
CLI label is degraded. Revisit when the CLI activity renderer consumes
`ToolPresentation`.
