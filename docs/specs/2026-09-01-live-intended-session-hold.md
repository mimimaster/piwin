# Live intended-session hold (admission)

Date: 2026-09-01  
Status: product rule for hold-delegate  
Related plan: `docs/superpowers/plans/2026-09-01-live-wrong-session-admission.md`  
Does not amend ADR 0065 or the parallel rebind investigation note.

## 1. Incident pointer

Test profile `PIWIN_ROOT=~/.piwin-test`, session `session-mtieeuab-39a0190j`, call `live_176f3215-a4ad-4bf8-a3aa-41a0e474ec6c`:

| seq | row |
|-----|-----|
| 1 | user `随便生成一张图片` (`voice-delegation`) |
| 2–4 | assistants + generated images |
| 5 | **second** user, same text, same call — no reply |

At the second utterance there was no other session to bind to. Live stayed on the bound session and admission wrote another user row. The “query under the images” UI is a symptom of that extra `voice-delegation` user row, not a transcript CSS bug.

## 2. Product rule — focused session only

The **focused session is the only session that may receive new Live work**.

- Desktop reports `intendedSessionId` on every focus change (`voice/live/set-intended-session`).
- Host admission compares intended to the bound `slot.sessionId` **before** writing a transcript row.
- Empty focus (`intendedSessionId: null`) → **hold** (`live-delegation-held-empty`).
- Focus ≠ bound session → **hold** (`live-delegation-held-mismatch`).
- Focus === bound → admit as usual (subject to reuse rules below).
- A Run already accepted on the bound session is **not** cancelled by hold or later focus change.

## 3. Explicit `repeat` on the focused = bound session

When intended matches the bound session, `kind: 'repeat'` still starts a **new** turn (`session/prompt`). Same-session “再来一张” / second image must produce a new user row on that session. Hold does not convert matching-session `repeat` into reuse.

## 4. Same-brief `work` reuse

When intended matches the bound session, `kind: 'work'` whose **canonical** brief equals a completed task on that session **reuses** that task: no second `session/prompt`, no second user row. Canonicalization is whitespace collapse + trim. A new brief still admits.

## 5. Speakable copy on hold

Hold rejects admission with no user transcript row. The controller maps hold reasons to speakable owner context so the Live model **must not claim the task started**:

- `hold-empty` — user is not in a work session; ask them to open or focus one.
- `hold-mismatch` — the session the user is looking at is not the bound Live work session; do not run the task in the previous session.

Speakable text is for the voice model only; it is not a chat transcript row.

## 6. Relation to S-keep (rebind plan)

The parallel rebind plan may keep LiveBar showing the previous bind when rebind fails or focus is empty (**S-keep**). That display policy stands. **Admission must not follow that bind** when intended is empty or mismatched: hold prevents a new Run on the stale session even while LiveBar still names it. Rebind itself (making `slot.sessionId` equal the focused session) is owned by that other plan; until rebind lands, mismatch continues to hold.

## 7. Out of scope

- Transcript / chat-thread CSS (`min-height`, reorder, “query under images” layout).
- Mobile auto-rebind (rebind plan L4).
- Aborting in-flight Runs already admitted to a session.
- Editing ADR 0065 or `docs/notes/2026-09-01-live-session-rebind-investigation.md`.
