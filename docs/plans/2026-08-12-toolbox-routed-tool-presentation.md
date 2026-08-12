# Toolbox routed-tool presentation normalization

| Field  | Value                                                                              |
| ------ | ---------------------------------------------------------------------------------- |
| Status | Implemented (automated verification complete; manual Desktop smoke pending)        |
| Date   | 2026-08-12                                                                         |
| Scope  | Contracts, agent event normalization, transcript persistence, Desktop presentation |

## 1. Goal

Make a Host tool invoked through `piwin_toolbox` render with the semantics of
its routed target while preserving the actual model invocation for audit and
event correlation.

The immediate acceptance case is:

```text
piwin_toolbox(action=call, target=image_gen, arguments=...)
  -> normalized image presentation
  -> ImageGenerationProgress while running
  -> generated media on success
  -> image-generation failure state on error
```

The design must also cover `video_gen` and future toolbox targets without
adding one UI exception per target.

## 2. Current failure

The Host intentionally exposes low-frequency tools through one lazy model
surface named `piwin_toolbox`. The execution port correctly routes a call to
the requested target, but Pi's lifecycle event still reports the invoked outer
tool name:

```text
AgentEvent.toolName = "piwin_toolbox"
```

Desktop currently recognizes generation calls by exact raw names
`image_gen`/`video_gen`. Consequently a routed image call:

1. is classified as `tool.other`;
2. remains in `TurnToolGroup` as a generic expandable card;
3. exposes the outer arguments JSON in the card;
4. never mounts `ImageGenerationProgress` or its loading animation.

The image progress component and CSS animation are already present. The defect
is loss of routed-tool semantics before presentation, not missing animation
code.

## 3. Design decision

### 3.1 Preserve invocation identity

Do not rewrite `AgentEvent.toolName` from `piwin_toolbox` to `image_gen`.

`toolName` is evidence of what the model/provider actually invoked and is used
with `toolCallId` for lifecycle correlation and transcript audit. Rewriting it
would make the transcript look like the model called a direct tool that was not
on its visible surface.

### 3.2 Add generic routed-target semantics

Extend the public presentation contract:

```ts
export type ToolKind =
  'filesystem' | 'shell' | 'git' | 'web' | 'mcp' | 'process' | 'image' | 'video' | 'other';

export type ToolPresentation = {
  kind: ToolKind;
  title: string;
  routedToolName?: string;
  // existing fields unchanged
};
```

Semantics:

- `AgentEvent.toolName`: outer tool actually invoked by Pi.
- `ToolPresentation.routedToolName`: effective target selected by a routing
  wrapper; absent for direct calls and non-call toolbox actions.
- `ToolPresentation.kind`: semantic family of the effective target.
- `title`, `actionVerb`, `summary`, and `inputPreview`: derived from the
  effective target and its inner arguments, not the outer toolbox envelope.

Example:

```ts
{
  type: 'tool/start',
  toolCallId: 'call-1',
  toolName: 'piwin_toolbox',
  presentation: {
    kind: 'image',
    title: 'image_gen',
    routedToolName: 'image_gen',
    actionVerb: 'Generated image',
    summary: '废土流电影级人像摄影大片…',
    inputPreview: '{"model":"gpt-image-2","prompt":"废土流…"}'
  }
}
```

This is additive and JSON-compatible with existing transcripts. It does not
change tool execution authority, permissions, or the toolbox schema.

### 3.3 Normalize once at the adapter boundary

`@piwin/agent-host` already owns Pi payload to normalized `AgentEvent`
translation and structured `ToolPresentation` creation. Normalize the routed
invocation there so SDK and worker modes produce the same event shape.

Add a focused pure resolver, for example:

```ts
type PresentedToolInvocation = {
  invokedToolName: string;
  effectiveToolName: string;
  effectiveArgs?: unknown;
  routedToolName?: string;
};

resolvePresentedToolInvocation(toolName, args): PresentedToolInvocation
```

It unwraps only this valid display shape:

```ts
toolName === 'piwin_toolbox' &&
  args.action === 'call' &&
  typeof args.target === 'string' &&
  args.target.trim().length > 0 &&
  isPlainRecord(args.arguments);
```

For `describe`, malformed calls, missing targets, arrays, and unknown wrappers,
it returns the original invocation unchanged. This resolver is presentation
logic only and must not grant execution authority or bypass Host validation.

`buildToolPresentation` then classifies `effectiveToolName` and formats
`effectiveArgs`. It sets `routedToolName` when unwrapping occurred.

### 3.4 Keep semantics stable for the whole tool lifecycle

Pi update/end events may omit arguments. The mapper must not rebuild those
events from only the outer name and accidentally regress from `image` to
`other`.

In `createPiSessionEventMapper`, retain a bounded presentation seed keyed by
`toolCallId`:

```ts
type ToolPresentationSeed = {
  effectiveToolName: string;
  routedToolName?: string;
  startPresentation: ToolPresentation;
};
```

Rules:

1. `tool/start`: resolve the invocation, build the input-derived presentation,
   and store the seed.
2. `tool/update`: use the seed to add the bounded/redacted cumulative output
   while preserving `kind`, title, routed target, prompt summary, and input
   preview.
3. `tool/end`: use the same seed to add output/error/exit metadata, emit the
   terminal presentation, then delete the seed.
4. `session/ended` and `session/aborted`: clear any remaining seeds.
5. Never retain unbounded raw arguments in the seed. Store the already-bounded
   presentation and effective name only.

This also prevents transcript recorders from receiving a terminal presentation
that overwrites correct start-time semantics.

### 3.5 Desktop consumes structured semantics

Add one focused Desktop classifier (suggested file:
`apps/desktop/src/generation-tool-kind.ts`):

```ts
export type GenerationToolKind = 'image' | 'video';

export function resolveGenerationToolKind(tool: ToolCardUi): GenerationToolKind | null;
```

Resolution order:

1. `tool.presentation?.kind === 'image' | 'video'`;
2. `tool.presentation?.routedToolName === 'image_gen' | 'video_gen'` as a
   defensive fallback for partially upgraded records;
3. raw `tool.toolName === 'image_gen' | 'video_gen'` for legacy direct calls.

Do not parse `inputPreview` or outer toolbox JSON in Desktop. The preview is
bounded, may be truncated before `target`, and is display data rather than a
stable protocol.

Use this classifier in both existing decision points:

- `chat-thread.tsx`: aggregate running/done/error generation status and mount
  `ImageGenerationProgress` or `VideoGenerationProgress`.
- `turn-work-details.tsx`: exclude recognized generation calls from generic
  `TurnToolGroup`, preventing duplicate UI.

`ToolCallCard` remains the fallback for unknown/malformed toolbox calls.

## 4. Implementation work packages

### WP1 — Contracts

Files:

- `packages/contracts/src/host.ts`
- relevant contract/type fixtures

Changes:

1. Add `image` and `video` to `ToolKind`.
2. Add optional `routedToolName` to `ToolPresentation` with the semantics above.
3. Keep `AgentEvent.toolName` unchanged and document the distinction.
4. Do not add image-specific fields such as `generationKind`; the generic
   contract must serve all toolbox targets.

Exit criteria:

- all `ToolKind` switches compile exhaustively;
- no package adds a dependency contrary to the package graph.

### WP2 — Agent-host presentation normalization

Files:

- `packages/agent-host/src/tool-presentation.ts`
- `packages/agent-host/src/tool-presentation.test.ts`
- `packages/agent-host/src/event-map.ts`
- `packages/agent-host/src/event-map.test.ts`
- public export only if the pure resolver is intentionally reusable

Changes:

1. Implement and unit-test `resolvePresentedToolInvocation`.
2. Make direct `image_gen` and `video_gen` return `kind: 'image'/'video'`.
3. Make routed toolbox calls derive presentation from target and inner args.
4. Add lifecycle seed caching so update/end cannot erase start semantics.
5. Preserve existing redaction, output bounding, attachment extraction,
   `responseMessageId`, and generation-scoped `toolCallId` behavior.
6. Clear lifecycle state on terminal tool/session events.

Important invariant:

```text
SDK mode presentation === RPC worker mode presentation
```

Both modes must continue using the shared Pi event mapper; do not add a
Desktop-only or worker-only repair.

### WP3 — Persistence and hydrate projection

Files:

- `packages/host-runtime/src/store-transcript-recorder.test.ts`
- `packages/host-runtime/src/transcript-recorder.test.ts` if the legacy recorder
  remains supported
- `packages/session/src/transcript-ui-projection.ts`
- `packages/session/src/transcript-ui-projection.test.ts`

Changes:

1. No schema migration is required: presentation is stored as JSON and the new
   field is optional.
2. Ensure start/update/end merging retains `kind`, `routedToolName`, title,
   prompt summary, and input preview.
3. Add `routedToolName` to `slimToolPresentation`; otherwise resume/hydrate
   would lose the semantic target even though live rendering works.
4. Confirm generated attachments remain attached to the owning Assistant
   message after a routed image call completes.

Exit criteria:

- a live routed call and the same call after session resume resolve to the same
  generation UI;
- terminal output/path JSON never replaces the prompt summary.

### WP4 — Desktop rendering

Files:

- new `apps/desktop/src/generation-tool-kind.ts`
- new colocated `apps/desktop/src/generation-tool-kind.test.ts`
- `apps/desktop/src/chat-thread.tsx`
- `apps/desktop/src/chat-thread.test.tsx`
- `apps/desktop/src/turn-work-details.tsx`
- `apps/desktop/src/turn-work-details.test.tsx` if created, otherwise existing
  chat-thread coverage
- `apps/desktop/src/behavior-activity.ts` and tests for the expanded `ToolKind`

Changes:

1. Centralize generation recognition in the new classifier.
2. Replace exact raw-name checks in both chat rendering locations.
3. Keep the existing progress components and CSS unchanged unless visual QA
   finds a separate defect.
4. Ensure a routed image/video call appears exactly once: specialized progress
   surface, no generic toolbox card.
5. Keep non-generation toolbox targets on the generic/appropriate tool path.

### WP5 — Product documentation

Files:

- `docs/specs/agent-activity-presentation-design.md`
- this plan status/result section after implementation

Document that routing wrappers are presentation-transparent: the transcript
preserves the wrapper for audit but renders the effective target's behavior.
No ADR is required because toolbox authority, package ownership, and transport
boundaries are unchanged.

## 5. Required tests

### Agent-host unit cases

1. Direct `image_gen` -> `kind: image`, no `routedToolName`.
2. Toolbox `call -> image_gen` -> image kind, routed name, inner prompt summary.
3. Toolbox `call -> video_gen` -> video kind.
4. Toolbox `describe -> image_gen` remains a toolbox/discovery presentation.
5. Toolbox malformed/missing target remains generic.
6. Unknown routed target records `routedToolName` but remains `kind: other`.
7. Outer JSON is not used as the image/video header summary.
8. Secrets in inner arguments remain redacted.
9. `tool/update` preserves start classification and prompt summary.
10. `tool/end` preserves classification while adding output/error/attachments.
11. Terminal/session cleanup removes mapper seeds.

### Persistence cases

1. Store recorder persists `routedToolName` and semantic kind.
2. Terminal merge does not overwrite the start presentation with toolbox
   output JSON.
3. Slim UI projection retains `routedToolName` while still dropping heavy
   `presentation.output`.
4. Resume/hydrate maps the routed image call identically to live state.

### Desktop component cases

1. Running routed image call mounts `image-generation-progress` with status
   `running`.
2. Completed routed image call shows generated media and status `done`.
3. Failed routed image call shows status `error`.
4. Routed image call does not mount `tool-call-card`.
5. Routed video call mounts `video-generation-progress`.
6. Direct legacy `image_gen`/`video_gen` still work.
7. Generic `piwin_toolbox -> process_start` remains a normal tool card.
8. Malformed toolbox input is not falsely classified as generation.

## 6. Verification commands

Run focused checks first:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/host-runtime typecheck
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/session typecheck
pnpm --filter @piwin/session test
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop exec vitest run \
  src/generation-tool-kind.test.ts \
  src/chat-thread.test.tsx \
  src/behavior-activity.test.ts
```

Then run repository gates:

```bash
pnpm typecheck
pnpm test
pnpm test:architecture
```

Manual Desktop smoke:

1. Start a session with image generation enabled.
2. Trigger a real `piwin_toolbox -> image_gen` call.
3. While the provider request is pending, verify the image loading card animates
   and no raw toolbox JSON card is visible.
4. On success, verify the image appears once and the card reaches done state.
5. Repeat with a forced provider error and verify the error state.
6. Restart/resume the session and confirm the historical row keeps generation
   semantics without reanimating as running.

## 7. Compatibility and rollout

- New live calls and newly persisted transcripts gain routed semantics.
- Existing direct `image_gen`/`video_gen` history remains supported by raw-name
  fallback.
- Existing historical `piwin_toolbox` rows may remain generic because their
  bounded `inputPreview` can be truncated before `target`. Do not add a risky
  migration or client-side JSON heuristic.
- No config migration, media migration, permission change, or toolbox execution
  change is required.
- The change can ship in one vertical slice; suggested commits are:
  1. contracts + agent-host normalization/tests;
  2. transcript projection/persistence tests;
  3. Desktop classifier/rendering/tests;
  4. documentation/result notes.

## 8. Done definition

The work is complete when:

1. routed image/video calls carry structured target semantics from both Host
   modes;
2. live and hydrated Desktop rendering use the same classifier;
3. generation progress replaces the generic toolbox card without duplication;
4. non-generation toolbox behavior is unchanged;
5. focused tests, repository typecheck/tests, and architecture checks pass;
6. the manual pending/success/error/resume smoke is recorded in this file.

## 9. Implementation result (2026-08-12)

Implemented the vertical slice across contracts, agent-host normalization, transcript hydrate,
and Desktop rendering:

- `AgentEvent.toolName` remains the invoked wrapper while `ToolPresentation.routedToolName`
  records the effective target.
- Valid toolbox `call` envelopes are normalized from inner arguments at the shared Pi mapper;
  direct and routed image/video calls now use `kind: image | video`.
- A bounded per-`toolCallId` presentation seed preserves start-time target, prompt summary, and
  input preview through update/end. Mapper state clears on `agent_end` and via an explicit reset
  invoked by SDK/worker abort and worker drop, matching the lifecycle events available in the
  current adapters.
- Transcript projection retains `routedToolName`; persistence coverage confirms terminal output
  does not replace prompt metadata and generated attachments stay on the owning Assistant row.
- Desktop generation recognition is centralized and used by both the specialized progress surface
  and generic tool exclusion, so routed generation calls render exactly once.

Automated verification recorded in this implementation session:

- `pnpm --filter @piwin/contracts typecheck` — passed.
- `pnpm --filter @piwin/agent-host typecheck` — passed.
- `pnpm --filter @piwin/agent-host test` — 24 files / 211 tests passed.
- `pnpm --filter @piwin/host-runtime typecheck` — passed.
- `pnpm --filter @piwin/host-runtime test` — 118 files / 1136 tests passed.
- `pnpm --filter @piwin/session typecheck` — passed.
- `pnpm --filter @piwin/session test` — 26 files / 208 tests passed.
- `pnpm --dir apps/desktop exec vitest run src/generation-tool-kind.test.ts src/chat-thread.test.tsx src/behavior-activity.test.ts` — 3 files / 28 tests passed.
- Adjacent Desktop reducer/timeline/tool-card suite — 3 files / 114 tests passed.
- `pnpm test:architecture` — package boundaries passed.
- `pnpm --dir apps/desktop typecheck` — blocked by pre-existing exhaustive handling errors for the
  unrelated `xgrok-videos` API style in `src/video-generation-model-config.ts` (missing return and
  missing record key).

Manual pending/success/error/resume smoke was not run in this non-interactive session and remains
required before product sign-off. Repository-wide `pnpm typecheck` and `pnpm test` were not claimed because the working tree contains a large unrelated
in-progress change set and Desktop typecheck is already blocked as noted above.
