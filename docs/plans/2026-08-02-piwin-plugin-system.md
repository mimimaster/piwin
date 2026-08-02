# Piwin Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a thin plugin system for piwin that bundles **skills + MCP servers + secret declarations** into a single installable unit. A plugin is a directory containing a `plugin.json` manifest. Installation composes existing primitives (`installSkill`, `mcp.json` merge, keychain secrets) — no new runtime. Supports local paths, git URLs, a lightweight remote registry index (`plugins.json`), and a Codex manifest adapter.

**Architecture:** Contracts-first. New `@piwin/contracts/src/plugin.ts` defines `PluginManifest`, `PluginSecretDecl`, `InstalledPlugin`, `PluginInstallSource`. New `@piwin/marketplace/src/plugin/` modules implement manifest parsing, installation orchestration, installed-state store, Codex adapter, and registry fetch. `@piwin/agent-host/src/commands/plugin-commands.ts` wires IPC handlers (`plugins/install`, `plugins/list`, `plugins/uninstall`, `plugins/registry/list`, `plugins/secrets/collect`). CLI gets `plugin install|list|uninstall|registry` commands. Desktop panel is deferred (documented intentional CLI-first degradation).

**Tech Stack:** TypeScript (strict, NodeNext, ESM), vitest, pnpm workspace.

## Global Constraints

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — never weaken without ADR.
- ESM only; relative imports use `.js` extensions (NodeNext).
- No `any`; prefer `unknown` + narrowing. No non-null assertion `!` except after runtime check in same block.
- No silent `catch {}` — log at boundary with context, or rethrow.
- Colocated tests: `foo.ts` + `foo.test.ts` in same `src/` dir.
- `pnpm typecheck` and `pnpm test` must stay green after every task.
- Keep diffs minimal — do not refactor unrelated code.
- Secrets never logged; keychain refs only in persisted state. Secret values flow through `secretResolver.writeProviderSecret` and are never written to `installed.json`.
- Plugin manifests are **untrusted** — validate strictly, reject unknown top-level keys (fail closed).
- MCP server ids from plugins are namespaced as `plugin__<pluginId>__<serverId>` to avoid collisions with user-managed servers. Uninstall removes only plugin-owned server ids.
- Skills installed by a plugin are tracked in `installed.json` so uninstall can remove them. Skills are copied into `~/.piwin/skills/` (existing flow) — no separate plugin-skills tree.
- No new top-level packages. All plugin logic lives in `@piwin/marketplace` (already owns install primitives) + `@piwin/contracts` (types) + `@piwin/agent-host` (IPC).
- `exactOptionalPropertyTypes` is on: never assign `undefined` to optional fields — use conditional spread.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/contracts/src/plugin.ts` | Plugin manifest + secret decl + installed state types | Create (Task 1) |
| `packages/contracts/src/ipc.ts` | `plugins/*` HostCommand variants | Modify (Task 1) |
| `packages/contracts/src/index.ts` | export `plugin.js` | Modify (Task 1) |
| `packages/marketplace/src/plugin/manifest.ts` | parse + validate `plugin.json` | Create (Task 2) |
| `packages/marketplace/src/plugin/manifest.test.ts` | manifest validation golden cases | Create (Task 2) |
| `packages/marketplace/src/plugin/install-plugin.ts` | orchestrate: resolve → materialize → install skills → merge MCP → collect secrets → write state | Create (Task 3) |
| `packages/marketplace/src/plugin/install-plugin.test.ts` | install pipeline with temp dirs + mock keychain | Create (Task 3) |
| `packages/marketplace/src/plugin/plugin-store.ts` | `installed.json` read/write/list/remove | Create (Task 4) |
| `packages/marketplace/src/plugin/plugin-store.test.ts` | store CRUD tests | Create (Task 4) |
| `packages/marketplace/src/plugin/codex-adapter.ts` | convert Codex plugin manifest → piwin `PluginManifest` | Create (Task 5) |
| `packages/marketplace/src/plugin/codex-adapter.test.ts` | adapter golden cases | Create (Task 5) |
| `packages/marketplace/src/plugin/registry.ts` | fetch remote `plugins.json` index | Create (Task 6) |
| `packages/marketplace/src/plugin/registry.test.ts` | registry parse + fetch mock | Create (Task 6) |
| `packages/marketplace/src/plugin/secret-env.ts` | resolve `${SECRET_ENV}` placeholders in MCP env | Create (Task 3) |
| `packages/marketplace/src/index.ts` | export plugin modules | Modify (Task 3) |
| `packages/agent-host/src/commands/plugin-commands.ts` | IPC handlers for `plugins/*` | Create (Task 7) |
| `packages/agent-host/src/commands/plugin-commands.test.ts` | IPC handler fixtures | Create (Task 7) |
| `packages/agent-host/src/commands/domain-command-dispatch.ts` | register plugin commands | Modify (Task 7) |
| `apps/cli/src/commands/plugin.ts` | `plugin install|list|uninstall|registry` | Create (Task 8) |
| `apps/cli/src/commands/plugin.test.ts` | CLI command wiring | Create (Task 8) |
| `apps/cli/src/index.ts` | register plugin commands | Modify (Task 8) |

---

## Task 1: Contracts — plugin types + IPC commands

**Why:** All cross-boundary types start in `@piwin/contracts`. This task defines the manifest shape, secret declaration, installed-state record, and the IPC command variants the host will dispatch.

- [ ] **Step 1: Create `packages/contracts/src/plugin.ts`** with:
  - `PluginManifest` — `{ id: string; version: string; name: string; description?: string; skills?: string[]; mcpServers?: Record<string, PluginMcpServerConfig>; secrets?: PluginSecretDecl[] }`
  - `PluginMcpServerConfig` — extends `McpServerConfig` but `env` values may use `${SECRET_NAME}` placeholders resolved at install time.
  - `PluginSecretDecl` — `{ name: string; displayName?: string; description?: string; required?: boolean; defaultEnv?: string }`
  - `InstalledPlugin` — `{ id: string; version: string; name: string; installedAt: string; source: PluginInstallSource; skills: string[]; mcpServerIds: string[]; secrets: string[]; manifestPath: string }`
  - `PluginInstallSource` — reuse `InstallSource` (local | git) plus `{ kind: 'registry'; registryId: string; ref?: string }`.
  - `PluginRegistryEntry` — `{ id: string; name: string; description?: string; source: InstallSource; version: string }`
  - `PluginRegistryIndex` — `{ version: number; plugins: PluginRegistryEntry[] }`
- [ ] **Step 2: Add IPC commands to `packages/contracts/src/ipc.ts`**:
  - `plugins/install` — `{ source: PluginInstallSource; secrets?: Record<string, string> }`
  - `plugins/list` — no params
  - `plugins/uninstall` — `{ pluginId: string }`
  - `plugins/registry/list` — `{ registryUrl?: string }`
  - `plugins/secrets/collect` — `{ pluginId: string; secrets: Record<string, string> }`
- [ ] **Step 3: Export from `packages/contracts/src/index.ts`** — add `export * from './plugin.js';`
- [ ] **Step 4: Typecheck** — `pnpm --filter @piwin/contracts typecheck`

---

## Task 2: Manifest parse + validate

**Why:** Plugin manifests are untrusted input. Strict validation (fail closed on unknown keys, bad types) is the security boundary before any installation side effects.

- [ ] **Step 1: Create `packages/marketplace/src/plugin/manifest.ts`** with:
  - `parsePluginManifest(raw: unknown): PluginManifest` — throws on invalid.
  - `tryValidatePluginManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; issues: ManifestIssue[] }` — non-throwing variant for UI.
  - Validate: `id` matches `^[a-z0-9-]+$`, `version` is non-empty semver-ish string, `name` non-empty, `skills` is array of relative paths (no `..`, no absolute), `mcpServers` is a record with valid server ids, `secrets` is array with valid `name` (env-var-safe `^[A-Z0-9_]+$`).
  - Reject unknown top-level keys.
- [ ] **Step 2: Create `packages/marketplace/src/plugin/manifest.test.ts`** — golden cases: valid manifest, missing id, bad id, unknown key, `..` in skill path, absolute skill path, bad secret name, valid full manifest with all sections.
- [ ] **Step 3: Typecheck + test** — `pnpm --filter @piwin/marketplace test`

---

## Task 3: Install pipeline

**Why:** The core orchestration: resolve source → materialize to cache → parse manifest → install skills → merge MCP servers (namespaced) → resolve secret placeholders → write installed state. This is where untrusted input meets filesystem + keychain side effects.

- [ ] **Step 1: Create `packages/marketplace/src/plugin/secret-env.ts`** — `resolveSecretEnv(env: Record<string,string>, secrets: Record<string,string>): Record<string,string>` replaces `${SECRET_NAME}` with provided values; throws if a required placeholder has no value.
- [ ] **Step 2: Create `packages/marketplace/src/plugin/install-plugin.ts`** with:
  - `installPlugin(options: InstallPluginOptions): Promise<InstallPluginResult>`
  - Options: `{ piwinRoot: string; source: PluginInstallSource; secrets?: Record<string,string>; writeSecret?: (ref: string, value: string) => Promise<void>; registryUrl?: string }`
  - Flow:
    1. Resolve source to a local directory (local = copy; git = clone via existing `resolveCloneContentRoot`; registry = resolve entry then treat as git/local).
    2. Materialize into `~/.piwin/plugins/cache/<id>@<version>/`.
    3. Read `plugin.json`, parse with `parsePluginManifest`.
    4. For each skill path in `manifest.skills`: call `installSkill({ piwinRoot, source: { kind: 'local', path: <materialized>/<skillPath> } })`. Track installed skill ids.
    5. For each MCP server: namespace id as `plugin__<pluginId>__<serverId>`, resolve env placeholders via `resolveSecretEnv`, merge into `mcp.json` (load existing, add, save). Track server ids.
    6. For each declared secret: if value provided in `options.secrets`, write to keychain via `writeSecret` (`keychain:piwin-plugin-<pluginId>-<secretName>`). Track written secret refs.
    7. Write `InstalledPlugin` record via `plugin-store`.
  - Return `{ pluginId, installedSkills, mcpServerIds, secretRefs }`.
- [ ] **Step 3: Create `packages/marketplace/src/plugin/install-plugin.test.ts`** — temp piwin root, fake plugin dir with `plugin.json` + a skill dir, mock `writeSecret`, assert skills copied, MCP merged, state written.
- [ ] **Step 4: Export from `packages/marketplace/src/index.ts`** — `export * from './plugin/manifest.js'; export * from './plugin/install-plugin.js';` etc.
- [ ] **Step 5: Typecheck + test**

---

## Task 4: Installed-state store

**Why:** `~/.piwin/plugins/installed.json` is the source of truth for what plugins are installed, what they own (skills, MCP ids, secrets), so uninstall can cleanly reverse an installation.

- [ ] **Step 1: Create `packages/marketplace/src/plugin/plugin-store.ts`** with:
  - `getInstalledPluginsPath(piwinRoot): string` — `~/.piwin/plugins/installed.json`
  - `loadInstalledPlugins(piwinRoot): Promise<InstalledPlugin[]>`
  - `saveInstalledPlugins(piwinRoot, plugins: InstalledPlugin[]): Promise<void>`
  - `upsertInstalledPlugin(piwinRoot, plugin: InstalledPlugin): Promise<void>` — replace by id.
  - `removeInstalledPlugin(piwinRoot, pluginId: string): Promise<InstalledPlugin | null>` — returns removed entry or null.
  - `findInstalledPlugin(piwinRoot, pluginId: string): Promise<InstalledPlugin | undefined>`
- [ ] **Step 2: Create `packages/marketplace/src/plugin/plugin-store.test.ts`** — temp dir, upsert + list + remove + find.
- [ ] **Step 3: Typecheck + test**

---

## Task 5: Codex adapter

**Why:** Allow installing Codex-format plugins by converting their manifest to piwin's `PluginManifest`. Drops Codex-only features (connectors, hooks, apps) that piwin does not replicate.

- [ ] **Step 1: Create `packages/marketplace/src/plugin/codex-adapter.ts`** with:
  - `adaptCodexManifest(raw: unknown): PluginManifest` — best-effort conversion.
  - Map Codex `skills` array → piwin `skills`.
  - Map Codex `mcpServers` → piwin `mcpServers` (shape is compatible).
  - Map Codex `secrets`/`env` declarations → piwin `PluginSecretDecl[]`.
  - Drop `connectors`, `hooks`, `apps`, `drivers` with a warning (collected in returned `AdaptResult.warnings`).
  - Return `{ manifest: PluginManifest; warnings: string[] }`.
- [ ] **Step 2: Create `packages/marketplace/src/plugin/codex-adapter.test.ts`** — golden cases: full Codex manifest, minimal, empty.
- [ ] **Step 3: Typecheck + test**

---

## Task 6: Registry fetch

**Why:** Lightweight remote index support. A `plugins.json` file (git repo or HTTP) lists available plugins. No backend service.

- [ ] **Step 1: Create `packages/marketplace/src/plugin/registry.ts`** with:
  - `fetchPluginRegistry(url: string): Promise<PluginRegistryIndex>` — fetch + parse + validate.
  - `DEFAULT_PLUGIN_REGISTRY_URL` constant (can be overridden by config later).
  - Validate `version` is 1, `plugins` is array, each entry has valid `id` + `source`.
- [ ] **Step 2: Create `packages/marketplace/src/plugin/registry.test.ts`** — mock fetch, valid index, bad version, bad entry.
- [ ] **Step 3: Typecheck + test**

---

## Task 7: Host IPC handlers

**Why:** Wire plugin operations into the host command dispatch so CLI and desktop can call them via the existing IPC channel.

- [ ] **Step 1: Create `packages/agent-host/src/commands/plugin-commands.ts`** with:
  - `isPluginCommand(command): boolean`
  - `handlePluginCommand(command, requestId, context): Promise<HostResponse | null>`
  - Handlers:
    - `plugins/install` — call `installPlugin` with `context.piwinRoot` + provided secrets + `createSecretResolver().writeProviderSecret` as `writeSecret`.
    - `plugins/list` — `loadInstalledPlugins`.
    - `plugins/uninstall` — find installed plugin, remove its skills (rm dirs), remove its MCP server ids from `mcp.json`, remove secret refs from keychain (best-effort), remove from store.
    - `plugins/registry/list` — `fetchPluginRegistry`.
    - `plugins/secrets/collect` — write provided secrets to keychain for an already-installed plugin.
- [ ] **Step 2: Create `packages/agent-host/src/commands/plugin-commands.test.ts`** — fixture-based: install + list + uninstall round-trip with temp root + mock keychain.
- [ ] **Step 3: Register in `packages/agent-host/src/commands/domain-command-dispatch.ts`** — add `isPluginCommand` to the dispatch chain.
- [ ] **Step 4: Typecheck + test**

---

## Task 8: CLI commands

**Why:** CLI parity. `piwin plugin install <source>`, `piwin plugin list`, `piwin plugin uninstall <id>`, `piwin plugin registry`.

- [ ] **Step 1: Create `apps/cli/src/commands/plugin.ts`** with subcommands:
  - `install` — accepts local path / git URL / `registry:<id>`; prompts for secrets via stdin (interactive); sends `plugins/install` IPC.
  - `list` — sends `plugins/list`, prints table.
  - `uninstall <id>` — sends `plugins/uninstall`.
  - `registry` — sends `plugins/registry/list`, prints table.
- [ ] **Step 2: Create `apps/cli/src/commands/plugin.test.ts`** — command registration + arg parsing.
- [ ] **Step 3: Register in `apps/cli/src/index.ts`**.
- [ ] **Step 4: Typecheck + test**

---

## Task 9: Full verification

- [ ] **Step 1: `pnpm typecheck`** — all packages green.
- [ ] **Step 2: `pnpm test`** — all packages green.
- [ ] **Step 3: Manual smoke** — create a temp plugin dir with `plugin.json` + a skill, `piwin plugin install ./tmp-plugin`, `piwin plugin list`, verify skill appears in `piwin skills list`, verify MCP server in `piwin mcp list`, `piwin plugin uninstall <id>`, verify cleanup.
- [ ] **Step 4: Update `docs/architecture.md`** — add plugin system to package map + a short section.
