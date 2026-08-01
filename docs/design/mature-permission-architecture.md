# Mature permission architecture for piwin

| Field | Value |
|-------|-------|
| Status | Draft proposal (not yet an ADR) |
| Date | 2026-07-30 |
| Related | [ADR 0019](../adr/0019-permission-rule-engine.md), [Architecture §3.4](../architecture.md#34-permission-system), [Permissions guide](../guides/permissions.md) |
| Supersedes | Nothing — extends ADR 0019 |
| Positioning | Open-source, single-user, self-hosted. No admin tier, no multi-user, no SIEM. |

## 0. TL;DR

ADR 0019 already has a clean **approval layer** (deny→ask→allow rules, modes,
file-write gate, MCP server trust, project trust). That is the right foundation.

What is still immature is not "enterprise controls" — it is that **approval is
the only boundary**. In `auto` mode the model can run almost anything with full
host privilege; we just don't ask. Mature coding agents (Codex, Claude Code,
Gemini CLI) all converged on the same fix:

> **Sandbox decides what is possible. Approval decides when to ask.**

For a personal open-source tool, that is the whole design. No admin policy, no
audit SIEM, no identity system. Just:

1. Keep the ADR 0019 rule engine as the approval axis.
2. Add a real OS sandbox as the capability axis.
3. Collapse both into a few **presets** users actually understand.
4. Fix a few sharp edges (bypass too hot, no session remember, bash network hole).

---

## 1. Product constraints (what we are *not* building)

| Out of scope | Why |
|--------------|-----|
| Admin / managed policy tier | Single-user product; user *is* the admin |
| Multi-user / identity / RBAC | Local personal tool |
| SIEM / OTLP audit export | Overkill; session logs already exist for debugging |
| Cryptographic approval binding | No user identity to bind to |
| MDM / server-managed settings | No fleet to manage |
| LLM classifier approval | Nondeterministic + slow; sandbox covers the same ground |

Threat model stays simple:

- **Prompt injection** from tool outputs (web, MCP, file contents)
- **Malicious / untrusted cloned repos** trying to weaken local config
- **Model mistakes** (rm wrong path, force-push, write secrets)

Not in scope: a malicious local user with admin rights on their own machine.

---

## 2. What ADR 0019 already got right (keep)

| Piece | Keep? | Note |
|-------|-------|------|
| Rule engine deny→ask→allow | Yes | Pure, testable, Claude-compatible |
| Layered rules: bundled → user → project | Yes | Untrusted project drops `allow` — correct |
| Modes: `auto` / `ask-all` / `bypass` | Mostly | Refine semantics; see §4 |
| File-write gate (secret deny, out-of-project ask) | Yes | Largest security win of ADR 0019 |
| MCP: enabled server = trusted | Yes | Avoids prompt fatigue; rules can still deny/ask |
| Project trust + bypass guard | Yes | Untrusted repo cannot disable prompts |
| Remembered allow (bash exact, path prefix) | Yes | Add `session` scope only |
| Non-interactive ask → deny | Yes | CLI safety |

Do **not** rewrite the rule engine. Extend around it.

---

## 3. The mature model: two axes, one user-facing knob

### 3.1 Internally: two axes

```
Capability (OS-enforced)          Approval (rule engine)
─────────────────────────         ──────────────────────
SandboxProfile                    PermissionMode + rules
  writable roots                    deny → ask → allow
  network on/off/allowlist          once | session | project remember
  Seatbelt / Landlock / bwrap
```

An action must pass **both**. Sandboxed `pnpm test` can auto-run. Leaving the
sandbox (write outside workspace, open network) either asks or is denied.

### 3.2 Externally: three Run Modes (Cursor-shaped, no LLM classifier)

Users should not configure "sandbox mode" and "approval policy" separately.
Ship **three Run Modes** that set both. This is the Cursor Run Modes idea,
minus the Auto-review LLM classifier (we use deterministic rules + sandbox
instead — cheaper, predictable, no extra model call).

| Run Mode | UI label | Sandbox | Approval | When |
|----------|----------|---------|----------|------|
| `ask` | 每次询问 / Ask | workspace-write, network off | ask almost everything | Sensitive machine / untrusted work |
| `auto` (default) | 自动 / Auto | workspace-write, network off | low friction inside sandbox; ask to leave it | Daily coding |
| `yolo` | 放行 / YOLO | none (full host) | no prompts except hard deny + circuit breakers | Disposable VM / CI you own |

**Decision locked: `auto` defaults sandbox ON** (option A). First-time
`npm install` / out-of-workspace writes will ask to leave the sandbox; user
can "Allow for session". That is the intended tradeoff.

#### vs Cursor Run Modes

| Cursor | piwin | Notes |
|--------|-------|-------|
| Auto-review (allowlist → sandbox → LLM classifier) | **Auto** (rules → sandbox → ask if leave) | Same shape; classifier replaced by rule engine + leave-sandbox prompt |
| Allowlist | not a separate mode | Covered by `permissions.json` allow rules + "Allow for session/project" remember |
| Run Everything | **YOLO** | Same idea; we keep circuit breakers |
| *(no first-class ask-all)* | **Ask** | Explicit paranoid mode; Cursor users approximate this by empty allowlist |

We deliberately do **not** ship a fourth "智能审查" mode that calls an LLM.
"Auto" is already the smart default: allowlist/rules first, sandbox second,
human only when leaving the boundary.

#### Mapping to today's modes

| Today | Becomes |
|-------|---------|
| `auto` | `auto` (now sandboxed — soft break, see §7) |
| `ask-all` | `ask` |
| `bypass` | `yolo` |

CLI:

```bash
piwin chat "fix tests"                    # auto
piwin chat "go" --permission-mode ask
piwin chat "ci" --yolo                    # full access; prints warning
```

`--permission-mode ask-all` and `--dangerously-bypass-permissions` stay as
aliases of `ask` / `yolo`.

### 3.3 Two orthogonal controls (do not merge them)

piwin already has **Agent mode** in the composer (`Agent` / `Plan` / `Debug` /
`Ask` via `+` menu and `/` slash). That is a **collaboration intent** control
(prompt preamble: "don't implement", "debug root cause", …).

**Run Mode** is a **tool execution** control (sandbox + approval). Keep them
separate — Cursor does the same (Agent modes vs Approvals & Execution).

| Control | Lives | Changes |
|---------|-------|---------|
| Agent mode | `+` menu, `/plan` slash, mode chip | What the model is asked to do |
| Run Mode | composer toolbar pill (new) | What tools may do without asking |

**Soft link (not a merge):** when Agent mode is `plan` or `ask`, the host
raises a **read-only floor** for that session turn (sandbox `read-only`,
mutators always ask) even if Run Mode is `auto`. Switching back to Agent
mode `agent` restores the selected Run Mode. User can still pick Run Mode
`yolo` while in Plan/Ask — we show a one-line warning, we do not hard-block
(power users exist). Locked decision.

### 3.4 Composer UX — Run Mode pill (primary surface)

Primary control is **in the input box toolbar**, not buried in Settings.
Pattern matches the existing ThinkingEffortControl popover.

```
composer toolbar
┌──────────────────────────────────────────────────────────────────┐
│ [+] [expand] [Plan chip?]          [Auto ▾] [Model · thinking] [◎] [↑] │
│                                     ^^^^^^^^                              │
│                                     Run Mode pill                         │
└──────────────────────────────────────────────────────────────────┘
```

**Pill states**

| Mode | Pill text | Tone |
|------|-----------|------|
| `auto` | Auto | neutral (default) |
| `ask` | Ask | neutral |
| `yolo` | YOLO | warning (amber), same as today's bypass badge |

**Popover content** (click pill, open upward like thinking control):

```
Run mode                          [Manage rules… → Settings]

● 自动 Auto
  沙箱内自动执行；离开项目或出网时询问

○ 每次询问 Ask
  几乎每个工具都确认（仍在沙箱内）

○ 放行 YOLO
  关闭沙箱，跳过常规确认
  危险操作（删根目录、写密钥）仍会拦截
  ⚠ 未信任项目不可用
```

Footer link "Manage rules…" opens Settings → Permissions (rule files,
remembered list). Day-to-day switching never needs Settings.

**Scope of the selection**

| Scope | Behavior |
|-------|----------|
| Default | Session-level override (in memory). Does not rewrite `config.json`. |
| Persist | Popover footer: "设为默认" writes `config.permissions.preset`. |
| Untrusted project | Selecting YOLO is disabled / immediately downgraded to Auto with toast. |

**During a run:** pill stays clickable; change applies to the **next** tool
call in the active session (host re-resolves preset; no session restart).
If that is hard in v1, document "applies next turn" and keep it simple.

**Context bar badge:** demote to read-only status (or remove). Composer pill
is the only interactive control — avoid two places that edit the same thing.

**Permission prompt actions** (when agent asks):

```
[Deny]  [Allow once]  [Allow for session]  [Allow for project]
```

Default focus: **Allow for session**. "Allow for project" is secondary
(exact bash / path-prefix remember, same as today).

### 3.5 Why this is "mature" not "enterprise"

Codex default = workspace-write sandbox + on-request approval.
Claude Code = `/sandbox` auto-allow for sandboxed commands.
Cursor = Run Modes in settings + sandbox layer.
Gemini = trusted folders + sandbox.

piwin = same idea, three presets, control on the composer, no admin plane,
no LLM classifier.

---

## 4. Approval axis refinements (small, high value)

### 4.1 Circuit breakers always ask

Even in `yolo` / sandboxed-bypass, these still prompt (or deny non-interactive):

- Root / home recursive delete (`rm -rf /`, `rm -rf ~`)
- Secret path writes (`~/.ssh/**`, `**/.env`, keys, credentials)
- Force-push to main/master (optional; keep as bundled ask)

This matches Claude Code's circuit breaker and stops the scariest model errors.
Today's `bypass` allows everything except deny rules — too hot for a personal
tool that people will actually leave on.

### 4.2 Approval scopes: once | session | project

Today: once / project. Add **session** (in-memory for this session only).

Default when prompting: offer the three, preselect the narrowest that still
unblocks the task (usually `session` for bash, `project` only when user
explicitly wants it).

Remembered storage stays in `~/.piwin/projects.json` for project scope;
session scope lives only in the host process.

### 4.3 Bash network hole (conceptual fix)

Today `web_fetch` is gated, but `curl` inside bash is only blocked if it
matches a deny regex. With a sandbox whose default network is **off**,
subprocess egress is blocked at the OS level. Tool-mediated network
(`web_fetch` / `web_search`) stays on the approval axis and is host-controlled.

That is the clean split:

| Path | Gate |
|------|------|
| `web_fetch` / `web_search` tools | Approval rules (host implements the request) |
| `curl` / `npm install` / any subprocess net | Sandbox network policy |

### 4.4 MCP stays simple

Keep: enabled server = trusted; rules can deny/ask specific tools.

Optional later (not blocking): honor MCP `destructiveHint` /
`requiresUserInteraction` as *extra* ask signals (never as allow signals).
Skip per-tool admin catalogs.

### 4.5 Untrusted project (already good)

Keep current behavior:

- Project-layer `allow` rules dropped
- `yolo` / bypass refused → downgrade to `auto`
- Project `deny`/`ask` still apply

Untrusted is **not** full read-only. For read-only work, use Agent mode
`plan` / `ask` (raises the read-only floor) or Run Mode `ask`.
Don't invent a third trust state.

---

## 5. Capability axis: sandbox (the real missing piece)

### 5.1 Profiles (internal)

```ts
type SandboxProfileName = 'read-only' | 'workspace' | 'none';

interface SandboxProfile {
  name: SandboxProfileName;
  /** Writable roots. 'workspace' = session cwd (+ optional extra roots). */
  writableRoots: 'workspace' | string[];
  /** Always denied even if under a writable root. */
  denyGlobs: string[];   // default: **/.env, **/.env.*, **/*.pem, ~/.ssh/**, ~/.piwin/**
  network: 'off' | 'on'; // v1: binary. Allowlist is a later refinement.
}
```

| Profile | Writable | Network | Used by |
|---------|----------|---------|---------|
| `read-only` | none (workspace readable) | off | `plan` |
| `workspace` | workspace + tmp | off | `auto`, `ask-all` |
| `none` | unrestricted | on | `yolo` |

### 5.2 Platform enforcement (honest)

| Platform | Mechanism | Notes |
|----------|-----------|-------|
| macOS | Seatbelt (`sandbox-exec`) | Built-in; Claude/Codex use this |
| Linux / WSL2 | Landlock + seccomp, or bubblewrap | Same stack as Claude |
| Windows native | Not v1 | Document: use WSL2, or `yolo` with eyes open |

**Fail mode**: if sandbox cannot start and preset requires it (`auto` /
`ask-all` / `plan`), **warn and fall back to approval-only** (today's
behavior). Optional config `sandbox.required = true` for people who want
fail-closed. Default fail-open keeps the tool usable on odd platforms.

### 5.3 Composition with bash / file tools

```
tool call
  → approval axis (rules + mode + remember)
  → if deny: stop
  → if ask: prompt (once/session/project)
  → if allow: run inside sandbox profile for this preset
  → sandbox violation → fail the command (do not silently re-run unsandboxed)
```

Escape hatch: if a command *cannot* run sandboxed (needs network, needs path
outside workspace), surface a clear "needs to leave sandbox" approval with
reason. User can allow once / session / project. Do **not** auto-unsandbox.

### 5.4 Network allowlist — later, not v1

v1 network is off/on only. Domain allowlists (npm, pypi, github) need a proxy
on every platform and are a separate ADR. Until then:

- Default `auto`: network off in sandbox; use `web_fetch` / `web_search` tools
  for internet, or approve leaving sandbox for `npm install` etc.
- Power users who hate this can use `yolo` or add a user rule + leave-sandbox
  remember for their package manager.

---

## 6. Target shape (minimal contract additions)

```ts
// packages/contracts — extend permission.ts

/** User-facing Run Modes (composer pill). */
export type PermissionPreset = 'ask' | 'auto' | 'yolo';

/** Keep for rules / internal evaluation; map from preset. */
export type PermissionMode = 'auto' | 'ask-all' | 'bypass';

export type ApprovalScope = 'once' | 'session' | 'project';

export type SandboxProfileName = 'read-only' | 'workspace' | 'none';

export type SandboxProfile = {
  name: SandboxProfileName;
  writableRoots: 'workspace' | string[];
  denyGlobs: string[];
  network: 'off' | 'on';
};

export type PermissionConfig = {
  /** Default Run Mode for new sessions. */
  preset: PermissionPreset;          // default 'auto'
  /** If true, refuse to start when sandbox cannot be created. */
  sandboxRequired?: boolean;         // default false
};
```

Preset → internal mapping (pure function):

```ts
function resolvePreset(
  preset: PermissionPreset,
  agentMode: 'agent' | 'plan' | 'debug' | 'ask',
): {
  mode: PermissionMode;
  sandbox: SandboxProfileName;
} {
  // Soft floor: Plan/Ask agent modes raise read-only even under Auto.
  // YOLO under Plan/Ask is allowed (locked decision) — UI warns, host does not hard-block.
  if (agentMode === 'plan' || agentMode === 'ask') {
    if (preset === 'yolo') {
      return { mode: 'bypass', sandbox: 'none' }; // allowed with UI warning
    }
    return { mode: 'ask-all', sandbox: 'read-only' };
  }
  switch (preset) {
    case 'ask':  return { mode: 'ask-all', sandbox: 'workspace' };
    case 'auto': return { mode: 'auto',    sandbox: 'workspace' };
    case 'yolo': return { mode: 'bypass',  sandbox: 'none' };
  }
}
```

Rule files, rule engine, loaders: **unchanged**.

---

## 7. Migration from today

| Concern | Migration |
|---------|-----------|
| `config.permissions.mode` | Accept old field; map `auto`→`auto`, `ask-all`→`ask`, `bypass`→`yolo`. Prefer writing `preset` going forward. |
| CLI `--permission-mode` | Keep values `auto` / `ask-all` / `bypass`; also accept `ask` / `yolo`. |
| `--dangerously-bypass-permissions` | Alias of `--yolo`. |
| Existing `permissions.json` | No change. |
| Remembered allowlists | No change; add session scope in memory only. |
| Behavior of `auto` | **Soft break (locked)**: becomes sandboxed by default. Escape hatch is leave-sandbox approval or `yolo`. |
| Context bar mode badge | Demote to status or remove; composer pill is the control. |
| Settings → Permissions | Keep for rules + remembered list + "default Run Mode"; day-to-day switching is the composer pill. |

No data migration scripts. One release note + guide update is enough.

---

## 8. Phasing (ship small)

### Phase 1 — Run Mode pill + circuit breakers + session scope
- Introduce `PermissionPreset` (`ask` / `auto` / `yolo`) + mapping; keep old mode flags working.
- Composer toolbar Run Mode pill + popover (primary UX).
- Soft link: Agent mode `plan`/`ask` → read-only floor.
- Circuit breakers always ask (even under yolo).
- Add `session` approval scope on permission prompts.
- Demote context-bar badge; Settings page becomes rules + default preset.
- Docs: rewrite permissions guide around Run Modes.
- **No sandbox yet** — still approval-only under the hood, but the user model is clean.

### Phase 2 — Workspace sandbox (FS only, default ON for auto/ask)
- Implement `workspace` + `read-only` on macOS (Seatbelt) and Linux (Landlock/bwrap).
- Wire bash + file tools to run inside profile.
- Leave-sandbox approval path ("Allow once / session / project").
- `sandboxRequired` config (default false = fail-open with warning).
- Windows: document WSL2 / fall back to approval-only with warning.

### Phase 3 — Polish (optional, separate small ADRs)
- MCP `destructiveHint` / `requiresUserInteraction` as extra ask.
- Network allowlist inside sandbox (if people actually need it).
- Stronger bash matching (prefix rules like Codex) if glob bypasses become a real issue.

---

## 9. What "done" looks like for a personal tool

A user should be able to say:

1. **Default day**: open project, trust it once, leave Run Mode on **Auto**.
   Agent edits and runs tests inside the project without nagging. Leaving the
   project or opening the network asks once; "Allow for session" is enough.
2. **Read-only review**: switch Agent mode to **Plan** / **Ask** (composer `+`
   menu). Hard floor: read-only sandbox, mutators ask.
3. **Paranoid day**: flip composer pill to **Ask**. Everything asks; sandbox
   still holds.
4. **Throwaway VM / own CI**: flip to **YOLO** (or `--yolo`). Full host, still
   blocked on hard deny and circuit breakers, with a loud warning.
5. **Power user**: edit `~/.piwin/permissions.json` for personal allow/deny;
   check in project `.piwin/permissions.json` for shared caution rules.
   Untrusted clones cannot grant themselves allow.

Day-to-day: only the composer pill. Settings only for rules and remembered list.

---

## 10. Decisions & remaining open questions

### Locked

1. **`auto` defaults sandbox ON** (option A). Leave-sandbox approval is the
   escape hatch until network allowlist exists.
2. **Three Run Modes only**: `ask` / `auto` / `yolo`. No LLM "智能审查" mode.
3. **Composer pill is the primary control**; Settings is secondary.
4. **Agent mode ≠ Run Mode**; Plan/Ask agent modes raise a read-only floor.
5. **UI label is "YOLO"** (not "Bypass"/"放行"). CLI keeps
   `--dangerously-bypass-permissions` as alias of `--yolo`.
6. **YOLO under Plan/Ask is allowed with a one-line warning** (not hard-disabled).
   Power users get the escape hatch; the warning keeps it honest.

### Still open

1. **General scope (no project)**: sandbox root = cwd? Lean yes.
2. **Run Mode change mid-run**: apply to next tool call vs next turn? Lean
   next tool call if cheap; else next turn.
