# Permissions guide

| Field | Value |
|-------|-------|
| Status | Living document |
| Related | [ADR 0019](../adr/0019-permission-rule-engine.md), [ADR 0024](../adr/0024-run-modes-and-sandbox.md), [ADR 0033](../adr/0033-mcp-supervisor-architecture.md), [Architecture §3.4](../architecture.md#34-permission-system) |

piwin gates the tools an agent can run — bash commands, file writes, network
fetches, and agent browser navigation — through a host-owned permission system built on
two orthogonal axes:

1. **Run Mode** (ADR 0024) — a user-facing preset that collapses the sandbox
   boundary and the approval friction into one three-state switch.
2. **Rule engine** (ADR 0019) — layered `deny`/`ask`/`allow` rules that refine
   what each mode actually permits.

This guide explains both.

> **Sandbox note (ADR 0024):** `auto` and `ask` modes run the agent inside an
> OS-level sandbox (Seatbelt on macOS, Landlock on Linux). `yolo` disables the
> sandbox. The rule engine still applies in all modes — it is the approval
> layer on top of the sandbox boundary.

---

## Run Modes

The Run Mode controls the sandbox boundary and how often the agent asks before
running tools. Set it from the composer toolbar pill (Desktop), Settings →
Permissions, or via CLI flags.

| Mode | Sandbox | Behavior |
|------|---------|----------|
| `auto` | On | Low-friction inside the sandbox. Safe commands and in-project writes run without prompts; leaving the workspace or opening network asks. |
| `ask` | On | Prompts on almost every tool call (still sandboxed). Use when you want to watch every step. |
| `yolo` (default) | Off | No sandbox, no routine **in-project** prompts. **Leaving the workspace still asks.** Circuit breakers still fire (see below). Refused for untrusted projects (downgraded to `auto`). |

### Circuit breakers (apply in all modes, including `yolo`)

Even in `yolo`, these actions always prompt (or are denied non-interactively):

- Paths outside the project root — bash tokens like `cd /tmp`, `cat ~/…`, `..`, and `write`/`edit` to an out-of-project path.
- `rm -rf /` and equivalent root-deletion patterns.
- Writes to secret paths (`~/.ssh/**`, `**/.env`, `**/*.pem`, `**/id_rsa`, …).
- Force-push to `main` / `master`.
- Any `deny` rule that matches.

Circuit breakers cannot be allowed away by project rules or `yolo` mode.

### YOLO guard

A freshly-cloned, untrusted project cannot disable the sandbox by editing its
own config — `yolo` is refused and downgraded to `auto` with a warning. Trust
the project first (Settings → Projects) if you want `yolo` to apply. General
scope (no project open) may use `yolo` (your machine, your choice).

### CLI flags

```bash
# Override the configured Run Mode for one session
piwin chat "fix the tests" --permission-mode ask
piwin chat "go wild" --yolo

# Legacy mode values still accepted (backward compat)
piwin chat "fix the tests" --permission-mode ask-all
piwin host serve --permission-mode auto

# Dangerous alias for yolo (prints a stderr warning)
piwin chat "go wild" --dangerously-bypass-permissions
```

`--permission-mode` accepts both new preset values (`ask`/`auto`/`yolo`) and
legacy mode values (`auto`/`ask-all`/`bypass`). `--yolo` is a shorthand for
`--permission-mode yolo`. The flag takes precedence over
`config.permissions.preset`. When no flag is present, the configured preset
from `~/.piwin/config.json` applies.

---

## Rule files

Rules live in `permissions.json` files at three layers. They merge: **deny at
any layer beats allow at any layer** (evaluation is deny → ask → allow, first
match wins).

| Layer | Path | When `allow` rules apply |
|-------|------|--------------------------|
| User global | `~/.piwin/permissions.json` | Always (your machine, your choice) |
| Project shared | `<project>/.piwin/permissions.json` (check in) | Only when the project is **trusted** |
| Project local | `<project>/.piwin/permissions.local.json` (gitignore) | Only when the project is **trusted** |

> **Add `permissions.local.json` to your `.gitignore`.** It is meant for
> personal overrides that should not be shared.

Bundled safety defaults (deny for pipe-to-shell, secret file writes, etc.; ask
for `sudo`, `rm -rf`, force-push) always apply and cannot be allowed away by
lower layers.

## Browser navigation

Agent `browser_navigate` (and `browser_reload`, which reuses the same action) is
host-gated separately from `web_fetch`:

- **Loopback** (`localhost`, `127.0.0.1`, `::1`) is allowed by default so local
  dev servers can be previewed.
- Other private / link-local / cloud-metadata hosts default to **ask** (SSRF).
- Public hosts default to **ask**, or **allow** in `bypass`.
- Agent tools only accept `http:` / `https:`. User URL-bar navigation may open
  `file:` pages; that is not a `browser_navigate` permission.
- v1 matches existing **`web-fetch` hostGlob** rules. There is no separate
  `browser` rule kind yet.

Other `browser_*` writes (click, hover, select, check, type, lock, restart,
viewport set, tabs new/select/close, dialog) follow the
interaction policy: `ask-all` prompts, otherwise allow. `browser_upload` is
gated as a file-write on the Host path. Read tools
(`snapshot`, `find`, `wait`, `wait_for`, `status`, viewport query, tabs list,
console, network) are read-only.

### File format

```json
{
  "version": 1,
  "deny": [
    {
      "target": { "kind": "bash", "pattern": "rm -rf /" },
      "decision": "deny",
      "reason": "never-delete-root"
    }
  ],
  "ask": [
    {
      "target": { "kind": "file-write", "pathGlob": "~/projects/legacy/**" },
      "decision": "ask",
      "reason": "legacy-code-review"
    }
  ],
  "allow": [
    {
      "target": { "kind": "bash", "pattern": "cargo *" },
      "decision": "allow",
      "reason": "cargo-safe"
    }
  ]
}
```

- `version` must be `1`.
- Each rule's `decision` must match its bucket (`deny`/`ask`/`allow`).
- `reason` is a short, stable string shown in prompts and logs.
- Malformed rules are dropped with a console warning; the rest of the file
  still loads.

### Rule kinds

| Kind | Target field | Matches | Notes |
|------|--------------|---------|-------|
| `bash` | `pattern` | Glob over the command string (`*` = any chars). Bundled rules may use `re:` prefix for regex. | Case-insensitive. |
| `file-write` | `pathGlob` | Glob over the resolved absolute path. `~` expands to your home directory at load time. `*` matches within a path segment; `**` matches across segments. | Both `writeFile` and `mkdir` are gated. |
| `web-fetch` | `hostGlob` | Glob over the URL hostname. `*.example.com` matches subdomains. | Domain defaults (private/local deny, public ask) still apply when no rule matches. |
| `web-search` | — | Any web search. | |

`git`, `process`, and `notes-mutate` kinds are reserved in the contracts but
not yet migrated to the rule engine. Force-push stays a bundled **bash ask**
rule; process start/stop and notes mutations keep their existing ask behavior.

---

## Allow / deny / ask — how evaluation works

For each gated tool call the host builds a **subject** (the concrete command,
path, or host) and evaluates it against the merged rule set:

1. **Deny tier** — if any deny rule matches, the action is blocked (no prompt).
2. **Ask tier** — if any ask rule matches, the action prompts (or is denied
   non-interactively in the CLI).
3. **Allow tier** — if any allow rule matches, the action runs.
4. **No match** — the domain default applies, modified by the Run Mode
   (see the modes table above).

Because tiers are ordered (not specificity-ranked), a broader bundled `ask`
beats a more specific user `allow`. You cannot allow-away bundled ask rules
like `~/.config/**` with a more specific allow; you would need to edit the ask
list (a full rule editor is a follow-up; for now edit `permissions.json`).

---

## File-write gate

Every `write` and `edit` tool call is gated:

- **Denied** (no prompt): secret paths — `~/.ssh/**`, `~/.piwin/**`, `**/.env`,
  `**/*.pem`, `**/id_rsa`, `**/credentials.json`, `**/secrets.*`, etc.
- **Ask**: paths outside the project root (all modes, including `yolo`), and
  `~/.config/**` (sensitive but sometimes legitimate).
- **Allow**: paths inside the project root in `auto` and `yolo`; in `ask` project
  writes still ask unless an `allow` rule matches.

The gate resolves symlinks (`realpath`) before checking, so a symlink that
points outside the project is treated as an out-of-project write.

---

## MCP execution boundary

MCP is outside this permission system. Adding or enabling a server in
`~/.piwin/mcp.json` is the user's trust decision. Its tools never produce
per-call permission prompts and do not consult `permissions.json`, permission
modes, or project trust. MCP servers run with the Host user's OS permissions;
this is not an OS sandbox.

`@piwin/host-runtime` owns one `McpSupervisor` per Host. The default model tool
surface is `piwin_toolbox` (`search` / `describe` / `call` / `status`); direct MCP tools are exposed only when
explicitly pinned. Both paths use the same Supervisor, which owns the process
from spawn through timeout, config replacement, and shutdown.

If an old `permissions.json` contains `mcp` rules, piwin silently ignores them
(it may emit one diagnostic log entry). They are not migrated or upgraded and
cannot block or prompt. `~/.piwin/mcp.json` remains active. Use the MCP server
configuration itself to add, disable, or remove a server.

---

## Project trust

A project is either **trusted** or **untrusted** (set in Settings → Projects,
or by opening it and confirming trust).

| Concern | Untrusted project | Trusted project |
|---------|-------------------|-----------------|
| `yolo` mode | Refused → downgraded to `auto` + warning | Applies as configured |
| Project-layer `allow` rules | **Dropped** at load time | Loaded |
| Project `deny`/`ask` rules | Always apply | Always apply |
| Out-of-project writes / public network in `auto` | ask | ask |

Untrusted is **not** a full read-only sandbox — the agent can still run safe
bash and write inside the project. It blocks `yolo` and untrusted project allow
rules so a cloned repo cannot weaken the agent's guardrails.

---

## Remembered permissions ("Allow for session / project")

When a prompt appears in the Desktop UI, you can choose:

- **Allow for session** (default) — remembers the approval for the current
  session only (in-memory, cleared on close). Lowest commitment.
- **Allow once** — runs this one action, no persistence.
- **Allow for project** — remembers the approval persistently for the current
  project (available for bash and file-write subjects).

### Approval scopes (ADR 0024)

| Scope | Lifetime | Storage |
|-------|----------|---------|
| `once` | Single action | None |
| `session` | Current session | In-memory (host process) |
| `project` | Persistent | `~/.piwin/projects.json` |

Remembered entries are stored in `~/.piwin/projects.json`:

- **bash**: the exact full command string, matched by **exact match only**.
  Approving `rm -rf /tmp/foo` does **not** auto-allow `rm -rf /tmp/foo /etc`.
  For broader reuse, add a glob rule to `permissions.json`.
- **file-write**: the resolved absolute path, matched by **path-safe prefix**
  (`path === stored || path.startsWith(stored + /)`). Approving a directory
  allows writes beneath it.

Revoke remembered permissions in Settings → Permissions (remembered list) or
via `project/permissions-revoke`. MCP has no permission remember/revoke entry.

### Concurrent prompts

One assistant turn can emit several gated tool calls at once. Host keeps a
pending ticket per `requestId`. Desktop shows them as a queue: the docked
approval bar is the head, with a "N more waiting" counter when siblings are
queued. Approving or denying the head surfaces the next ticket.

Desktop also calls `permission/pending-list` after reconnect, after a push
sequence gap, and after each resolve, so a dropped prompt can be recovered
instead of leaving the tool stuck in `running`.

Ask / general sessions use the same docked bar. A session that can trigger
gated tools (`web_search` under `ask-all`) must be able to resolve them.

Compound bash (`cd /x && ls foo/`) is evaluated per `&&` / `;` segment against
bundled allow rules; any segment that matches a deny rule still denies the
whole command. Session-scoped bash remembering stays **exact string match**.

---

## Where settings live

| Setting | Location |
|---------|----------|
| Run Mode preset | `~/.piwin/config.json` → `permissions.preset` |
| Legacy mode (backward compat) | `~/.piwin/config.json` → `permissions.mode` |
| User-global rules | `~/.piwin/permissions.json` |
| Project shared rules | `<project>/.piwin/permissions.json` |
| Project local rules | `<project>/.piwin/permissions.local.json` |
| Remembered allows (project scope) | `~/.piwin/projects.json` (per-project `bashAllowlist` / `fileWriteAllowlist`) |
| Remembered allows (session scope) | In-memory only (host process) |
| MCP servers | `~/.piwin/mcp.json` |

Rule files and Run Mode both take effect on the **next session** (no
hot-reload). Edit rules, then start a new session (or restart
`piwin host serve`) for them to apply. Session-scoped approvals are cleared
when the session closes.
