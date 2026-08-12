# ADR 0044: Lazy Host toolbox for low-frequency tools

## Status

Accepted (2026-08-11)

## Context

A fresh Agent generation paid for every Host tool's full description and JSON
Schema even when most turns only needed filesystem, shell, search, or MCP.
Browser, process, notes, flashcards, image, and video definitions formed a
large static prompt tax. Simply hiding them behind a dispatcher would be unsafe
if the dispatcher called executors without the original generation and
permission admission.

## Decision

Keep these high-frequency families direct: filesystem, shell, web, MCP,
planning, delegation, and Artifact instructions. Explicitly pinned MCP tools
also remain direct.

Expose low-frequency process, browser, notes, flashcards, image-generation, and
video-generation tools through one `piwin_toolbox` descriptor:

- `describe(target)` returns that target's exact descriptor on demand;
- `call(target, arguments)` routes through the target's original
  `HostToolRegistration` in `SessionHostToolExecutionPort`;
- the target therefore receives its own immediate safety predicate, permission
  declaration, subject builder, cancellation signal, and generation/run checks;
- the compiler freezes an exact target-name allowlist from enabled families;
- the toolbox descriptor and execution allowlist are projected from that same
  set, so trust and subagent ceilings cannot be widened by the routing shell;
- hidden targets are never directly callable through the public session port.

The toolbox registration's fallback executor fails closed. Production
`describe` and `call` handling belongs to the session execution port because
that is the boundary holding the frozen permission gate and generation surface.

## Consequences

- Fresh generations pay for one bounded catalog rather than every low-frequency
  schema.
- Low-frequency calls add a describe step, but retain exact admission behavior.
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
