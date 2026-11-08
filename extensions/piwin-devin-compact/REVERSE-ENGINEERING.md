# Devin compaction: reverse-engineering notes

Target: `/Users/yorickjue/.local/share/devin/cli/_versions/current/bin/devin`
(Devin CLI 3000.2.17, 124 MB arm64 Mach-O, stripped: 411 symbols, no
`compactor` symbols).

Method: `__cstring`/`__TEXT,__const` string extraction → IDA Pro 9.4 (idalib +
`idat -A -S`) xrefs → Hex-Rays decompilation, cross-checked against real
artifacts on disk:

- 2088 `~/.local/share/devin/cli/summaries/history_<16 hex>.md` files (the full
  transcript Devin writes per compaction).
- `~/.local/share/devin/cli/sessions.db` (2.4 GB): `message_nodes` keeps the
  summarizer prompt, the summarizer input, the model output and the replacement
  message as ordinary nodes, plus `summarized_from` /
  `compact/prior_node_ids` metadata.

## Recovered rules

| Rule | Value | Evidence |
|------|-------|----------|
| Summarizer system prompt | 1600-char template, `{historyFile}` = bare file name | `f2_0x1004280e8` (`sub_10048EDE4` on `unk_1043C7DE7`) |
| Instruction turn | 140 bytes, "Now summarize the conversation above…" | same function, literal appended as a 3rd message |
| Transcript wrapper | `"\nConversation to summarize:\n"` + transcript | `aConversationTo` |
| Message header | `=== MESSAGE {i} - {Role} ===\n{text}` | literal `=== MESSAGE \xC0\x03 - \xC0\x05 ===\n` |
| Join separator | `"\n\n"` (`asc_1043C9A6E`) | `sub_1002B6CF4(..., 2)` |
| Tool calls | rendered as empty bodies; only tool results carry text | observed history files |
| Per-message cap | `> 8000` bytes → first 4000 + last 4000, `...[N chars truncated]...`, UTF-8 boundary aligned | `sub_100450BA8` (`0x1F40`, `4000`, `v11 - 8000`) |
| Transcript elision | only at `>= 200001` joined bytes (`0x30D41`); keep first `n/2`, last `n/4`, insert `[... {k} messages omitted due to length ...]` | `sub_10044BCCC` (`MOV W8, #0x30D41`), loop counts `v6>>1` / `v6>>2` |
| History file | `history_<16 hex>.md` written **before** elision | `"\bhistory_\xC0\x03.md"`, `getentropy(16)` |
| Replacement message | `You are continuing work…` + `Full conversation history saved at {abs}.\nSummary:\n{output}` + edited-files block | `node 371` diffed against `node 369` |
| Edited files block | `\nHere are some files that you edited (and perhaps there were others which were touched via shell script):\n - {path}\n` | `apply_summary: preserving {} edited file path(s)`, `compact/edited_files` |
| Todo list | node kept verbatim (`compact/todo_list`) instead of summarized | `agent-ext/src/compactor/todo_list.rs:89` |
| Skills | `agent-ext/skills-loaded` messages kept verbatim | `summarize.rs:571`, skill field `preserve_on_compaction` |
| Split bookkeeping | `summarized_from` = last summarized node id; kept tail re-created with `compact/prior_node_ids` lineage | `node 371` metadata, `node 42` lineage `[15,29]` |
| Model choice | current session model, optional override with fallback | `Compaction with override model failed, falling back to default model` |
| Failure path | compaction error → keep uncompacted history | `Automatic compaction failed, falling back to uncompacted history` |

Decompiled references kept locally: `f2_0x1004280e8.c` (file compactor),
`f2_0x10044BCCC.c` (elision), `f4_0x100450BA8.c` (per-message cap),
`f2_0x10044c0e0.c` (apply_summary).

## Verification

Replaying the `axiomatic-drill` compaction (131 summarized messages) through
this implementation reproduces Devin's payload exactly:

```
messages: 131  full bytes: 246714      (= history_d2863a6781694a9d.md, 246714)
elided omitted= 34  bytes= 187413      (= node 367 payload, 187413)
EXACT MATCH: True
```

## Not reimplemented

- Devin's own split-point heuristic (which messages to keep). Pi supplies
  `firstKeptEntryId`, so the extension follows Pi's cut point.
- Devin keeps todo/skill nodes as separate chain nodes; Pi compaction returns a
  single summary string, so those blocks are inlined before the continuation
  message.
