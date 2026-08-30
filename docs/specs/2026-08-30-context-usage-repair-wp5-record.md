# WP5 verification record — context-usage repair

Date: 2026-08-31  
Worktree: `/Users/yorickjue/Developer/piwin/.worktrees/context-usage-repair`  
Branch: `feat/context-usage-repair`

## Commands run

### Host + desktop occupancy (after `contextTelemetryVersion: 1`)

```
pnpm --filter @piwin/host-runtime exec vitest run \
  src/commands/session-context-get.test.ts \
  src/session-context-coordinator.host.test.ts
# 5 passed

pnpm --filter @piwin/desktop exec vitest run \
  src/host-client-mock-context.test.ts \
  src/context-usage-ring.test.tsx \
  src/context-telemetry-selector.test.ts
# 23 passed

pnpm --filter @piwin/host-runtime exec tsc -p tsconfig.json --noEmit
pnpm --filter @piwin/desktop exec tsc -b --pretty false
# exit 0
```

### Playwright

```
pnpm --dir apps/desktop exec playwright test e2e/context-usage.spec.ts
# 2 passed (7.4s)
# empty shell / typed-not-sent hide the ring
# mock assistant reply shows the ring; New hides it again
```

## Not run this pass

- Full `pnpm test`
- Real provider smoke
- Two live clients on one Host (T22)
- UI 500ms timing with a delayed local provider (T28)

## Known baseline failures (not this branch’s occupancy work)

- Host Plan-mode: `completes Plan mode only after a new durable SessionPlan revision exists`
- Mobile suite: 5 failures (`splitMarkdownBlocks`, flashcard payload, artifact iframe HTML) recorded in WP4

## Capability

`HostStatusData.capabilities.contextTelemetryVersion = 1` in `host-runtime-status.ts`. In-browser mock Host advertises the same flag so Desktop e2e can see the ring.
