# Wave 2 Spec — Sub-agent worktree · Compaction fileOps · PTY · Modes · Rich MD · Providers

| Field | Value |
|-------|-------|
| Status | **Ready for implementation planning** |
| Date | 2026-07-21 |
| Program | [`program-capability-expansion.md`](./program-capability-expansion.md) |
| Prerequisite | W1 recommended; existing H3 sub-agent + H1 compaction |
| Packages | git, session, agent-host, contracts, desktop, cli, ui-kit |

## 1. Goals
1. Safe parallel sub-agents: **worktree isolation**, apply policies, concurrency, roster UX.
2. Compaction **FileOperations** surface (Pi-native, not LiveAgent reimplementation).
3. Real **PTY** terminal dock.
4. Execution modes polish; **KaTeX + Mermaid**; Gemini-class provider presets (compatible protocols only).

## 2. Non-goals
Pi multi-leaf JSONL tree UI (D-M2-01b); full multi-agent message bus; tunnel (W4).

## 3. CE-SUB Worktree sub-agents
### Baseline already shipped
session/spawn, list-children, cancel, complete, merge; depth max 1; SubAgentPanel.

### Gaps to fill
| Gap | Spec |
|-----|------|
| Isolation | mode: `readonly` \| `worktree` (default readonly) |
| Apply | applyPolicy: `none` \| `auto` \| `explicit` + allowedOutputPaths[] |
| Concurrency | batch max N default 3 hard max 8 |
| Retain | retainWorktree for review |
| Bus-lite | session/message-child inject note only |

### Git APIs (`@piwin/git`)
createWorktree / removeWorktree / diffWorktreeAgainstMain / applyWorktreeToMain.
Worktrees under project via git-native worktree; never force-delete without confirm.
- auto: apply then cleanup unless retain
- explicit: only allowlisted paths
- none: summary-only merge (existing)

### Spawn input extension
parentSessionId, task, mode, applyPolicy, allowedOutputPaths, retainWorktree, role.
Readonly: no write/edit/destructive bash. Worktree: cwd = worktree path.

### Optional tool
`piwin_subagent_run` agents[] + concurrency; atomic validation (all or none).

### Accept
Readonly cannot write main tree; worktree edits isolated; auto apply+cleanup; explicit path filter; concurrency 3; merge card still works.

## 4. CE-COMP FileOperations
### Pi surface (do not reimplement)
```ts
interface FileOperations { read: Set<string>; written: Set<string>; edited: Set<string> }
// computeFileLists → readFiles, modifiedFiles
// formatFileOperations → summary fragment
```
### Product
- CE-COMP-01: map fileOps into compaction/end event + transcript note
- CE-COMP-02: banner expandable: summary, tokens, Files touched
- CE-COMP-03: post-compact inject `### Files touched` (cap 4k, data-not-instructions)
Sanitize paths; drop oversize paths entirely (no mid-string truncate).

### Accept
After read/write + compact, UI lists paths; list not fed as instructions to summarizer.

## 5. CE-PTY Real terminal
xterm.js (desktop) ↔ HostCommand pty/open|input|resize|close ↔ node-pty (or Tauri plugin ADR if packaging fails).
Trusted project only; Activity stays tool logs; Terminal is interactive shell.
W2 does not require agent-driven PTY (ManagedProcess remains for non-interactive).

### Accept
pwd is project root; resize works; close project disposes; untrusted denied.

## 6. CE-MODE
chat / agent / agent-debug: strip tools / full / full+verbose (memory extract status, raw tool args). Composer toggle + Settings default; per-session persist.

## 7. CE-MD Rich Markdown
KaTeX + Mermaid (fail soft). Artifact HTML remains `@piwin/artifact`. Monaco optional later.

## 8. CE-PROV
Gemini-class via OpenAI/Anthropic-compatible Base URL presets only — no second agent SDK.
Optional Pi `registerProvider` extension later if settings insufficient.

## 9. Slices
S1 worktree git + spawn flags → S2 apply policies UI → S3 concurrency tool → S4 fileOps map → S5 PTY → S6 KaTeX/Mermaid → S7 modes + presets.

## 10. Coordination
Prefer host tool filter for readonly over extension tool_call. Tools need customTools capability (SDK/D-HOST-01b worker).

## 11. Open
git-native worktree path; node-pty vs Tauri; apply does not auto-commit (default).
