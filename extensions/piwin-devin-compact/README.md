# piwin-devin-compact

Devin-style context compaction for Pi, reverse-engineered from the Devin CLI
(`devin` 3000.2.17, `agent-ext/src/compactor/*`).

Install:

```sh
piwin extension install --local /absolute/path/to/extensions/piwin-devin-compact
```

## What it does

On manual, threshold, or overflow compaction the extension reproduces the
Devin CLI compactor instead of Pi's default summarizer:

1. Renders the dropped messages exactly like Devin's history file:
   `=== MESSAGE {n} - {Role} ===` blocks joined by a blank line. Tool calls
   render as empty bodies; tool results carry the text (this is why Devin
   summaries cite message numbers instead of tool arguments). Any message over
   8000 bytes is cut to its first 4000 + last 4000 bytes with
   `...[N chars truncated]...` in between, on UTF-8 boundaries.
2. Writes the **full** transcript to `~/.piwin/compact/history_<16 hex>.md`
   (or `$PIWIN_ROOT/compact/`).
3. Elides the middle of what it sends to the model, using Devin's rule: only
   from 200001 joined bytes up, keep the first `n/2` and the last `n/4`
   messages, and insert `[... {k} messages omitted due to length ...]`.
4. Calls the current session model with the recovered three-turn summarizer
   conversation (system prompt + `Conversation to summarize` + the 140-byte
   "Now summarize the conversation above..." turn).
5. Replaces history with Devin's continuation message:

   ```text
   You are continuing work from a previous conversation thread. Below is a summary of the previous conversation thread:
   Full conversation history saved at <abs path>.
   Summary:
   <model output, <summary> tags included>

   Here are some files that you edited (and perhaps there were others which were touched via shell script):
    - <path>
   ```

If the summarizer fails or returns nothing, the handler returns without a
compaction result so Pi's own compaction runs.

## Recovered vs. adapted

Recovered byte-for-byte from the binary and from 2088 real
`history_*.md` files plus the CLI session database:

- summarizer system prompt, instruction turn, transcript format, per-message
  8000-byte cap, elision threshold and ratios, history file naming,
  replacement message layout, edited-files block.

Verified by replaying a real compaction (`session axiomatic-drill`): rendering
its 131 summarized messages with this implementation reproduces Devin's exact
summarizer payload, 187413 bytes, and the full transcript matches the on-disk
`history_d2863a6781694a9d.md` byte for byte (246714 bytes).

Adapted for Pi, because Pi compaction returns a single summary string:

- Devin keeps the todo-list node (`compact/todo_list`) and `skills-loaded`
  messages as separate nodes. This extension inlines those blocks ahead of the
  continuation message instead.
- The split point (which messages are summarized vs kept) comes from Pi's
  `firstKeptEntryId`; Devin's own split heuristic is not reimplemented.
- `/compact <text>` appends an extra focus turn to the summarizer request.
  Devin has no such turn.

## Tests

```sh
pnpm test      # 17 tests: prompt bytes, transcript, elision, replacement, wiring
pnpm typecheck
```
