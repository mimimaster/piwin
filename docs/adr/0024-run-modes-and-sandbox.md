# ADR 0024: Run Modes, Sandbox Axis, and Circuit Breakers

## Status

Accepted (2026-07-30) · Phase 1 implementation in progress.

## Context

ADR 0019 built a solid **approval layer**: deny→ask→allow rule engine, layered
rules, `auto`/`ask-all`/`bypass` modes, and the file-write gate. MCP is outside
that approval layer; its configuration trust and process lifecycle are defined
by [ADR 0033](./0033-mcp-supervisor-architecture.md). The permission layer is
honest about being "not an OS sandbox."

That honesty exposes the gap: **approval is the only boundary**. In `auto` mode
the model can run almost anything with full host privilege; we just don't ask.
Mature coding agents (Codex, Claude Code, Gemini CLI, Cursor) all converged on
the same fix — split capability from approval:

> **Sandbox decides what is possible. Approval decides when to ask.**

piwin is open-source, single-user, self-hosted. We do **not** build an admin
tier, multi-user identity, SIEM audit, or LLM classifier (Cursor's Auto-review).
We borrow the **shape** of Cursor Run Modes, not the enterprise plumbing.

## Decision

### 1. Two axes, one user-facing knob

Internally: capability axis (OS sandbox) + approval axis (ADR 0019 rule engine).
Externally: three **Run Modes** that set both.

| Run Mode | Sandbox | Approval | When |
|----------|---------|----------|------|
| `ask` | workspace-write, net off | ask almost everything | Sensitive / untrusted |
| `auto` | workspace-write, net off | low friction inside; ask to leave | Explicitly safer daily coding |
| `yolo` (default) | none (full host) | no prompts except circuit breakers | Pi-compatible default; disposable VM / CI |

**`auto` uses sandbox ON**. Leave-sandbox approval is the escape hatch until
network allowlist ships (Phase 3).

### 2. Agent mode ≠ Run Mode

Agent mode (`Agent` / `Plan` / `Debug` / `Ask` via composer `+` menu) is
collaboration intent. Run Mode is tool execution. Keep them orthogonal.

**Soft link**: when Agent mode is `plan` or `ask`, host raises a read-only
floor (sandbox `read-only`, mutators always ask) even under `auto`. User can
still pick `yolo` while in Plan/Ask — UI shows a one-line warning, host does
not hard-block (locked).

The read-only floor applies to the project workspace, not Host-owned product
state. Planning tools may write the validated SessionPlan under
`~/.piwin/sessions/<sessionId>/plan.json` without an interactive permission
prompt. Plan mode is a persisted-plan intent: its Run fails with
`plan-not-persisted` if no new durable Plan revision is produced.

### 3. Circuit breakers always ask

Even under `yolo`, these still prompt (or deny non-interactive):

- Root / home recursive delete (`rm -rf /`, `rm -rf ~`)
- Secret path writes (`~/.ssh/**`, `**/.env`, keys, credentials)
- Force-push to main/master (bundled ask rule)

This matches Claude Code's circuit breaker. Today's `bypass` allows everything
except deny rules — too hot for a tool people leave on.

### 4. Approval scopes: once | session | project

Today: once / project. Add **session** (in-memory, per session). Default focus
on the permission prompt is "Allow for session" — the narrowest scope that
unblocks the task without persisting to disk.

### 5. Composer pill is the primary control

Run Mode lives in the composer toolbar as a pill + popover (like the existing
ThinkingEffortControl). Settings → Permissions becomes secondary (rules,
remembered list, default preset). Context-bar mode badge is demoted.

### 6. CLI compatibility

| Old | New |
|-----|-----|
| `--permission-mode auto` | `auto` |
| `--permission-mode ask-all` | `ask` |
| `--permission-mode bypass` | `yolo` |
| `--dangerously-bypass-permissions` | alias of `--yolo` |

Old values accepted; new values `ask` / `yolo` also accepted.

### 7. Phasing

- **Phase 1** (this ADR): Run Mode pill + preset mapping + circuit breakers +
  session scope + docs. No sandbox yet — approval-only under the hood, but the
  user model is clean.
- **Phase 2**: workspace sandbox (macOS Seatbelt, Linux Landlock/bwrap).
- **Phase 3**: network allowlist and polish. MCP diagnostics are owned by ADR
  0033 and are not permission annotations.

## Consequences

- **Soft break**: `auto` becomes sandboxed in Phase 2. First out-of-workspace
  write or network egress asks to leave sandbox. Documented; escape hatch is
  leave-sandbox approval or `yolo`.
- `PermissionMode` (`auto`/`ask-all`/`bypass`) stays as the internal approval
  axis; `PermissionPreset` (`ask`/`auto`/`yolo`) is the user-facing knob.
- Rule files, rule engine, loaders, and file-write gate remain unchanged by this
  ADR. MCP is not a permission concern; Run Modes do not change MCP trust or
  Supervisor ownership.
- ADR 0019's `bypass` semantics (full host, no prompts) become `yolo` + circuit
  breakers. Strictly safer.

## Out of scope (future ADRs)

- OS sandbox implementation (Phase 2).
- Network egress allowlist (Phase 3).
- MCP `destructiveHint` / `requiresUserInteraction` honors (Phase 3).
- Admin / managed policy tier — explicitly rejected for this product.
- LLM classifier approval — explicitly rejected; sandbox + rules cover the same
  ground deterministically.
