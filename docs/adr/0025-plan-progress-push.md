# ADR 0025: SessionPlan progress push (PlanCard, not SessionTodo)

## Status

Accepted (2026-08-03)

## Context

Desktop already renders plan progress as `N / M tasks done` on `PlanCard`
(`apps/desktop/src/plan-card.tsx`), driven by `SessionPlan` and the host push
`plan/updated`.

Model-facing tools already exist in SDK mode:

- `piwin_plan_create` — draft plan → plan.json
- `piwin_plan_set_step` — step status → plan.json

Both tools accept an optional `onUpdated` callback. Production wiring in
`PiSdkAdapter` did **not** pass that callback, so:

1. Tools wrote plan.json successfully.
2. Desktop never received `plan/updated` from those tool calls.
3. PlanCard stayed at `0 / N` until some other IPC path pushed the plan.

Separately, contracts expose a lighter `SessionTodo` store (`todo/get|set`)
for CE-TODO-01, but the model tool and Execution panel are deferred
(`docs/todo-deferred.md`). Building a second Cursor-style todo list would
duplicate PlanCard and increase product weight.

## Decision

### 1. Single progress UI for plans: SessionPlan + PlanCard

- Progress shown as `doneCount / totalCount` comes **only** from `SessionPlan.steps`.
- Do **not** wire SessionTodo into PlanCard.
- CE-TODO (ad-hoc session checklist) remains deferred until product needs a
  non-plan checklist; it must not replace SessionPlan.

### 2. Minimal fix: tool → HostRuntime → `plan/updated`

Wire `onPlanUpdated` through:

```text
HostRuntime
  → createAgentHost({ onPlanUpdated })
  → PiSdkAdapter / RPC-SDK-fallback options
  → createPlanCreateTool / createPlanStepTool({ onUpdated })
  → this.push({ type: 'plan/updated', sessionId, plan })
  → Desktop plansBySessionId[sessionId] → composer-adjacent plan todo tray
    (Claude Code placement: above the input, not the transcript top)
```

Scope of this ADR:

| In scope | Out of scope |
|----------|----------------|
| `onPlanUpdated` push after plan tools | SessionTodo tool + panel |
| Keep existing PlanCard UI | Subagent plan step orchestration |
| SDK + rpc-with-SDK-fallback tool path | Walkthrough content generation |

### 3. Weight rule

Prefer one thin seam over a new subsystem. Restore the same SessionPlan with
`plan/get` on session open rather than inventing parallel todo state.

### 4. Execution choice stays visible and opens the plan document

- The draft/approved `PlanExecutionGate` is rendered after the creating turn's
  tool sequence and outside the collapsible thinking/work-details container.
- Clicking the card opens the existing right-side document preview with the
  current `SessionPlan` rendered as Markdown at the virtual path
  `plans/<sessionId>.md`; it does not require a Host file read.
- The A/B execution controls stop event propagation, so choosing an execution
  mode never opens the document preview.

## Consequences

- Model `piwin_plan_set_step` updates become live on the composer-adjacent
  plan list without reload. Plan-progress tool rows are hidden from the call
  chain; the list mutates in place (Claude Code TodoWrite display).
- Session activation/reconnect hydrates `plan/get`; background pushes remain
  cached under their own session and never replace the active PlanCard.
- Draft Process carries `expectedRevision + approveDraft` so Host atomically
  approves and starts execution without a client-side approval race.
- The execution decision is no longer hidden by a collapsed thinking section,
  and the same plan can be inspected in the right-side document preview before
  choosing how to run it.
- Stock pure RPC (no custom tools) still cannot run plan tools (ADR 0008);
  progress there remains IPC `plan/*` only.
- Subagent-driven execution is intentionally not part of this decision; when
  subagents stabilize, re-evaluate host-side step completion separately.

## Alternatives considered

1. **Implement CE-TODO `todo_write` + panel first** — Rejected: UI already is
   PlanCard; second checklist confuses users and doubles state.
2. **Poll plan.json from Desktop** — Rejected: we already have push transport;
   polling adds lag and complexity.
3. **Full plan execution redesign** — Rejected for this change; too heavy.

## References

- `packages/agent-host/src/plan-step-tool.ts`
- `packages/agent-host/src/plan-create-tool.ts`
- `packages/agent-host/src/sdk-adapter.ts` (`onPlanUpdated`)
- `packages/agent-host/src/host-runtime.ts`
- `apps/desktop/src/plan-card.tsx`
- `docs/todo-deferred.md` CE-TODO-01
