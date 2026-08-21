# Spec — Reply Writer（输出委托）

| Field | Value |
|-------|-------|
| Status | **Landed (v1)** |
| Date | 2026-08-20 |
| Packages | `contracts`, `host-runtime`, `session`, `apps/desktop` |
| Depends on | Vision delegation config shape; `completeStructuredText` |
| Principle | Worker model may be bad at Chinese; the visible reply can be rewritten by a configured writer model. Host-owned, default off. |

---

## 1. Goal

Some models are useful for tools and code, but the wrap-up after tool results is unreadable Chinese (or English word-salad). Prompt rules do not fix that.

Reply Writer is a **post-turn one-shot rewrite**, not a second agent session:

1. The session model still does the work (tools, edits, reasoning).
2. When a foreground run completes with assistant text, Host optionally calls a configured writer model.
3. The visible assistant `text` becomes the writer output. The worker draft is kept on the message as `replyWriter.sourceText`.

This is the inverse of vision delegation (pre-turn describe) and is **not** Walkthrough (a separate delivery card).

---

## 2. Config

`PiwinConfig.replyWriter` (Settings domain `replyWriter`):

| Field | Default | Notes |
|-------|---------|-------|
| `enabled` | `false` | Missing config is disabled. |
| `model` | unset | Must be an enabled configured chat model. Invalid/missing model → skip. |
| `language` | `zh-CN` | `zh-CN` \| `en` \| `follow-user` |
| `systemPrompt` | product default | Optional override. |
| `timeoutMs` | `60_000` | Structured completion timeout. |

Changing this domain is **immediate** (next completed turn). It does not stale the live Pi runtime.

---

## 3. When Host rewrites

Skip when any of these hold:

- `enabled` is false or `model` is missing
- session `kind` is `subagent` or `side-chat`
- the run did not complete successfully
- last assistant row for that run has empty text
- writer model equals the worker model (`providerId` + `modelId`)
- a later assistant message already exists (user already continued)
- writer returns empty / errors / times out → **keep the worker draft**, log a warning

The rewrite is fire-and-forget after `terminateRun(..., 'completed')`. It must not block prompt ACK.

---

## 4. Prompt

Writer sees bounded evidence only (data, not instructions):

- last user body
- worker draft
- short tool name + truncated output list

System prompt: rewrite for a human; preserve facts, paths, commands, code, numbers; do not invent; do not mention the rewrite.

---

## 5. Persistence and live UI

- Transcript: replace `text`; store `replyWriter` in `metadata_json`.
- Live: `message/text_snapshot` replaces the bubble; `reply-writer/updated` drives the header chip / pending state.
- Failure leaves the original text in place.

---

## 6. Non-goals (v1)

- Streaming the writer token-by-token
- Hiding the worker draft while it streams
- Per-session override (composer chip)
- Auto-detecting “this reply is already fluent”
- Rewriting subagent / side-chat transcripts
