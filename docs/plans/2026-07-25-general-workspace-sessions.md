# General Workspace Sessions - Execution Plan

| Field | Value |
|---|---|
| Status | **S0–S4 delivered; desktop General chat stabilization in progress 2026-07-25** |
| Date | 2026-07-25 |
| Scope | Let Desktop and CLI start, resume, and prompt a General session without choosing a project first |
| Related | `docs/prd.md`, `docs/architecture.md`, `docs/adr/0002-config-root-piwin.md`, `docs/adr/0009-session-resume-product-shell.md`, `docs/adr/0015-async-desktop-turn-transport.md` |
| Constraints | `AGENTS.md`; contracts first; UI never imports Pi or accesses filesystem directly; only `@piwin/agent-host` resolves the General workspace path |

## 0. Goal and non-goals

### Goal

Make piwin usable as a normal agent shell immediately after launch:

```text
Launch piwin
  -> General workspace is active
  -> type and send a prompt
  -> receive and resume General-session history
```

Opening a project remains an optional transition into a project-scoped coding
context, rather than a prerequisite for ordinary conversation.

### Non-goals

This work does **not**:

1. Treat the user's home directory as the default workspace.
2. Auto-trust arbitrary folders, relax destructive-tool policy, or bypass MCP
   and network permission prompts.
3. Merge General and project histories into one ambiguous session list.
4. Add an IDE, global filesystem browser, or cross-project search surface.
5. Change Pi internals, fork Pi, or implement the deferred true Pi JSONL tree.
6. Change the existing SDK/RPC contract beyond adding the same General-session
   semantics to both adapters.

## 1. Locked product behavior

### 1.1 Session scopes

Every top-level session has one explicit scope:

| Scope | User-facing label | Host working directory | Project rules/resources | Project trust |
|---|---|---|---|---|
| `general` | **General** | `~/.piwin/workspace` | Never loaded | Not required / not applicable |
| `project` | Project display name | Trusted project root | Loaded under current product rules | Required before create/prompt |

The host creates `~/.piwin/workspace` lazily with restrictive normal directory
permissions. It is product-owned state under the existing config root, not a
temporary directory and not a fake project record.

### 1.2 General safety rules

1. General sessions retain the normal host-owned permission policy for bash,
   secret-file writes, destructive Git, network, and MCP calls.
2. A General session may write under its own workspace through normal approved
   tools, but must not silently gain project-trusted access to another folder.
3. General sessions have no project remembered permissions. The Desktop
   permission UI offers `Allow once` and `Deny`; it must not offer
   `Allow for project`.
4. Project-only commands remain project-only: file tree, Git panel, Tauri PTY,
   project permission management, and project resource discovery require an
   explicit trusted project context.
5. General resource loading includes bundled/user resources and global MCP
   configuration, but skips project-local rules, skills, prompts, extensions,
   and project MCP overlays.

### 1.3 Session navigation and switching

```text
Navigator
  General
    New session
    General session history
  Projects
    project A -> its history
    project B -> its history
```

- Startup selects General and hydrates its active (or archived) session list.
- `New session` creates a session in the selected scope.
- Selecting a project switches the active scope to `project`; it does not
  delete, convert, or hide General history.
- Returning to General switches scope and restores its own selected session or
  empty composer.
- A Project session cannot be reassigned to General, and vice versa. Use
  export/copy if content must be moved between scopes.

## 2. Architectural contract decision

Before code, add ADR `0016-general-workspace-sessions.md` that records the
following contract. This is architectural because it changes host/session
identity, session persistence, permissions, CLI behavior, and Desktop state.

### 2.1 Contracts

Add a discriminated scope in `@piwin/contracts`; do not encode General as a
magic project path such as `"general"`, `"/"`, or the user's home directory.

```ts
type SessionScope =
  | { kind: 'general' }
  | { kind: 'project'; projectPath: string };

type CreateSessionInput = {
  scope: SessionScope;
  sessionName?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  executionMode?: ExecutionMode;
  // Existing subagent and cwd override fields remain constrained to project scope.
};
```

Host-only resolution produces a persisted location with an explicit effective
working directory:

```ts
type ResolvedSessionLocation = {
  scope: SessionScope;
  workingDirectory: string;
};
```

`workingDirectory` is `getPiwinGeneralWorkspacePath(getPiwinRoot())` for a
General session and the canonical trusted project root for a Project session.
Apps send scope intent, never a General filesystem path.

### 2.2 IPC and summaries

Update contracts so queries are scope-based rather than requiring
`projectPath`:

```ts
{ type: 'session/list'; scope: SessionScope; includeArchived?: boolean }
```

`SessionSummary`, session search results, resume data, and Desktop list items
carry `scope`. `projectPath` is present only for `project` scope. Any command
that needs an actual project root remains typed to require one.

### 2.3 Persistence migration

Upgrade the product session-index document from v1 to v2. V2 records preserve
the resolved working directory and explicit scope. The loader must accept v1
documents and normalize every valid old record to:

```ts
{
  scope: { kind: 'project', projectPath: legacy.projectPath },
  workingDirectory: legacy.projectPath,
}
```

The first successful index mutation writes v2 atomically. No old transcript or
session identifier is moved or regenerated. Transcript metadata gains the
same location information through a backward-compatible loader; old
transcripts infer project scope from their legacy `projectPath` field.

## 3. Implementation slices

Execute slices in order. Each is independently reviewable and must leave both
Desktop and CLI type-safe.

### S0 - ADR, contract types, and migration fixtures

**Owner:** `packages/contracts`, `packages/session`, docs

**Likely files**

| Action | File |
|---|---|
| Add | `docs/adr/0016-general-workspace-sessions.md` |
| Update | `packages/contracts/src/host.ts` |
| Update | `packages/contracts/src/ipc.ts` |
| Update | `packages/contracts/src/session-index.ts` |
| Update | `packages/contracts/src/session-ops.ts` and public `index.ts` exports as needed |
| Update | `packages/session/src/session-index-store.ts` |
| Update | `packages/session/src/message-store.ts` |
| Add/update | colocated contracts and session-index migration tests |

**Steps**

1. Record the behavior and safety decisions from sections 1 and 2 in ADR 0016.
2. Add `SessionScope` and `ResolvedSessionLocation` to contracts; update every
   command/result type that currently assumes `projectPath` is always present.
3. Update index and transcript schemas/loaders with explicit v1-to-v2
   normalization. Reject malformed scope documents rather than guessing.
4. Replace `listSessionsForProject` internals with a scope-based query. Keep a
   named compatibility wrapper only if it prevents a large mechanical change;
   remove it in the same vertical slice once callers are migrated.
5. Update search/duplicate/export records so General and Project records retain
   their scope and effective working directory.

**Exit criteria**

- A v1 project index loads without data loss and writes a valid v2 document on
  next mutation.
- A General record can coexist with a Project record having the same display
  name but never appears in the Project query.
- Public contract types make `projectPath` impossible to read without first
  narrowing `scope.kind === 'project'`.

**Tests**

- v1 index and transcript normalization fixtures;
- v2 General and Project list/filter/archive/pin/search fixtures;
- duplicate/export preserves scope and working directory;
- contracts typecheck for all downstream implementers.

### S1 - Host General workspace resolver and session lifecycle

**Owner:** `packages/agent-host`

**Likely files**

| Action | File |
|---|---|
| Update | `packages/agent-host/src/paths.ts` |
| Add | `packages/agent-host/src/general-workspace.ts` |
| Update | `packages/agent-host/src/host-runtime.ts` |
| Update | `packages/agent-host/src/commands/session-live-commands.ts` |
| Update | `packages/agent-host/src/commands/session-product-commands.ts` |
| Update | `packages/agent-host/src/sdk-adapter.ts` |
| Update | `packages/agent-host/src/rpc-adapter.ts` |
| Update | `packages/agent-host/src/product-shell-session.ts` |
| Add/update | `general-workspace.test.ts`, `session-chat-ops.test.ts`, adapter fixtures |

**Steps**

1. Add `getPiwinGeneralWorkspacePath(rootDir)` and one idempotent host service
   that creates and canonicalizes the directory before session creation.
2. Resolve `SessionScope` in `HostRuntime`; save only the resolved location in
   runtime maps, index, transcript, process metadata, and session summaries.
3. Update `session/create`, `session/list`, `session/resume`, prompt history
   rebuild, duplicate, archive, export, and search to use the persisted scope.
4. For `general`, pass the product-owned workspace directory as the Pi session
   cwd. For `project`, retain existing canonical project-root behavior.
5. Keep SDK and RPC adapter public interfaces identical. Do not implement a
   desktop-specific General-session adapter.
6. Ensure recovery after sidecar restart recreates a General product shell with
   the same stable session ID and General cwd.

**Exit criteria**

- `session/create` accepts `{ scope: { kind: 'general' } }` without any
  project-open or project-trust command.
- Prompting and resuming a General session uses `~/.piwin/workspace` as cwd.
- Project-session behavior and indexes stay unchanged except for schema v2.
- SDK and RPC/mock implementations satisfy the same scope contract.

**Tests**

- mock General create -> prompt -> resume -> transcript test;
- host restart/resume General fixture;
- General and Project list isolation test;
- resolver creates only the configured `PIWIN_ROOT/workspace` path;
- SDK/RPC adapter fixture verifies the correct effective cwd;
- existing project chat, duplicate, archive, and transcript tests remain green.

### S2 - Resource, permission, process, and terminal boundaries

**Owner:** `packages/agent-host`, `packages/project`, `packages/process`,
`packages/mcp`

**Likely files**

| Action | File |
|---|---|
| Update | `packages/agent-host/src/pi-resource-loader.ts` |
| Update | `packages/agent-host/src/session-tools.ts` |
| Update | `packages/agent-host/src/permission-policy.ts` |
| Update | `packages/agent-host/src/commands/*` that assume project paths |
| Update | `packages/agent-host/src/process-tools.ts` |
| Update | `packages/project/src/*` only if a project-only guard needs a shared predicate |
| Update | `apps/desktop/src-tauri/src/pty_host.rs` and bridge tests only if command contracts change |
| Add/update | permission/resource/PTY regression tests |

**Steps**

1. Extend the Pi resource loader with an explicit `general` mode. It loads
   bundled and user-level resources but never walks a project path for
   project-local instructions, Skills, prompts, extensions, or overlays.
2. Make permission context scope-aware. In General scope, rememberable project
   policy is unavailable; permission resolution permits `once` or `deny` only.
3. Audit all host commands taking `projectPath`. General sessions may use
   generic conversation, approved global tools, and workspace-local writes,
   but cannot invoke project-only Git/file-tree/PTY operations with an absent
   project root.
4. Preserve existing host-side path traversal and secret-file checks. Do not
   rely on disabled Desktop controls as security enforcement.
5. Confirm global MCP lifecycle stays global and lazy. Session creation must
   not start MCP transports in either scope.

**Exit criteria**

- A General session does not read project `AGENTS.md`, project Skills, or
  project extension/prompt configuration.
- General permission UI data cannot request a persisted project allowlist.
- Attempting project-only operations without a Project scope returns an
  actionable host error and never spawns a terminal/process.
- Existing project trust and remembered network permission behavior remains
  unchanged.

**Tests**

- resource-loader fixture containing distinct user, General-workspace, and
  project-local files;
- General network/MCP permission fixture proves only one-time resolution;
- General requests for Git/file-tree/PTY commands fail at host boundary;
- Tauri/Rust PTY authorization test proves missing project scope cannot spawn;
- no eager MCP lifecycle regression test.

### S3 - CLI parity and host JSONL transport

**Owner:** `apps/cli`, contracts consumers

**Likely files**

| Action | File |
|---|---|
| Update | `apps/cli/src/index.ts` |
| Update | `apps/cli/src/host-serve-command-lane.ts` only if exhaustive command typing requires it |
| Update | CLI help and README command examples |
| Add/update | CLI command and JSONL integration tests |

**Steps**

1. Make `piwin chat "..."` create/use a General session by default.
2. Keep `--project <path>` as the explicit Project scope selector; it follows
   normal project open/trust semantics rather than silently trusting a path.
3. Make `piwin session list` list General sessions by default. Retain
   `--project` for Project history. Add a deliberate `--scope general` only if
   it materially improves command clarity; do not support conflicting flags.
4. Update JSONL `host serve` examples and fixtures to carry `SessionScope`.
   Prompt remains a quick acknowledgement per ADR 0015 in both scopes.
5. Print a concise General workspace label in CLI status/diagnostics without
   exposing secret or unrelated filesystem paths.

**Exit criteria**

- Fresh `piwin chat "hello"` works against mock without a project argument.
- `piwin chat --project <path>` creates a Project session only after trust is
  established through host commands.
- CLI and Desktop serialize the same `SessionScope` messages over host JSONL.

**Tests**

- mock CLI default chat end-to-end;
- JSONL General create/prompt/abort/resume fixture;
- existing `--project` behavior fixture;
- invalid or conflicting scope option parsing tests.

### S4 - Desktop General-first state, composer, and session navigation

**Owner:** `apps/desktop`

**Likely files**

| Action | File |
|---|---|
| Update | `apps/desktop/src/chat-reducer.ts` and tests |
| Update | `apps/desktop/src/hooks/use-session-actions.ts` |
| Update | `apps/desktop/src/hooks/use-composer-media.ts` |
| Update | `apps/desktop/src/App.tsx` |
| Update | `apps/desktop/src/project-session-sidebar.tsx` |
| Update | `apps/desktop/src/chat-empty-state.tsx` |
| Update | `apps/desktop/src/composer-dock.tsx` |
| Update | `apps/desktop/src/host-client-mock.ts` and tests |
| Update | styles and desktop locale copy only where scope labels are shown |
| Add/update | focused component tests and `apps/desktop/e2e/shell.spec.ts` |

**Steps**

1. Replace the nullable-project-as-empty state with an explicit active scope in
   Desktop state. Initial state is `{ kind: 'general' }`, never an implicit
   missing-project error state.
2. On host bootstrap, hydrate General sessions. Do not create a session until
   the user presses New session, pastes an image, or sends a prompt.
3. Update `ensureSession` and composer send flow: in General scope it creates
   or uses a General session directly; in Project scope it preserves the
   existing project-trust guard.
4. Preserve composer draft text if a user switches scopes or opens the project
   picker. Do not force the picker on General Send.
5. Update image paste/drop so it lazily creates a General session before media
   save, matching the current session-id-based media store contract.
6. Render General as a first-class navigator section and use a visible scope
   label in the composer/header. A Project scope shows the project identity;
   General must not masquerade as a repository.
7. Disable or hide only genuinely project-scoped controls (Files, Git, PTY,
   project permission settings) while General is active. Keep Settings,
   model selection, Skills, global MCP, and normal chat available.
8. Update the mock backend to use the same scope/list semantics so browser
   tests cannot accidentally conceal a live-host-only defect.

**Exit criteria**

- A fresh Desktop launch shows a General composer and can send a text prompt
  without a picker or trust modal.
- General session history survives reload/resume and is not mixed with a
  selected project's history.
- Opening a project switches into Project scope and preserves the existing
  trust guard for an untrusted path.
- General paste-image flow creates the session/media location safely and shows
  its attachment chip.

**Tests**

- reducer tests for scope transition, General hydration, and scope-isolated
  session lists;
- `use-composer-media` tests for General text and attachment send;
- sidebar/component tests for General selection and project-specific control
  availability;
- Vite mock e2e: fresh launch -> type -> send -> assistant reply without
  project selection;
- Vite mock e2e: General -> open project -> project session -> return General;
- manual native Tauri smoke using live sidecar and a configured model.

### S5 - Documentation, migration communication, and release verification

**Owner:** docs, all touched packages

**Likely files**

| Action | File |
|---|---|
| Update | `docs/architecture.md` |
| Update | `docs/prd.md` if Agent Window wording still says project is mandatory |
| Update | `docs/dev-plan.md` / `docs/todo-deferred.md` with delivered and deferred scope |
| Update | `README.md` Desktop/CLI quick-start examples |
| Add/update | dated manual smoke evidence note if native evidence policy requires it |

**Steps**

1. Document General and Project scope semantics, including the actual
   `~/.piwin/workspace` location and its security limits.
2. Update architecture's config-root tree to include `workspace/`.
3. State migration behavior clearly: old sessions remain Project sessions;
   General begins empty on first upgrade.
4. Add manual smoke steps for no-project chat, General media, project switch,
   project trust, and Stop during a General run.
5. Run full verification only after every targeted slice is green.

**Exit criteria**

- User documentation does not state or imply that a project must be selected
  before prompting.
- Architecture docs accurately distinguish product-owned General workspace
  from trusted project roots.
- Migration and limitations are discoverable without reading source.

## 4. Required verification matrix

| Layer | Required evidence |
|---|---|
| Contracts | workspace typecheck; all command/result implementers updated |
| Session | v1 migration + General/Project isolation unit tests |
| Host | mock SDK/RPC session lifecycle, resource isolation, permission and project-only guards |
| CLI | default General chat and JSONL prompt/abort integration |
| Desktop browser | General-first send, General history, scope switch, image paste |
| Tauri native | live sidecar General prompt, Stop, open trusted project, return to General |
| Final | `pnpm typecheck`, `pnpm test`, relevant desktop e2e, Rust checks when PTY contract changes |

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A magic sentinel path leaks into project logic | Use discriminated `SessionScope`; reject APIs that infer scope from a string path. |
| Existing v1 sessions disappear after schema change | Read and normalize v1 before every query; fixture-test mutation writeback and preserve IDs/transcripts. |
| General accidentally loads project instructions | Add an explicit resource-loader mode and a fixture with conflicting project/user resources. |
| General gets durable project permissions | Permission resolver narrows General decisions to once/deny and tests store non-mutation. |
| UI only removes the picker but host still rejects creation | Implement S1 before S4; browser mock follows the same contract. |
| General becomes an unbounded home-directory shell | Host resolves only `~/.piwin/workspace`; project-only tools require explicit project scope/trust. |
| New scope breaks responsiveness/Stop | Preserve ADR 0015 quick acknowledgement, active-run, and control-lane tests for General prompts. |

## 6. Do not do

1. Do not send `projectPath: ''`, `null`, `$HOME`, or a sentinel string as a
   workaround for General mode.
2. Do not make Desktop invent a local session or bypass `@piwin/agent-host`.
3. Do not add a raw filesystem picker or Node filesystem access to React.
4. Do not automatically trust the General workspace as a way to trust arbitrary
   user-selected projects.
5. Do not silently change old project sessions into General sessions.
6. Do not make General sessions a hidden special case unavailable to CLI.
7. Do not start or await MCP transports while creating either scope of session.

## 7. Recommended start order

```text
S0 contracts + persistence migration
  -> S1 host General workspace lifecycle
  -> S2 resource and permission boundaries
  -> S3 CLI / JSONL parity
  -> S4 Desktop General-first UX
  -> S5 docs and complete verification
```

Do not begin Desktop send-flow changes before S1 and S2 establish a safe,
testable host boundary. The first reviewable implementation PR should be S0;
the first user-visible but safe vertical slice is S1 + S3 under `--mock`.
