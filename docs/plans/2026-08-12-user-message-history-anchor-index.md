# User-message history anchor index

## Status

Implemented as the first vertical slice on 2026-08-12. Review hardening was
completed the same day for live-tail isolation, async request races, and SQLite
sampling memory.

The history rail is a navigation index, not a second transcript renderer. It
contains only non-empty user-authored messages. Assistant, tool, thinking, and
artifact rows do not create ticks and do not invalidate the user-message index.

## User-facing behavior

- The rail shows one tick per user message for small sessions.
- Large sessions use at most 128 evenly distributed anchors by default.
- Hovering an anchor shows a short preview, timestamp, and global user-message
  position. Sampled anchors show the represented ordinal span.
- Clicking a tick first scrolls to a resident message. If the message is not in
  the bounded browser window, Desktop asks Host for a small transcript window
  around that message and then scrolls to it.
- A remote seek opens a temporary bounded history view. The normal transcript
  state remains the live tail and continues receiving Host pushes. The UI shows
  a persistent return-to-latest action; sending a prompt exits history view.
- History rows and live-tail rows are never concatenated across an unloaded gap.
- If an older Host does not implement the new commands, Desktop falls back to
  ticks derived from resident user rows; the rest of the transcript remains
  usable.

## Boundaries

```text
SQLite transcript store
  ├─ user-message index: user rows only, independent revision
  └─ transcript window: anchor id → bounded nearby rows
          ↓
Host command surface
          ↓
Desktop reducer state
  ├─ userMessageIndex
  └─ bounded transcriptWindow
          ↓
HistoryTicksDrawer
```

The UI never reads SQLite and never parses Pi-native event shapes. The Host
owns message identity, ordering, revisions, sampling, and byte limits.

## Contracts

`SessionUserMessageIndexData` contains:

- `messageId`, `createdAt`, and a normalized bounded `preview`;
- zero-based `ordinal` among non-empty user messages;
- `spanStartOrdinal` and `spanEndOrdinal` for sampled anchors;
- `totalUserMessages`, `mode`, `revision`, and encoded anchor bytes.

`session/user-message-index` accepts a session id and a requested tick cap.
`session/transcript-window` accepts an anchor message id, bounded before/after
counts, and a serialized byte cap.

The transcript page contract keeps its complete-transcript revision. The index
uses a separate user-message revision so assistant streaming updates do not
cause the rail to rebuild.

## Storage and resource policy

- `transcript_meta.user_message_revision` is added with a default of zero and
  migrated in place for existing databases.
- A partial SQLite index covers non-empty user rows.
- Inserts, user text changes, user-row deletion, truncation, and legacy import
  update the user revision. Assistant/tool-only changes update only the normal
  transcript revision.
- Exact indexes are returned when they fit the requested cap. Large indexes are
  sampled in SQL by user-message ordinal buckets. Sampling CTEs carry only row
  identity and ordinals; bounded preview text is read only for final anchors.
- The index has a 256-tick hard request ceiling and a 128 KiB encoded-anchor
  budget. Previews are capped at 120 characters and are shortened/sampled again
  if the byte budget requires it.
- Transcript seeks are capped at 50 rows and use the existing transcript page
  byte limits. Tool output is projected through the existing UI projection.

## Desktop state and lifecycle

- Session switches clear the active user-message index. An effect requests the
  index independently after the session becomes active.
- Adding a durable user message invalidates the active index; the same effect
  refreshes it. Assistant/tool appends leave it intact.
- Every invalidation advances a renderer epoch. Async index and seek responses
  carry the captured epoch and are ignored after a send, truncate, or session
  switch; seek requests also use latest-request-wins ordering.
- The rail consumes index anchors when present and uses resident user rows as a
  compatibility fallback while the index is unavailable.
- A resident anchor uses the existing scroll-port path. A cold anchor requests
  `session/transcript-window`, stores the result in `historyView`, and scrolls
  after React has painted it. `messages` remains the independently updating
  live tail and is revealed immediately by return-to-latest.

## Verification

Covered by:

- session-store tests for independent revisions, exact indexes, sampled spans,
  seek windows, and missing anchors;
- Desktop tests for indexed rendering, global position labels, and remote seek
  delegation, live-tail isolation/return, and stale index response rejection;
- package type checks for contracts, session, Host-runtime, and Desktop;
- full workspace `pnpm typecheck`;
- package test suites for session, Host-runtime, and Desktop.

## Follow-up boundaries

The current slice intentionally keeps the existing bounded transcript page
loader and does not add a second bidirectional cursor protocol. If product
testing shows that users frequently scroll beyond the returned seek window, the
next change should add explicit `olderCursor`/`newerCursor` semantics to the
window contract rather than increasing the browser retention budget.
