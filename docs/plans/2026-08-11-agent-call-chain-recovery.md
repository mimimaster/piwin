# Agent call-chain recovery plan

| Field | Value |
|---|---|
| Date | 2026-08-11 |
| Scope | Desktop transcript paging, run presentation, and bounded rendering |
| Architecture | ADR 0038 and ADR 0040 remain authoritative |

## Observed failures

1. A transcript cursor created with the former 16-message page size is reused
   after the Desktop default changes to 50. The cursor embeds its original
   limits, so the Host throws `Session transcript cursor limits do not match
   the query` instead of allowing the existing one-restart recovery path.
2. Pi emits multiple Assistant lifecycle messages during one Run. Intermediate
   `toolUse` messages can contain short progress narration. Desktop aggregates
   their tools and thinking, but still renders every narration segment as a
   separate answer body, producing a repeated, disconnected call chain.
3. The in-progress layout patch adds `margin-top: auto` to the message column,
   pushing short transcripts toward the composer and exposing a large backdrop
   gap. It also disables transcript virtualization globally, violating the
   bounded-renderer invariant added for long histories.

## Recovery design

### Cursor compatibility

- Treat a decoded cursor whose limits differ from the request as a stale
  cursor, not an action failure.
- Reuse the existing Desktop policy: restart once at the newest page without a
  cursor, then continue with the new page limits.
- Apply the same semantics in the pure pager, SQLite transcript store, and
  Desktop mock so local, remote, and test paths agree.

### One visible response per Run

- Group Assistant lifecycle messages by `runId` inside each user turn.
- Select the last user-visible lifecycle message as the response owner, falling
  back to the last lifecycle message while a tool-only segment is active.
- Aggregate thinking, tools, attachments, and search evidence onto that owner.
- Render only the owner row for the grouped Run. Intermediate progress text
  remains durable but does not masquerade as multiple final answers.
- Keep an active tool chain expanded. Collapse only completed historical tool
  groups according to the existing density policy.

### Bounded, stable layout

- Remove bottom-pushing `margin-top: auto`; transcript content starts below the
  title chrome in normal document flow.
- Keep the full document-flow path while a Run is streaming.
- Re-enable dynamic-height virtualization only for completed histories above
  the existing 40-turn threshold, using bounded content-aware estimates and
  fresh measurements.

## Verification

- Cursor-limit mismatch fixtures for pure session paging, SQLite paging, mock
  paging, and Desktop one-restart behavior.
- Transcript projection fixtures for repeated tool-use narration, aggregated
  tools/attachments/evidence, final response ownership, and active history
  expansion.
- Virtualization policy and bounded mounted-row coverage, plus streaming
  document-flow coverage.
- `pnpm typecheck`, touched package tests, architecture check, and Desktop
  production build.

## Verification result

- Passed: contracts/session/desktop call-chain tests (50 cases), Host Runtime
  transcript paging integration (2 cases), Host Server command tests (7 cases),
  package-boundary check, touched package typechecks, and Desktop production
  build.
- Full `pnpm typecheck` remains blocked by the pre-existing, untouched
  `packages/pet/src/validate-manifest.ts:114` exact-optional-property error.
- Full `pnpm test` reaches Desktop and retains five pre-existing failures in
  `renderer-resource-boundaries.test.ts` (1) and
  `resolve-document-content.test.ts` (4). All call-chain recovery tests pass.

## Follow-up: invisible history continuation

- Remove the visible “load earlier messages” / history-window-limit strip from
  the transcript so it no longer consumes the first row of the conversation.
- Keep Host paging and the bounded history cache unchanged.
- Load older pages automatically near the top. A page shorter than the viewport
  is also treated as being at the top so removing the button does not make older
  history unreachable.
- Preserve the visible scroll anchor after prepending an older page.
