# Permissions guide

| Field | Value |
|-------|-------|
| Status | Living document |
| Related | [ADR 0019](../adr/0019-permission-rule-engine.md), [Architecture §3.4](../architecture.md#34-permission-system) |

piwin gates the tools an agent can run — bash commands, file writes, network
fetches, and MCP tool calls — through a host-owned permission system. This
guide explains how to configure it.

> **Honesty note:** the permission system is an **approval layer**, not an OS
> sandbox. It prompts and blocks; it does not isolate the agent process. For
> sensitive machines, prefer `ask-all` mode. A future ADR may add OS-level
> sandboxing (Seatbelt/Landlock).

---

## Permission modes

The mode controls how often the agent asks before running tools. Set it in
Settings → Permissions, or via the CLI flag `--permission-mode`.

| Mode | Behavior |
|------|----------|
| `auto` (default) | Low-friction. Safe commands and in-project writes run without prompts; out-of-project writes, public network, and unmatched bash (after deny + ask rules) ask. |
| `ask-all` | Prompts on every unmatched bash command and every file write (even in-project). Use on machines with sensitive material. |
| `bypass` | Allows all unmatched actions. **Deny rules are still enforced.** Refused for untrusted projects (downgraded to `auto`). General scope (no project) may use bypass. |

**Bypass guard:** a freshly-cloned, untrusted project cannot disable prompts by
editing its own `permissions.json` — `bypass` is refused and downgraded to
`auto` with a warning. Trust the project first (Settings → Projects) if you
want bypass to apply.

### CLI flags

```bash
# Override the configured mode for one session
piwin chat "fix the tests" --permission-mode ask-all
piwin host serve --permission-mode auto

# Dangerous alias for --permission-mode bypass (prints a stderr warning)
piwin chat "go wild" --dangerously-bypass-permissions
```

`--permission-mode` takes precedence over `config.permissions.mode`. An invalid
value (not `auto`/`ask-all`/`bypass`) exits with a usage error. When neither
flag is present, the configured mode from `~/.piwin/config.json` applies.

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
    },
    {
      "target": { "kind": "mcp", "selectorGlob": "github.*" },
      "decision": "allow",
      "reason": "github-trusted"
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
| `mcp` | `selectorGlob` | `serverId.toolName`; `*` wildcard for either part. | Enabled servers are trusted by default; rules add deny/ask gating. |

`git`, `process`, and `notes-mutate` kinds are reserved in the contracts but
not yet migrated to the rule engine. Force-push stays a bundled **bash ask**
rule; process start/stop and notes mutations keep their existing ask behavior.

---

## Allow / deny / ask — how evaluation works

For each tool call the host builds a **subject** (the concrete command, path,
host, or MCP selector) and evaluates it against the merged rule set:

1. **Deny tier** — if any deny rule matches, the action is blocked (no prompt).
2. **Ask tier** — if any ask rule matches, the action prompts (or is denied
   non-interactively in the CLI).
3. **Allow tier** — if any allow rule matches, the action runs.
4. **No match** — the domain default applies, modified by the permission mode
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
- **Ask**: paths outside the project root (in `auto` and `ask-all`), and
  `~/.config/**` (sensitive but sometimes legitimate).
- **Allow**: paths inside the project root in `auto`; in `ask-all` project
  writes still ask unless an `allow` rule matches.

The gate resolves symlinks (`realpath`) before checking, so a symlink that
points outside the project is treated as an out-of-project write.

---

## MCP server trust

**Once you enable an MCP server in `~/.piwin/mcp.json` (or Settings), all its
tools run without per-call permission prompts.** Server enablement is the trust
boundary — the moment of trust is adding the server, not each tool call.

- To gate specific tools, add `deny` or `ask` MCP rules in `permissions.json`
  (selector `serverId.toolName`, `*` wildcard supported).
- Risk classification and argument redaction still run for UI display.
- Disabled servers are never connected (the lifecycle manager refuses).

---

## Project trust

A project is either **trusted** or **untrusted** (set in Settings → Projects,
or by opening it and confirming trust).

| Concern | Untrusted project | Trusted project |
|---------|-------------------|-----------------|
| `bypass` mode | Refused → downgraded to `auto` + warning | Applies as configured |
| Project-layer `allow` rules | **Dropped** at load time | Loaded |
| Project `deny`/`ask` rules | Always apply | Always apply |
| Out-of-project writes / public network in `auto` | ask | ask |

Untrusted is **not** a full read-only sandbox — the agent can still run safe
bash and write inside the project. It blocks bypass and untrusted project allow
rules so a cloned repo cannot weaken the agent's guardrails.

---

## Remembered permissions ("Allow for project")

When a prompt appears in the Desktop UI, you can choose:

- **Allow once** — runs this one action, no persistence.
- **Allow for project** — remembers the approval for the current project
  (available for bash and file-write subjects).

Remembered entries are stored in `~/.piwin/projects.json`:

- **bash**: the exact full command string, matched by **exact match only**.
  Approving `rm -rf /tmp/foo` does **not** auto-allow `rm -rf /tmp/foo /etc`.
  For broader reuse, add a glob rule to `permissions.json`.
- **file-write**: the resolved absolute path, matched by **path-safe prefix**
  (`path === stored || path.startsWith(stored + /)`). Approving a directory
  allows writes beneath it.

Revoke remembered permissions in Settings → Permissions (remembered list) or
via `project/permissions-revoke`. MCP has no remember (server-gated).

---

## Where settings live

| Setting | Location |
|---------|----------|
| Permission mode | `~/.piwin/config.json` → `permissions.mode` |
| User-global rules | `~/.piwin/permissions.json` |
| Project shared rules | `<project>/.piwin/permissions.json` |
| Project local rules | `<project>/.piwin/permissions.local.json` |
| Remembered allows | `~/.piwin/projects.json` (per-project `bashAllowlist` / `fileWriteAllowlist`) |
| MCP servers | `~/.piwin/mcp.json` |

Rule files and mode both take effect on the **next session** (no hot-reload).
Edit rules, then start a new session (or restart `piwin host serve`) for them
to apply.
