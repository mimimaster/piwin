# Permission Rule Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ADR 0019 — a unified host-owned permission rule engine with
`auto`/`ask-all`/`bypass` modes, a file-write gate (the current largest blind
spot), project-scoped remember extended to bash and file-write, and first-tier
Desktop UI controls. MCP is handled separately by ADR 0033.

> **MCP scope superseded:** the MCP portions of this older execution plan are
> no longer implementation instructions. ADR 0033 moves MCP completely out of
> the permission rule engine, ignores legacy MCP rules, and defines the
> Host-owned Supervisor, gateway-only default, pinned direct exposure, and
> lifecycle tests. Follow [ADR 0033](../adr/0033-mcp-supervisor-architecture.md)
> for MCP; the remaining tasks in this plan cover bash, file-write, web, and
> general permission behavior.

**Architecture:** Contracts-first. New permission types in `@piwin/contracts` (`PermissionRuleTarget` for patterns, `PermissionSubject` for runtime); pure-function rule engine + glob matcher in `@piwin/agent-host`; file-write gate wraps Pi `write`/`edit` via `createWriteToolDefinition`/`createEditToolDefinition` with custom `operations` (thin `fs/promises` local ops after gate — **no** `createLocalWriteOperations` export exists); MCP is outside this rule engine (see ADR 0033); `@piwin/project` gains `bashAllowlist`/`fileWriteAllowlist` + path-safe match helpers + shared path-traversal helper; rule files loaded from `~/.piwin/permissions.json` + project `.piwin/permissions{,.local}.json` with **trust-aware project allow** (ADR 0019 §2); `config.json` holds only `mode`. No UI→FS, no apps→Pi, no circular deps. Dual host paths that register gated tools (SDK + RPC→SDK fallback) both wire the same gates. All new pure logic is unit-tested with golden cases (AGENTS.md §3.7), including **non-regression** of current bash deny/ask decisions.

**Tech Stack:** TypeScript (strict, NodeNext, ESM), vitest, pnpm workspace, Tauri 2 (desktop).

**ADR:** `docs/adr/0019-permission-rule-engine.md`

## Global Constraints

- TypeScript strict mode (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — never weaken without ADR.
- ESM only; relative imports use `.js` extensions (NodeNext).
- No `any`; prefer `unknown` + narrowing. No non-null assertion `!` except after runtime check in same block.
- No silent `catch {}` — AGENTS.md §3.3: log at boundary with context, or rethrow.
- Colocated tests: `foo.ts` + `foo.test.ts` in same `src/` dir.
- `pnpm typecheck` and `pnpm test` must stay green after every task.
- Node `>= 20`, pnpm `9.15.0` (see root `packageManager`).
- Keep diffs minimal — do not refactor unrelated code.
- Deny rules always enforced, even in `bypass` mode (ADR 0019 §3).
- MCP permission behavior: see ADR 0033; it is outside this rule engine.
- `PermissionConfig` in `PiwinConfig` holds only `mode`; rules live in separate `permissions.json` files (ADR 0019 §2).
- Git/process/notes as dedicated rule kinds are **deferred** (ADR 0019 §8); force-push stays covered by **bundled bash ask** rules (non-regression).
- **Non-regression:** existing `permission-policy.test.ts` bash ask/deny cases must keep the same decisions in `auto` — do not rewrite ask→allow to pass.
- Project-layer **allow** rules load only when project is **trusted** (ADR 0019 §2).
- Bash project remember: **exact** command match. File-write remember: **path-safe** prefix (`===` or `startsWith(stored + sep)`).
- Rules/mode apply at **session create**; mid-session config edits take effect next session.
- Web domain defaults stay in `evaluateWebPermission`; optional user/project web rules consulted when present (ADR 0019 §8 partial).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/contracts/src/permission.ts` | `PermissionMode`, `PermissionRuleTarget`, `PermissionSubject`, `PermissionRule`, `PermissionRuleSet`, `PermissionRulesFile`, `PermissionConfig`, helpers | Create |
| `packages/contracts/src/config.ts` | Add `permissions?: PermissionConfig` to `PiwinConfig` | Modify |
| `packages/contracts/src/project.ts` | Add `bashAllowlist`, `fileWriteAllowlist` to `ProjectRecord` | Modify |
| `packages/contracts/src/index.ts` | Export new permission types | Modify |
| `packages/project/src/path-traversal.ts` | Shared `escapesRoot` + `resolveInsideRoot` helpers (pure string) | Create |
| `packages/project/src/path-traversal.test.ts` | Path traversal golden tests | Create |
| `packages/project/src/allowlist-match.ts` | Exact bash match + path-safe file prefix match | Create |
| `packages/project/src/allowlist-match.test.ts` | Boundary footgun tests (`/tmp/foo` vs `/tmp/foobar`) | Create |
| `packages/project/src/project-store.ts` | Persist/revoke `bashAllowlist`/`fileWriteAllowlist` | Modify |
| `packages/project/src/index.ts` | Export new helpers + store functions | Modify |
| `packages/agent-host/src/permission-rule-engine.ts` | Pure rule engine: subject vs target, glob match, deny→ask→allow | Create |
| `packages/agent-host/src/permission-rule-engine.test.ts` | Golden tests for rule eval + layer merge | Create |
| `packages/agent-host/src/permission-defaults.ts` | Bundled deny/ask/allow (migrate DENY + ASK + expansions) | Create |
| `packages/agent-host/src/permission-rule-loader.ts` | Load + merge + trust-aware project allow drop | Create |
| `packages/agent-host/src/permission-rule-loader.test.ts` | Loader fixtures + untrusted drops allow | Create |
| `packages/agent-host/src/permission-policy.ts` | Delegate `evaluate*` to rule engine; add file-write; web rules optional | Modify |
| `packages/agent-host/src/permission-policy.test.ts` | Non-regression bash + mode + file-write goldens | Modify |
| `packages/agent-host/src/permission-context.ts` | Explicit `file-write` / `bash` action kinds | Modify |
| `packages/agent-host/src/gated-file-tools.ts` | Wrap Pi `write`/`edit` (`writeFile` + `mkdir`) | Create |
| `packages/agent-host/src/gated-file-tools.test.ts` | File-write gate golden tests | Create |
| `packages/agent-host/src/gated-bash-tool.ts` | Rule engine + mode + exact allowlist | Modify |
| `packages/agent-host/src/mcp-call-permission.ts` | Stop per-call prompt; keep risk + redaction | Modify |
| `packages/agent-host/src/mcp-session-bridge.ts` | Align with non-prompt default | Modify |
| `packages/agent-host/src/mcp-gateway-tool.ts` | Align with non-prompt default | Modify |
| `packages/agent-host/src/config-store.ts` | Normalize `permissions.mode` | Modify |
| `packages/agent-host/src/sdk-adapter.ts` | Wire gates + mode + rules into session | Modify |
| `packages/agent-host/src/rpc-adapter.ts` / session fallback path | Same gates if custom tools built there | Modify if needed |
| `packages/agent-host/src/host-runtime.ts` | `rememberProjectPermission` for bash/file-write | Modify |
| `packages/agent-host/src/index.ts` | Export new public API | Modify |
| `apps/desktop/src/settings/section-registry.ts` | Add `permissions` section id | Modify |
| `apps/desktop/src/settings/pages/permissions-page.tsx` | Mode switcher + trust hint + ask-beats-allow note | Create |
| `apps/desktop/src/permission-request-card.tsx` | Remember for command/file-write | Modify |
| `apps/desktop/src/app-dialogs.tsx` | "Allow for project" for bash/file-write | Modify |
| `apps/desktop/src/RememberedPermissionsSection.tsx` | Surface bash/file-write entries | Modify |
| `apps/desktop/src` (chat header/status) | Mode badge | Modify |
| `apps/cli/src` | `--permission-mode` / `--dangerously-bypass-permissions` | Modify |
| `docs/architecture.md` | Update §3.4 | Modify |
| `docs/adr/0014-mcp-lifecycle-hybrid-gateway.md` | Note §5 supersession | Modify |

---

## Task 1: Contracts — permission types and config

**Files:**
- Create: `packages/contracts/src/permission.ts`
- Modify: `packages/contracts/src/config.ts`
- Modify: `packages/contracts/src/project.ts`
- Modify: `packages/contracts/src/index.ts`

**Why:** ADR 0019 §1–3, §8. Contracts-first (AGENTS.md §1.3). Separate **rule target** (patterns) from **runtime subject** (concrete values).

- [ ] **Step 1: Create `packages/contracts/src/permission.ts`**

Define:
```ts
export type PermissionMode = 'auto' | 'ask-all' | 'bypass';

/** Pattern side of a rule. */
export type PermissionRuleTarget =
  | { kind: 'bash'; pattern: string }
  | { kind: 'file-write'; pathGlob: string }
  | { kind: 'web-fetch'; hostGlob: string }
  | { kind: 'web-search' }
  | { kind: 'mcp'; selectorGlob: string }
  | { kind: 'git'; pattern: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

/** Runtime value being evaluated (never reuse pathGlob for a concrete path). */
export type PermissionSubject =
  | { kind: 'bash'; command: string }
  | { kind: 'file-write'; path: string }
  | { kind: 'web-fetch'; host: string }
  | { kind: 'web-search' }
  | { kind: 'mcp'; selector: string }
  | { kind: 'git'; command: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

export type PermissionRule = {
  target: PermissionRuleTarget;
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
};

export type PermissionRuleSet = {
  deny: PermissionRule[];
  ask: PermissionRule[];
  allow: PermissionRule[];
};

/** On-disk shape for permissions.json files. */
export type PermissionRulesFile = {
  version: 1;
  deny?: PermissionRule[];
  ask?: PermissionRule[];
  allow?: PermissionRule[];
};

export type PermissionConfig = {
  mode: PermissionMode;
};

export function createDefaultPermissionConfig(): PermissionConfig {
  return { mode: 'auto' };
}

export function createEmptyRuleSet(): PermissionRuleSet {
  return { deny: [], ask: [], allow: [] };
}

export function mergeRuleSets(...sets: PermissionRuleSet[]): PermissionRuleSet {
  // Concatenate per bucket. Evaluation order (deny→ask→allow) is the engine.
  return {
    deny: sets.flatMap((s) => s.deny),
    ask: sets.flatMap((s) => s.ask),
    allow: sets.flatMap((s) => s.allow),
  };
}
```

- [ ] **Step 2: Add `permissions` to `PiwinConfig`**

In `packages/contracts/src/config.ts`, add `permissions?: PermissionConfig` (import from `./permission.js`). Additive optional field.

- [ ] **Step 3: Add allowlist fields to `ProjectRecord`**

In `packages/contracts/src/project.ts`, add to `ProjectRecord`:
```ts
  bashAllowlist?: string[];
  fileWriteAllowlist?: string[];
```
Optional, additive. `createEmptyNetworkPolicy` unchanged.

- [ ] **Step 4: Export from `packages/contracts/src/index.ts`**

Re-export everything from `./permission.js`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @piwin/contracts typecheck
```
Expected: PASS.

---

## Task 2: Project package — path traversal, allowlist match, persistence

**Files:**
- Create: `packages/project/src/path-traversal.ts` + `.test.ts`
- Create: `packages/project/src/allowlist-match.ts` + `.test.ts`
- Modify: `packages/project/src/project-store.ts`
- Modify: `packages/project/src/index.ts`
- Modify: `packages/agent-host/src/commands/project-commands.ts` (refactor to use helper)

**Why:** ADR 0019 §4, §6. Shared path-traversal; **safe** allowlist matching (no naive prefix footguns).

- [ ] **Step 1: Write failing tests for `escapesRoot` / `resolveInsideRoot`**

`path-traversal.test.ts`: `..` segments, absolute escapes detected; project-internal relative paths pass. **Pure string** — no `realpath`/FS.

- [ ] **Step 2: Implement `path-traversal.ts`**

Export `escapesRoot(rootAbs, candidateAbs): boolean` (normalize + `path.relative`, matching `project-commands.ts` ~124–133) and `resolveInsideRoot(rootAbs, relativeInput): { ok: true; absolute: string } | { ok: false; reason: string }`.

- [ ] **Step 3: Write failing tests for allowlist match**

`allowlist-match.test.ts`:
- `commandInBashAllowlist`: exact only — `rm -rf /tmp/foo` matches itself; does **not** match `rm -rf /tmp/foo /etc` or `rm -rf /tmp/foobar`.
- `pathInFileWriteAllowlist`: `/home/u/a` does **not** match `/home/u/ab`; `/home/u/dir` matches `/home/u/dir` and `/home/u/dir/file` (separator boundary); normalize trailing slashes consistently.

- [ ] **Step 4: Implement `allowlist-match.ts`**

```ts
export function commandInBashAllowlist(command: string, allowlist: readonly string[]): boolean;
export function pathInFileWriteAllowlist(absPath: string, allowlist: readonly string[]): boolean;
```

- [ ] **Step 5: Refactor `project-commands.ts` to use path helpers**

Replace inline `..` / `relativeToRoot` checks; behavior unchanged.

- [ ] **Step 6: Add `bashAllowlist`/`fileWriteAllowlist` to project-store**

Mirror network remember APIs:
- `addBashAllowRule(filePath, projectPath, command: string)` — push exact command if not present.
- `addFileWriteAllowRule(filePath, projectPath, absPath: string)` — push normalized abs path if not present.
- Extend `listRememberedPermissions` with keys `bash:<command>` and `file-write:<absPath>` (stable, reversible).
- Extend `revokeRememberedPermission` for those keys.

- [ ] **Step 7: Export from index + test**

```bash
pnpm --filter @piwin/project test
pnpm --filter @piwin/project typecheck
```
Expected: PASS.

---

## Task 3: Rule engine — pure function + glob matcher + bundled defaults

**Files:**
- Create: `packages/agent-host/src/permission-rule-engine.ts` + `.test.ts`
- Create: `packages/agent-host/src/permission-defaults.ts`

**Why:** ADR 0019 §1, §3.1. Core pure logic + non-regressive bundled bash deny/ask.

- [ ] **Step 1: Write failing golden tests for the engine**

`permission-rule-engine.test.ts`:
- deny → ask → allow order; first-match-wins within a tier; specificity does not override tier
- no-match → `'no-match'`
- bash glob: `npm run *` matches `npm run test`, not `npm uninstall`
- file-write path glob: `**/.env` matches `/x/.env`
- mcp selector: `github.*`
- subject vs target: evaluating `{ kind: 'file-write', path: '/abs/.env' }` against rules with `pathGlob`
- layer merge: deny from earlier layer beats allow from later (via `mergeRuleSets` + `evaluateRules`)
- ask beats allow: bundled ask for `~/.config/**` (after expand) beats user allow for more specific path

- [ ] **Step 2: Implement `permission-rule-engine.ts`**

Export:
- `matchBashGlob(pattern, command): boolean` — not shell-semantic; document
- `matchPathGlob(pattern, absPath): boolean` — supports `*` and `**`; pure string (patterns already `~`-expanded)
- `matchHostGlob(pattern, host): boolean`
- `matchSelectorGlob(pattern, selector): boolean`
- `evaluateRules(input: { subject: PermissionSubject; rules: PermissionRuleSet }): 'allow' | 'ask' | 'deny' | 'no-match'`

Prefer minimal inline glob (check for existing dep first; avoid new dep unless already present — AGENTS.md §3.10).

- [ ] **Step 3: Implement `permission-defaults.ts`**

Export bundled rules per ADR 0019 §3.1:

- `BUNDLED_DENY` — all current `DENY_PATTERNS` reasons + expansions (`chmod -R 777`, split-flag rm-root forms as documented)
- `BUNDLED_ASK` — **all** current `ASK_PATTERNS` as bash ask rules (`rm-recursive-force`, `sudo`, force-push, force-with-lease, write-env, chmod-777) **plus** file-write `~/.config/**` (store with `~`; loader expands)
- `BUNDLED_ALLOW` — safe-prefix bash list
- `createBundledRuleSet(): PermissionRuleSet`

Reasons should stay stable where possible (`rm-recursive-force`, etc.) so existing tests that assert `reason` still pass.

- [ ] **Step 4: Test + typecheck**

```bash
pnpm --filter @piwin/agent-host test -- src/permission-rule-engine.test.ts
```
Expected: PASS.

---

## Task 4: Rule file loader (trust-aware)

**Files:**
- Create: `packages/agent-host/src/permission-rule-loader.ts` + `.test.ts`

**Why:** ADR 0019 §2. Three layers + bundled; project **allow** only if trusted.

- [ ] **Step 1: Write failing tests for the loader**

`permission-rule-loader.test.ts` (temp dirs + fixtures):
- missing files → empty contribution (no throw)
- valid `version: 1` file → parsed
- invalid JSON / wrong version → skip + warn
- invalid rules (missing target.kind, decision≠bucket) dropped with warn
- merge order: bundled, user, project shared, project local
- **untrusted** project: project shared/local **allow** arrays omitted; deny/ask kept
- **trusted** project: allow arrays included
- `~` in path globs expanded when materializing

- [ ] **Step 2: Implement `permission-rule-loader.ts`**

```ts
export async function loadMergedPermissionRules(input: {
  piwinRoot: string;
  projectPath?: string;
  projectTrusted?: boolean; // default false when projectPath set but unknown
}): Promise<PermissionRuleSet>;
```

Logic:
1. Start with `createBundledRuleSet()` (expand `~` in bundled path globs).
2. Load `~/.piwin/permissions.json` — full deny/ask/allow.
3. If `projectPath`: load `<project>/.piwin/permissions.json` and `permissions.local.json`.
4. If `projectTrusted !== true`, strip `allow` from project shared/local before merge.
5. `mergeRuleSets(bundled, userGlobal, projectShared, projectLocal)`.
6. Return merged set.

On-disk validation: expect `PermissionRulesFile` (`version: 1`). Unknown version → warn + empty contribution.

- [ ] **Step 3: Test + typecheck**

```bash
pnpm --filter @piwin/agent-host test -- src/permission-rule-loader.test.ts
```
Expected: PASS.

---

## Task 5: Wire rule engine into `permission-policy.ts`

**Files:**
- Modify: `packages/agent-host/src/permission-policy.ts`
- Modify: `packages/agent-host/src/permission-policy.test.ts`
- Modify: `packages/agent-host/src/permission-context.ts`

**Why:** ADR 0019 §1, §3.1, §4, §8. Preserve public behavior; add file-write; optional web rules.

- [ ] **Step 1: Mode-aware bash via rules (non-regressive)**

```ts
export function evaluateBashPermission(
  command: string,
  mode: PermissionMode = 'auto',
  rules?: PermissionRuleSet,
): PermissionEvaluation;
```

Internally: `evaluateRules({ subject: { kind: 'bash', command }, rules: rules ?? createBundledRuleSet() })`. On match, map to decision + reason from the matching rule. On `'no-match'`: `allow` for `auto`/`bypass`, `ask` for `ask-all`.

**Existing tests must keep the same decisions** for rm-rf, sudo, force-push, pipe-to-shell, etc. (default mode `auto` + bundled rules). Add tests for `ask-all` unmatched → ask; do not flip old ask cases to allow.

- [ ] **Step 2: Add `evaluateFileWritePermission`**

```ts
export function evaluateFileWritePermission(input: {
  absPath: string;        // already realpath-resolved by caller when possible
  projectRoot: string;
  mode: PermissionMode;
  rules?: PermissionRuleSet;
}): PermissionEvaluation;
```

1. `evaluateRules({ subject: { kind: 'file-write', path: absPath }, rules })`.
2. On match → that decision.
3. On `'no-match'`:
   - `bypass` → allow (deny already handled)
   - if `escapesRoot(projectRoot, absPath)` → ask (`auto` / `ask-all`)
   - else in-project → allow in `auto`/`bypass`, ask in `ask-all`

Pure — no FS.

- [ ] **Step 3: Web — optional rules, keep domain defaults**

In `evaluateWebPermission` (or a thin wrapper used by session-tools): if `rules` provided, run `evaluateRules` for `web-fetch`/`web-search` subject first; on match use it; on `'no-match'` keep current private/local deny + public ask logic. Signature may gain optional `rules` + `mode` only if callers need mode for web later; default behavior unchanged when rules omitted.

- [ ] **Step 4: MCP risk — display only**

Retain `evaluateMcpToolCallRisk` for UI; document it no longer drives call decision (Task 7).

- [ ] **Step 5: Update `permission-context.ts`**

- `action === 'file-write'` or `action.startsWith('file-write:')` → `kind: 'file-write'`, paths from detail
- `action === 'bash'` or `action.startsWith('bash:')` → `kind: 'command'` explicitly

- [ ] **Step 6: Tests**

Golden file-write: secret deny, in-project allow auto, out-of-project ask, ask-all in-project ask, `~/.config/**` ask (after expand). Bash non-regression suite green.

```bash
pnpm --filter @piwin/agent-host test -- src/permission-policy.test.ts src/permission-context.test.ts
```
Expected: PASS.

---

## Task 6: File-write gate (`gated-file-tools.ts`)

**Files:**
- Create: `packages/agent-host/src/gated-file-tools.ts` + `.test.ts`
- Modify: `packages/agent-host/src/sdk-adapter.ts` (and RPC/fallback path if it builds custom tools)

**Why:** ADR 0019 §4, §9. Closes largest blind spot. Pi ops verified; implement local ops with `fs/promises` after gate.

- [ ] **Step 1: Write failing tests for the gate**

- secret paths (`.env`, under `~/.ssh`) → deny, no FS write
- out-of-project → ask via `requestPermission`
- in-project `auto` → allow without prompt
- `mkdir` outside project gated (not only `writeFile`)
- realpath / ENOENT path for new files
- `fileWriteAllowlist` path-safe match skips prompt

- [ ] **Step 2: Implement `gated-file-tools.ts`**

```ts
export async function buildGatedFileToolsDefinition(options: {
  cwd: string;
  mode: PermissionMode;
  rules: PermissionRuleSet;
  projectRoot: string;
  projectsFilePath: string;
  projectPath?: string;
  requestPermission?: ToolPermissionGate;
}): Promise<unknown[]> // Pi ToolDefinitions for write + edit
```

Logic:
1. Import `createWriteToolDefinition`, `createEditToolDefinition` from `@earendil-works/pi-coding-agent` (dynamic import pattern like gated-bash).
2. Build `WriteOperations` / `EditOperations` that:
   - resolve path absolute
   - `realpath` (ENOENT → pre-realpath abs)
   - check `pathInFileWriteAllowlist` if project allowlist loaded
   - `evaluateFileWritePermission`
   - on ask → `requestPermission` (`action: 'file-write'`, `detail: absPath`); non-interactive → deny
   - on deny → throw or return tool error (match bash style for consistency)
   - on allow → `fs.writeFile` / `fs.mkdir` / edit read+write
3. Gate **both** `writeFile` and `mkdir`. Edit: gate `writeFile` (and `access` only if needed for UX; permission is on write path).

- [ ] **Step 3: Wire into session create**

Same guard as gated bash (`!chatMode && !readonlySubagent`). Pass `mode` from `config.permissions?.mode ?? 'auto'`, merged rules from `loadMergedPermissionRules` (with `projectTrusted` from project store), `permissionProjectPath` as root.

Also ensure **RPC / SDK-fallback** path that registers custom tools gets the same wiring (search for `buildGatedBashToolDefinition` call sites; mirror each).

- [ ] **Step 4: Test + typecheck**

```bash
pnpm --filter @piwin/agent-host test -- src/gated-file-tools.test.ts
pnpm --filter @piwin/agent-host typecheck
```
Expected: PASS.

---

## Task 7: MCP — stop per-call prompting

**Files:**
- Modify: `packages/agent-host/src/mcp-call-permission.ts`
- Modify: `packages/agent-host/src/mcp-session-bridge.ts`
- Modify: `packages/agent-host/src/mcp-gateway-tool.ts`
- Modify: `packages/agent-host/src/permission-policy-mcp.test.ts`

**Why:** ADR 0019 §5.

- [ ] **Step 1: Change `assertMcpToolCallAllowed`**

1. Compute risk + redact args (unchanged).
2. `evaluateRules` with `{ kind: 'mcp', selector }` against merged ruleset (pass rules into options).
3. deny → throw; ask → prompt only if `requestPermission` (else non-interactive deny); allow or no-match → **allow** (enabled server = trusted).
4. Default: no MCP rules → no prompt.

- [ ] **Step 2: Update callers**

Keep optional `requestPermission` for explicit ask rules; pass ruleset from session.

- [ ] **Step 3: Tests**

Enabled + no rules → no prompt; explicit deny → blocked; explicit ask → prompts.

```bash
pnpm --filter @piwin/agent-host test -- src/mcp-session-bridge.test.ts src/permission-policy-mcp.test.ts
```
Expected: PASS.

---

## Task 8: Remember scope, bypass guard, gate allowlists

**Files:**
- Modify: `packages/agent-host/src/host-runtime.ts`
- Modify: `packages/agent-host/src/gated-bash-tool.ts`
- Modify: `packages/agent-host/src/gated-file-tools.ts`
- Modify: `packages/agent-host/src/config-store.ts`
- Modify: `packages/agent-host/src/sdk-adapter.ts` (trust at load)

**Why:** ADR 0019 §3, §6, §7.

- [ ] **Step 1: Normalize `permissions.mode` in `config-store.ts`**

`normalizePermissionConfig` → `{ mode: 'auto'|'ask-all'|'bypass' }`, default `'auto'`.

- [ ] **Step 2: Extend `rememberProjectPermission`**

In `host-runtime.ts` (currently network-only):
- bash actions → extract command (first `": "` remainder or structured detail), `addBashAllowRule` with **exact** string
- file-write actions → `addFileWriteAllowRule` with abs path
- network → unchanged

Add unit/integration coverage for exact-match remember (not prefix).

- [ ] **Step 3: Bypass guard + rule load trust**

At session create when loading rules:
- Resolve project trust via existing project store APIs.
- Pass `projectTrusted` into `loadMergedPermissionRules`.
- If `mode === 'bypass'` and project untrusted → effective mode `auto`, `host/log` warn.
- General scope (no project): bypass allowed.

- [ ] **Step 4: Gates consult allowlists with safe matchers**

Before prompt: bash uses `commandInBashAllowlist`; file-write uses `pathInFileWriteAllowlist`. Pass `projectsFilePath` + project path into bash options (mirror file-write).

- [ ] **Step 5: Test + typecheck**

```bash
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/agent-host typecheck
```
Expected: PASS.

---

## Task 9: CLI flags

**Files:**
- Modify: `apps/cli/src` (entry/flags — verify actual argv wiring)

**Why:** ADR 0019 §3.

- [ ] **Step 1: Add flags (session override, not persisted)**

- `--permission-mode <auto|ask-all|bypass>`
- `--dangerously-bypass-permissions` → bypass + stderr warning
- Untrusted project + bypass → host downgrades (Task 8)

- [ ] **Step 2: Smoke**

```bash
pnpm --filter @piwin/cli typecheck
# verify real CLI entry accepts the flag (adjust argv if needed)
pnpm dev:cli -- --permission-mode ask-all
```
Expected: starts without error.

---

## Task 10: Desktop UI — first-tier permission controls

**Files:**
- Modify: `apps/desktop/src/settings/section-registry.ts`
- Create: `apps/desktop/src/settings/pages/permissions-page.tsx`
- Modify: `apps/desktop/src/permission-request-card.tsx`
- Modify: `apps/desktop/src/app-dialogs.tsx`
- Modify: `apps/desktop/src/RememberedPermissionsSection.tsx`
- Modify: `apps/desktop/src` (mode badge)

**Why:** ADR 0019 §3 + first-tier UX.

### Control 1: Mode switcher (Settings → Permissions)

- [ ] **Step 1: Add `permissions` section**

`SettingsSectionId` + `SETTINGS_SECTIONS` under `application` (after `general`); translator label.

- [ ] **Step 2: Create `permissions-page.tsx`**

Select bound to `config.permissions?.mode ?? 'auto'`, save via `saveConfig`:
- **Auto** — low friction; danger/ask patterns still apply; deny always
- **Ask all** — unmatched bash + writes ask
- **Bypass** — everything except deny; refused for untrusted project

Copy notes:
- Bypass requires a **trusted project** when a project is open; general scope may bypass (ADR §3).
- Untrusted: project allow rules ignored; bypass refused.
- Ask-tier rules beat allow-tier rules (bundled `~/.config/**` ask cannot be allowed away by a more specific allow).
- Mode/rules apply on **next session**.
- MCP: enabled server = full tool access without per-call prompts.

### Control 2: "Allow for project"

- [ ] **Step 3: Extend `canRememberPermissionForProject`**

```ts
export function canRememberPermissionForProject(context, action): boolean {
  if (!context) return action.startsWith('network:');
  return context.kind === 'network' || context.kind === 'command' || context.kind === 'file-write';
}
```

- [ ] **Step 4: Verify dialog button** (flows to Task 8 remember) — smoke.

### Control 3: Remembered list

- [ ] **Step 5: Update `RememberedPermissionsSection` copy** to web + bash + file paths; list renders store output.

### Control 4: Trust hint

- [ ] **Step 6: Notices on permissions page** for untrusted vs trusted (bypass + project allow rules).

### Control 5: Mode badge

- [ ] **Step 7: Badge near chat header/status**; click → Settings → Permissions; warn color for bypass.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @piwin/desktop typecheck
pnpm typecheck
pnpm test
```
Expected: PASS.

---

## Task 11: Docs + architecture update

**Files:**
- Modify: `docs/architecture.md` §3.4
- Modify: `docs/adr/0014-mcp-lifecycle-hybrid-gateway.md`

**Why:** AGENTS.md §3.10.

- [ ] **Step 1: Update `architecture.md` §3.4**

Rule engine (deny→ask→allow, subject vs target), modes table, file-write gate, MCP server trust, project remember (exact bash / path-safe file), trust-aware project allow, rule files `version: 1`, first-tier UI, link ADR 0019. Note: not an OS sandbox.

- [ ] **Step 2: ADR 0014 supersession note**

At top or §5 of ADR 0014: superseded by ADR 0019 §5 for per-call MCP prompts; gateway/lifecycle/"MCP is not a sandbox" stand.

- [ ] **Step 3 (optional process): After implementation, flip ADR 0019 Status to Accepted.**

---

## Verification (whole plan)

```bash
pnpm typecheck
pnpm test
pnpm dev:cli   # smoke: bash, out-of-project write, MCP call
```

Exit criteria:

- `auto`: in-project write + safe-prefix bash + enabled-MCP run without prompt.
- `auto`: out-of-project write prompts; secret write denied; `~/.config/**` asks.
- `auto`: **non-regression** — `rm -rf …`, `sudo …`, `git push --force …` still **ask**; pipe-to-shell still **deny**.
- `ask-all`: in-project write and unmatched bash prompt.
- `bypass`: everything except deny; refused for untrusted projects; allowed for general scope.
- Untrusted project: project-file **allow** rules ignored; deny/ask from project still apply.
- Remember: bash exact only; file path-safe prefix; listed + revocable in Settings.
- Desktop: mode switcher, allow-for-project for bash/file-write, remembered list, mode badge.
- CLI flags work; dual host path that registers tools has both gates.
- Git/process/notes dedicated kinds unchanged; force-push still bash-ask.
- Existing permission tests pass without weakening assert decisions.

---

## Suggested PR split (optional)

| PR | Scope |
|----|--------|
| PR1 | Contracts + engine + defaults + loader + file-write gate + mode (no MCP behavior change) |
| PR2 | MCP server-level trust + tests |
| PR3 | Remember + UI + CLI + docs |

Reduces blast radius of MCP UX change.
