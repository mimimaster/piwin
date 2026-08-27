# Live stream projection

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-08-26 |
| Surface | Desktop transcript (Chat + Conversation) |

## 1. Problem

Pi still streams. The shell does not project that stream as one cadence.

Three later patches stacked on the same path and fought each other:

1. Artifact fence indexing collapsed Streamdown into one document block so `node.position.start.offset` stayed document-relative (`9760d973`). That is already on `main`. It is a fence-identity compromise, not the change that made this week’s spit-out feel wrong.
2. Goal-mode work switched live Markdown to `mode="static"` and deleted the rAF queue, to stop WKWebView from holding tokens until the turn ended. Static mode skips remend and re-parses the whole reply as a finished document. That is the “chunk snap / not SSE” feel.
3. A follow-up turned `animated={{ duration: 0 }}` on *while* `isAnimating` was still true. Streamdown then injects `data-sd-animate` word spans. CSS can kill the fade; it cannot kill the extra DOM. That is a new shape, not a restore of `HEAD`.

Dump-all-at-end had a separate, real cause: Desktop did not adopt Host `replay/done.currentSeq`, so live batches looked like cursor holes and the UI sat on “thinking” until a reload. Pause-then-spin was `run/updated(running)` reviving chrome after an optimistic pause. SVG wheels were WebKit dropping local `<use href="#id">` inside Shadow DOM.

Those three bugs are orthogonal to Markdown spit-out. They stay. The renderer hacks go.

## 2. Goal

Live assistant text follows Host native deltas, paragraph by paragraph, without a second fake stream and without a third Markdown mode.

Success is all of:

- GLM 5.2 (and any SSE-capable model) shows growing text before `message/end`.
- Completed paragraphs stay put. Only the open tail changes.
- Incomplete `**bold` / `` `code` `` paint as formatted text while still open (remend).
- Switching away and back during a live run does not dump the whole reply at once.
- Pause clears the sidebar spinner on the click, not after the provider finally dies.
- The pelican SVG from `session-mt8uiuxg-fgz7vqch` keeps both wheels.
- No `requestAnimationFrame` stream queue, no character slicing, no live `mode="static"`.

## 3. Non-goals

- Restoring an old `MarkdownView` commit (`7e8790f5` or similar). That would drop the fence index.
- Checking out the whole dirty worktree back to `HEAD`. Pause, SVG, search, and file-tree work would vanish together.
- Fake typewriter / client-side token drip.
- Changing Pi, Host AgentEvent shapes, or ADR 0038’s Host-owned batch.
- Reworking Artifact RenderIntent / Canvas. Fence identity stays; only the Streamdown offset shortcut is in scope if a matcher replaces it.
- Shipping session search, file-tree, status-bar, or work-disclosure in the same PR.

## 4. One cadence, one renderer

```text
Pi SSE
  → Host AgentEvent (native text_delta / thinking_delta)
  → Host egress batch (≤ 8 items, ~8ms)     ← only coalescer
  → Desktop HostClient (adopt replay fence)
  → same JS task: dispatch each item
  → React 18 batches one paint
  → chat reducer appends native deltas
  → MarkdownView / Streamdown streaming tree
```

Host already coalesces. Desktop must not add another timer, rAF, or character queue in front of the reducer.

## 5. Streamdown contract

Live and just-completed messages use Streamdown’s **streaming** tree. History that never streamed on this mount uses `static`.

| Prop | Live | Why |
|---|---|---|
| `mode` | `"streaming"` and kept through completion | Same keyed tree; no remount on `message/end` |
| `parseIncompleteMarkdown` | `true` while live | remend on the full string |
| `animated` | `{ duration: 0, stagger: 0 }` | Makes Streamdown’s internal `ge` truthy, so block state updates are urgent `setState`, not `startTransition` |
| `isAnimating` | `false` | `ge && isAnimating` is what injects word `<span data-sd-animate>`. Keep `ge`, drop the spans |
| `caret` | omit | One caret: CSS `.has-stream-caret` |
| `parseMarkdownIntoBlocksFn` | keep single-document **in this PR** | Fence lookup still keys on `node.position.start.offset`. Replacing that matcher is a follow-up, not this cleanup |

This is the whole live renderer. There is no static-live path and no animate-span path.

`HEAD` used `animated={false}` plus `isAnimating={streamMode}`. That combination is exactly Streamdown 2.5’s startTransition trap in WKWebView. Do not restore it.

## 6. What to delete

Delete these, do not wrap them:

| Delete | Why it existed | Why it goes |
|---|---|---|
| Live `mode="static"` | Same-commit paint | Wrong tree; skips remend; snaps structure |
| `isAnimating={streamMode}` | Streamdown caret + last-block incomplete flag | Caret is CSS; remend already runs; `isAnimating` turns on word spans once `animated` is an object |
| Streamdown `caret="block"` on live | Package caret | Duplicate of `.has-stream-caret` |
| rAF / timer `stream-event-buffer` | 60fps coalesce | Second queue; paused when the WebView is occluded; Host batch already coalesces |
| Client character slicing | Fake SSE | Host deltas are the stream |
| Any “typewriter” setTimeout | Same | Same |

Keep, they are not renderer hacks:

- `replay/done.currentSeq` adoption in `@piwin/host-client` **and** Desktop’s local Tauri client
- Optimistic pause that does not revive on a still-`running` `run/updated`
- Host suppress of controlled AbortError
- SVG local `<use>` expansion before DOMPurify
- Host `maxBatchItems = 8` / 8ms flush
- Passthrough `createStreamEventBuffer` facade (`flush` / `dispose` / `reset` no-ops) so call sites stay boring

## 7. Follow-up (not this PR)

Restore Streamdown’s default block splitter so completed paragraphs are separate keyed blocks. That needs a fence identity that does not use document-relative `node.position.start.offset` (match indexed fences by language + unmatched ordinal + source prefix, idempotent under double render). Until that matcher exists, keep `parseStreamdownAsSingleDocument`.

Do not mix that follow-up with this cleanup.

## 8. Pause and SVG

Already designed and implemented in the working tree. They ship as **separate commits** in the same vertical, not as renderer conditions.

- Pause: `run/pausing` / `run/aborting` stay sticky until `run/terminal` or `run/pause-failed`.
- SVG: expand same-fragment `<use href="#id">` after the explicit sanitizer pass and before DOMPurify.

## 9. Key decisions

1. **Host batch is the only coalescer.** Desktop rAF is deleted, not restored.
2. **Streamdown streaming tree is the only live Markdown tree.** Static is history-only.
3. **`animated` object exists only to disable startTransition.** `isAnimating` stays false so the animate rehype plugin never mounts.
4. **Visibility bugs are cursor bugs.** Fix `currentSeq`; do not change Markdown mode to paper over a hole.
5. **Single-document parse stays until a fence matcher replaces offsets.** Deleting it in the same PR would retangle Artifact.
6. **Unrelated dirty work stays out.** Session search, file tree, status bar, work disclosure are other PRs.

## 10. Tests and proof

- MarkdownView: second token is visible after `act()`; remend of `This is **partial` shows no raw `**`; live class is `has-stream-caret`; no `[data-sd-animate]` in the live tree.
- stream-event-buffer: one `dispatch` per Host delta; no frame callback.
- host-client (package + Desktop): filtered replay `currentSeq=5` then `afterSeq=5` live batch reports **no** gap.
- chat-reducer: after `run/pausing`, `run/updated(running)` and `message/end` do not restore `workingSessionIds`.
- ArtifactStatic: pelican-shaped `<g id="spokedWheel">` + two `<use href="#spokedWheel"/>` produce two wheel instance groups and zero `<use>`.
- Manual: current debug/HMR window, GLM 5.2, text visible before end; pause spinner dies on click; `session-mt8uiuxg-fgz7vqch` wheels present. Do not use an old Release .app.
