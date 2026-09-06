# Canvas live stream preview

| Field | Value |
|---|---|
| Status | Accepted (product owner, 2026-08-26) |
| Surface | Desktop Conversation / Chat right-panel Canvas |
| Supersedes | ADR 0029 “Canvas stays source while streaming”; ADR 0005 Canvas-until-completion clause |

## 1. Product

When a live assistant reply declares `surface="canvas"`, open the right Canvas
immediately. The transcript keeps dumping the growing HTML source while the
fence is open. The Canvas panel renders the same growing source through the
existing Inline `stream-preview` pipeline (one sandbox iframe, throttled DOM
reconcile). When the closing fence arrives, the transcript folds to the Canvas
launcher; the panel commits that iframe to interactive and does not remount.

This is the owner’s requested split:

```text
left  = source while fence open → launcher once closed
right = Canvas panel, opened as soon as the opening fence is Canvas
```

Not a new renderer. Inline already stream-previews; Canvas already mounts
`ArtifactFrame presentation="canvas"`. The previous gap was policy: auto-reveal
waited for `message.status === 'done'`, and the panel always materialized
`mode: 'interactive'`.

## 2. Non-goals

- Running `<script>` during the stream (stream-preview still strips scripts
  and incomplete `style` tails).
- Changing Inline stream-preview, code-first, or capability-off.
- Auto-opening hydrated history or session switches.
- Promoting Inline → Canvas from measured width/height.
- Relaxing the host motion policy (`animation: none`) in this change.
- A second Markdown parser.

Expect the right panel to show **structure growing**, not a finished animation
riding while tokens still arrive. Scripts (and therefore JS-driven motion)
start after the owning message completes.

“Structure growing” means completed, styled visual elements remain in place as
later siblings arrive. It does not mean exposing a browser’s raw layout for
class-driven DOM before its stylesheet exists. The shared Inline/Canvas stream
projector holds that prefix behind “Preparing a stable preview…”. The Artifact
runtime prompt requires CSS-first emission. A CSS-late model fallback hoists
the completed fragment stylesheet and replays at most eight closed structural
prefixes in the same iframe.

## 3. Detection

`surface="canvas"` lives on the opening fence line. After that newline, the
canonical indexer already classifies `layout: 'canvas'`. No heuristic, no
runtime promotion.

Do not open on ` ```artifact-html` alone. Wait until `parseFenceSurface` is
`canvas`. Unknown/missing surface stays Inline.

## 4. Owner of the open

**`advanceArtifactCanvasAutoReveal`**, not `ArtifactFenceController`.

Fence controllers must not call `onOpenArtifactCanvas` while rendering. That
is a render-time side effect and would fight the existing one-shot reveal
state machine.

The transcript path for Canvas dumps `SourceCodeBlock` while the fence is
still open, then folds to `ArtifactCanvasLauncher` once the closing fence
arrives (including when `renderingPhase` is still stuck on streaming).
Capability-off, unbound, and blocked fences stay on `SourceCodeBlock`. The
transcript never mounts the Canvas iframe.

## 5. Pipeline

```text
Host text_delta
  → chat reducer message.text
  → useArtifactCanvasAutoReveal
      advanceArtifactCanvasAutoReveal
        collectArtifactCanvasTargets({ mode: 'stream-preview', streaming: true })
        last explicit Canvas fence wins
  → action:
        reveal  (new target id)  → openTarget + openInspector('canvas')
        update  (same id)        → openTarget only
  → ArtifactCanvasPanel
        streaming === true  → materializeArtifact(..., { mode: 'stream-preview', presentation: 'canvas' })
        else                → mode: 'interactive'
  → ArtifactFrame / useArtifactDocument streamLifecycle
        documentKey = stream:<descriptor.id>
        300ms native stream publisher reconciles DOM
        CSS-late large unlock → bounded 140ms stable-prefix replay
  → message done
        same id, streaming omitted, mode interactive
        same iframe commits; scripts may run
```

Stable ids (unchanged):

- target: `canvas:${sessionId}:${messageId}:${fenceIndex}`
- iframe channel: `${messageId}-artifact-${ordinal}`

Source is not part of identity. Growing source replaces the active target in
place (`isSameCanvasTarget`).

## 6. Reveal vs update

| Event | Action |
|---|---|
| First parseable Canvas on a live message | `reveal`: set target, open Canvas tab, ensure desktop min width |
| Later tokens, same `target.id` | `update`: replace target/source only. Do **not** call `openInspector` |
| User clicks transcript launcher | always `reveal` (existing `handleOpenArtifactCanvas`) |
| Completion, same id | `update` with `streaming` omitted |
| Hydrated history, never seen streaming | no action |
| Capability off / blocked / Inline | no action |
| Session switch | clear target (existing `useArtifactCanvas`) |

If the user switches to Files/Diff mid-generation, source updates continue in
the background. The Canvas tab is not stolen again. Re-selecting Canvas shows
the latest snapshot.

Do not steal keyboard focus (existing auto-reveal rule).

## 7. Streaming flag

`ArtifactCanvasTarget.streaming === true` only while the owning assistant
message `status === 'streaming'`. Omit the field when complete
(`exactOptionalPropertyTypes`).

`collectArtifactCanvasTargets` accepts `mode` (default `'interactive'`) and
`streaming`. Live collection uses `mode: 'stream-preview'` so empty/incomplete
explicit Canvas fences are allowed (`blocked-empty` pass).

## 8. Iframe lifecycle

Reuse Inline’s stream document:

- First live plan is `stream-preview` → `streamLifecycle` latches true.
- Token updates keep `documentKey = stream:<id>` (no srcdoc remount).
- Completion flips `mode` to `interactive` without changing the React key
  (`themeKey:target.id`). The stream publisher posts the final snapshot and
  drops the listener.

Do not put source bytes in the ArtifactFrame `key`.

## 9. Failure and pause

- **Blocked** (external iframe, oversize, …): no reveal. Transcript stays
  source. Existing complete-path tests stay valid.
- **Pause**: message remains `streaming`. Keep stream-preview.
- **Error / abort** after a live reveal: do not emit a new reveal. Leave the
  last snapshot in the panel (still stream-preview unless a later successful
  `done` arrives). Consume `pendingMessageIds` so a later `done` on that id
  cannot auto-open as history. Desktop abort is `session/aborted`: the
  assistant row is stamped `status: 'done'` and `runTerminal.kind ===
  'stopped'`. That is not a Canvas commit — do not flip stream-preview to
  interactive (scripts stay off).
- **Capability turned off mid-stream**: stop emitting; do not close an already
  open panel from this hook.

## 10. Compact layout

`handleOpenArtifactCanvas` already opens the inspector overlay on compact and
only skips the desktop min-width bump. First reveal uses that path. Owner
asked for the panel to appear immediately; compact is an overlay, not a
reason to delay.

## 11. Files to change

| File | Change |
|---|---|
| `artifact-canvas-model.ts` | optional `streaming`; `collect` `mode` |
| `artifact-canvas-auto-reveal.ts` | emit live target; `action: reveal \| update` |
| `use-artifact-canvas-auto-reveal.ts` | `onUpdate`; dispatch by action |
| `use-workbench-app-model.ts` | `onUpdate: openTarget` |
| `artifact-canvas-panel.tsx` | `stream-preview` when `streaming` |
| ADRs 0005, 0029 + `docs/artifact-research.md` | match shipped behavior |

`ArtifactFenceController` dumps source while the Canvas fence is open and
folds to the launcher once the fence is closed.

## 12. Tests

- Auto-reveal: live open fence with `surface="canvas"` → `reveal` + `streaming: true`.
- Second delta, same id → `update`, source grew.
- Complete → `update`, `streaming` omitted.
- Streaming without `surface=canvas` then complete with Canvas → `reveal` on complete (old path).
- History `done` never streamed → no target.
- Blocked Canvas → no target while live or complete.
- Error after live reveal → no second reveal.
- Panel: `streaming: true` materializes `mode: 'stream-preview'`.
- MarkdownView: open Canvas fence stays source-only while streaming; closed
  fence folds to the launcher (including stuck streaming phase); no transcript iframe.
