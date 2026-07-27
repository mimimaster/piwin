# Desktop UI and Interaction Stabilization Plan

| Field | Value |
|---|---|
| Status | In progress — S1/S2/S3 core + shell UX slices implemented |
| Date | 2026-07-21 |
| Scope | Desktop shell correctness, interaction truthfulness, responsive navigation, accessibility, and UI maintainability |
| Prerequisites | `docs/prd.md`, `docs/architecture.md`, `docs/specs/w3-marketplace-automation.md`, `AGENTS.md` |
| Primary packages | `@piwin/contracts`, `@piwin/agent-host`, `@piwin/automation`, `@piwin/desktop` |

## 1. Purpose

This plan repairs the issues found in the desktop UI and interaction review without changing the product's layered architecture. It prioritizes **truthful state**, then **recoverable navigation**, then **visual and accessibility consistency**.

The intended result is not a visual rewrite. It is a small set of coherent vertical slices that make the existing Agent Window dependable at normal and narrow desktop widths, ensure that visible controls match host behavior, and remove fragile CSS cascade conflicts before additional features are added.

## 2. Non-negotiable constraints

1. `apps/desktop` continues to consume only `@piwin/*` public APIs and normalized `HostCommand` / `HostPush` messages. It must not import Pi packages or spawn processes directly.
2. Cross-boundary lifecycle semantics start in `@piwin/contracts`; `PiSdkAdapter`, `PiRpcAdapter`, product-shell sessions, the browser mock, and the desktop reducer must implement the same semantics.
3. Automation and hook execution remain host-owned. The renderer may configure, inspect, and resolve permissions; it may never run shell hooks itself.
4. MCP configuration has one canonical type and one canonical persisted document: `McpConfigDocument` at `~/.piwin/mcp.json`.
5. Reuse existing React, Radix Dialog/Tabs, and `@piwin/ui-kit`. Do not add a UI state framework, an icon library, a CSS framework, or Electron.
6. Do not add another catch-all desktop module. New UI responsibilities must use focused components or hooks with domain names. `App.tsx` should lose responsibilities as work proceeds; it must not become larger to accommodate the fixes.
7. Preserve current safe defaults: project trust gates agent tools and shell access; media and secrets rules remain unchanged; hooks remain disabled by default.
8. Do not claim full PTY behavior until a real PTY emulator exists. This plan intentionally corrects the product wording instead of pretending that line-oriented piped I/O is a terminal emulator.

## 3. Scope and deliberate exclusions

### In scope

- Correct session hydration, resume feedback, abort state, and mock/live behavioral parity.
- Repair mock MCP persistence and make Composer MCP availability consume the canonical document shape.
- Enforce visible automation settings in the host, including normalized-event hooks.
- Make primary project/session navigation reachable at every supported desktop width.
- Consolidate conflicting shell CSS, restore visible keyboard focus, and reduce surprise layout shifts.
- Make Settings, destructive actions, errors, and command-runner limitations truthful and actionable.
- Add targeted unit, host-runtime, browser E2E, and native Tauri smoke coverage.

### Explicitly out of scope

- A general redesign, theme overhaul, or replacement of the current visual direction.
- Full session-tree/fork/rename/delete UX. Track this separately against AW-05/AW-06 after the session state is reliable.
- Real `node-pty` / xterm integration. That remains the dedicated PTY capability follow-up.
- New cloud services, hosted registries, or remote automation scheduling.
- A generic notification framework across every product package. This plan adds only the desktop notice behavior required by the repaired flows.

## 4. Delivery strategy and ordering

Implement and commit the slices in order. Every slice must typecheck and test independently. Do not mix CSS cleanup, contracts, host behavior, and unrelated visual polish in one commit.

| Slice | Objective | Dependencies | Commit boundary |
|---|---|---|---|
| S0 | Establish behavioral baselines and ownership boundaries | none | tests/docs only |
| S1 | Make session restore and abort truthful end-to-end | S0 | contracts + host + desktop reducer |
| S2 | Make MCP configuration a single source of truth | S0 | desktop mock + UI only, then host regression tests |
| S3 | Make automation switches enforce real host behavior | S1 | contracts/host/automation/UI |
| S4 | Preserve navigation and focus at constrained widths | S0 | desktop components + shell CSS |
| S5 | Consolidate desktop presentation and feedback semantics | S4 | desktop only |
| S6 | Final cross-layer verification and documentation | S1-S5 | tests/docs only |

## 5. Slice S0 - Baselines, diagnostics, and ownership map

### Goal

Lock down the reviewed failure modes before behavior changes so regressions are observable. This slice introduces no product behavior.

### Files

- Update: `apps/desktop/e2e/shell.spec.ts`
- Update: `apps/desktop/src/chat-reducer.test.ts`
- Update: `packages/agent-host/src/host-runtime.test.ts`
- Update: `packages/agent-host/src/mock-session.test.ts` if missing; otherwise colocate the tests with the existing mock-session tests.
- Update: `docs/todo-deferred.md` only when explicitly reclassifying an intentionally deferred capability such as real PTY.

### Steps

1. Add a failing browser E2E for project reopen with persisted session history. The assertion must prove that the selected row and transcript correspond to the same session.
2. Add a failing abort test that starts a deliberately delayed mock stream, requests abort mid-stream, and verifies that no further text deltas are published after cancellation settles.
3. Add MCP flow coverage for: registry draft -> canonical configured document -> Composer menu reading that configured server.
4. Add host-runtime tests for `automation.enabled`, `cronEnabled`, and `hooksEnabled` independently. Tests must assert both the permitted and denied paths.
5. Add desktop viewport cases at 1280x840, 1024x768, and 800x700. At 800px, prove that project open, session search/list, New conversation, and Settings stay reachable.
6. Add keyboard E2E cases for focus visibility, menu close/focus restoration, permission dialog Escape, and Settings close behavior once those behaviors are implemented in later slices. Keep the cases skipped only while they are genuinely not implemented; do not commit permanently skipped assertions.

### Acceptance criteria

- Every later bug fix changes a previously failing or missing targeted test into a passing test.
- Tests name the user-observable behavior, not implementation details.
- No new dependencies are introduced.

## 6. Slice S1 - Session hydration and cancellation semantics

### Goal

Make the session list, active transcript, Stop button, and streamed output represent one consistent lifecycle in SDK, RPC fallback, host mock, and browser mock modes.

### Contract design

Add one additive normalized terminal event to `packages/contracts/src/host.ts`:

```ts
{ type: 'session/aborted'; sessionId: string; messageId?: string }
```

Why a distinct event is required:

- `message/end` means a normal completed message and cannot truthfully distinguish a user cancellation.
- An `error` event is not suitable because cancellation is a user action, not necessarily a failure.
- The event is host-normalized, so the UI does not inspect adapter-specific abort payloads.

Update `packages/contracts/src/ipc.ts` only if a host push needs a richer top-level payload; otherwise carry the lifecycle event through the existing `{ type: 'event', sessionId, event }` channel. Export changes through `packages/contracts/src/index.ts` only when a new separate type file is introduced.

### Implementation steps

1. **Contracts first**
   - Add the additive `session/aborted` member to `AgentEvent` in `packages/contracts/src/host.ts`.
   - Update contracts fixtures/tests to prove the event remains valid IPC payload data.

2. **Host session implementations**
   - Update `packages/agent-host/src/mock-session.ts` so prompt streaming yields between chunks, observes `aborted` before each emission, preserves the partial assistant text, emits exactly one `session/aborted`, and never emits a normal `message/end` for the aborted assistant turn.
   - Update `packages/agent-host/src/product-shell-session.ts` to forward the active live handle abort and ensure a prompt aborted during lazy session creation does not continue into `prompt`.
   - Update SDK/RPC adapter mappings only where necessary to normalize their abort completion into `session/aborted`. Do not invent Pi-native event parsing in the desktop app.
   - In `packages/agent-host/src/host-runtime.ts`, keep an in-flight session map that records the current assistant message only for lifecycle reporting. Clear it on normal end, error, and abort. Do not create a second transcript store.

3. **Desktop state ownership**
   - Replace the overloaded `streaming: boolean` in `apps/desktop/src/chat-reducer.ts` with a small explicit run state owned by the reducer, for example `idle | streaming | aborting`. Keep the type local to the reducer unless another package consumes it.
   - Add reducer handling for `session/aborted`: retain partial text, mark its message as non-streaming/error-safe as appropriate, clear the run state, and expose a bounded status label for the transcript.
   - Add a `session/loading` UI state only if it is required to distinguish loading transcript from blank transcript. Do not use a generic `isLoading` flag shared by unrelated operations.

4. **Desktop interaction handlers**
   - In `apps/desktop/src/App.tsx`, make `hydrateSessions` return the hydrated summaries once. Do not issue a second `session/list` request when deciding whether to create a new trusted session.
   - On successful project open with history, call the same resume/load helper used by a session-row click. Keep transcript loading visible until completion. On failure, leave no misleading active transcript selection and render a retryable history-loading failure.
   - Change `handleAbort` to transition to `aborting` before awaiting the host response. Disable the Stop control and label it `Stopping...` until a normal terminal lifecycle event, `session/aborted`, or a failed response resolves it.
   - Do not emit a global error for a successful user cancellation. Preserve a compact, accessible `Stopped` transcript status instead.

5. **Browser mock parity**
   - Update `apps/desktop/src/host-client.ts` mock streaming to use the same cancellation model as `createMockSessionHandle`; it must persist per-session in-flight work and stop scheduled emissions.
   - The browser mock is a host transport simulator, not an independent behavior design. Keep its event sequence aligned with the contracts fixture used by agent-host tests.

### Tests

- `packages/agent-host/src/mock-session.test.ts`: abort before first delta, abort after a partial delta, normal completion, and exactly-once terminal event behavior.
- `packages/agent-host/src/host-runtime.test.ts`: `session/abort` forwards to active session and produces normalized lifecycle output.
- `apps/desktop/src/chat-reducer.test.ts`: partial assistant text survives `session/aborted`; send/abort transition is deterministic.
- `apps/desktop/e2e/shell.spec.ts`: reopen persisted history; Stop mid-stream; no late text appears; control returns to Send.

### Acceptance criteria

- An active session row never presents an unrelated empty transcript.
- Stop is observable as `Stopping...`, ends in a stable state, and prevents post-abort text deltas.
- The UI consumes only normalized events, never mock- or Pi-specific cancellation data.

## 7. Slice S2 - Canonical MCP configuration across host, mock, settings, and Composer

### Goal

Eliminate the discrepancy where a registry draft claims success but is not visible to configured MCP UI or the Composer.

### Ownership

- Canonical schema: `packages/contracts/src/mcp.ts` `McpConfigDocument`.
- Canonical persisted store: host `~/.piwin/mcp.json`.
- Browser mock canonical in-memory store: `MockHostTransport.mockMcpDocument`.
- Renderer view model: derived from `document.mcpServers`; no renderer-specific alternate `servers` shape.

### Implementation steps

1. Keep `McpConfigDocument` as-is unless the review exposes an actual missing type. Do not create a parallel Composer MCP type.
2. In `apps/desktop/src/host-client.ts`:
   - Make `mcp/get` return `this.mockMcpDocument`.
   - Validate and assign the typed document during `mcp/save` rather than reporting success without persistence.
   - Derive `mcp/status`, `mcp/start`, `mcp/stop`, and `mcp/list_tools` responses from configured server IDs. Mock start may remain unable to launch a real process, but it must report an explicit `error` health state rather than success that implies a running server.
   - Make `mcp/registry-install-draft` update the same document and return a copy of it.
3. In `apps/desktop/src/App.tsx`, refactor `refreshComposerMenus` into a focused helper or hook such as `useComposerCapabilities`. Read `Object.entries(document.mcpServers)` and derive id/name/status from the canonical structure.
4. In `apps/desktop/src/McpPanel.tsx`, after a successful registry draft insertion, call the normal `loadConfig` path. Use the action label **Add configuration draft** until host health reports running; reserve **Installed** for an actual completed lifecycle state.
5. Preserve the real host's existing `mcp.json` path and lifecycle manager. Add regression tests to `packages/agent-host/src/host-runtime.test.ts` rather than duplicating host MCP persistence logic in the renderer.

### Tests

- Browser mock unit tests around `mcp/get`, `mcp/save`, and registry draft persistence.
- E2E: Registry -> Add configuration draft -> Configured tab row -> Composer MCP submenu -> explicit unavailable/running state.
- Host-runtime regression: registry draft persists at `mcp.json` and loads through `mcp/get`.

### Acceptance criteria

- A successful draft action is visible immediately in Configured and after refresh.
- Composer availability is derived from the same `mcpServers` map.
- The UI never calls a configured-but-not-running MCP server `running`.

## 8. Slice S3 - Automation controls must enforce host behavior

### Goal

Ensure that the three visible automation settings describe actual execution behavior, especially for potentially dangerous shell hooks.

### Host design

`packages/agent-host` owns all dispatch. `packages/automation` remains the pure store/runner package. The desktop only reads configuration and invokes existing host commands.

### Implementation steps

1. **Cron enforcement**
   - In `packages/agent-host/src/host-runtime.ts`, replace the single master-switch check in `runCronJob` with an explicit policy predicate that requires all of: `automation.enabled === true`, `automation.cronEnabled === true`, and `job.enabled === true`.
   - Return a stable skipped/disabled result explaining which gate prevented the run. Do not quietly mark it as successful.
   - Apply the same predicate to scheduled invocation and manual `cron/run`; a manual UI action must not bypass a disabled feature.

2. **Hook lifecycle wiring**
   - Add a focused host helper such as `runConfiguredHooksForEvent(context)` in `host-runtime.ts`. It loads the current config, returns immediately unless `automation.enabled` and `automation.hooksEnabled` are true, loads hooks from the automation store, and invokes `runMatchingHooks` from `@piwin/automation`.
   - Map normalized events at the host boundary, not in adapter- or renderer-specific code:
     - `session/started` -> `agent_start`
     - accepted prompt dispatch -> `turn_start`
     - completed/aborted assistant turn -> `turn_end`
     - `session/ended` -> `agent_end`
     - `tool/end` -> `tool_execution_end`, including tool name
   - Run hooks best-effort and publish success/failure as contextual `host/log` messages. A hook failure must not fail or mutate the original agent turn.
   - Protect shell hook execution with the existing host permission policy. Add a dedicated action classification (for example `automation:hook-shell`) if one does not already exist. Never pass provider credentials or arbitrary process environment to hooks.

3. **Desktop automation truthfulness**
   - In `apps/desktop/src/AutomationPanel.tsx`, disable or explain unavailable actions based on the retrieved automation capability/config state. A disabled Cron toggle prevents Run; a disabled Hooks toggle shows `Hooks are saved but not armed` instead of implying that they execute.
   - Replace deletion flows with the existing `@piwin/ui-kit` Dialog primitive. The dialog must name the cron job/hook, explain scope, and restore trigger focus on dismissal.
   - Add a shell-hook risk acknowledgment before enabling a hook: command, args, working directory, trigger event, and environment allowlist summary. Do not add a renderer shell test runner.

4. **No false feature claims**
   - If scheduled cron arming is not reliably invoked in the current host lifecycle, show manual-run-only wording and file the scheduler as a separate host follow-up. Do not label it enabled merely because it was persisted.

### Tests

- `packages/automation`: matching, disabled hook filtering, timeout/error isolation.
- `packages/agent-host/src/host-runtime.test.ts`: each cron gate; hook event mapping; hook failure isolation; shell permission denial; no secret propagation.
- Desktop E2E: disabled Cron blocks Run with explanatory state; disabled Hooks are visibly unarmed; delete confirmation cancellation keeps entity.

### Acceptance criteria

- Every enabled/disabled control changes a matching host behavior.
- Hook execution never originates in React and never breaks a prompt on failure.
- All destructive configuration actions use the shared dialog pattern.

## 9. Slice S4 - Responsive navigation, inspector behavior, and keyboard access

### Goal

Ensure every primary desktop workflow remains reachable at supported widths and keyboard users can locate and operate every consequential control.

### Component boundaries

Before adding responsive branches, extract the project/session sidebar markup from `App.tsx` into a focused `apps/desktop/src/ProjectSessionSidebar.tsx`. Its inputs should be explicit callbacks and state props: project picker, trust status, search, session rows, pin action, New conversation, host status, and Settings launch.

This extraction is required because copying sidebar markup into a mobile drawer would create divergent behavior and another maintenance surface.

### Implementation steps

1. **Responsive navigation pattern**
   - Keep the existing three-column shell at wide widths.
   - At the selected compact breakpoint, render the same `ProjectSessionSidebar` in a Radix/ui-kit Dialog-based navigation drawer opened from the Chats rail action. This owns focus trap, Escape close, and focus restoration.
   - The compact drawer must include project picker, trust state, conversation search, session list, pin action, New conversation, and Settings. It must close after session selection or New conversation succeeds.
   - Do not hide the only Settings entry at compact widths.

2. **Inspector behavior**
   - Define explicit breakpoints in one authoritative shell-layout section:
     - wide: inspector is a grid column;
     - medium: inspector is an overlay/drawer with a visible close action;
     - compact: inspector cannot coexist with the navigation drawer and opens as its own Dialog/drawer state.
   - Replace unconditional automatic Inspector opening during a tool run with a non-disruptive state badge on the Execution trigger. Preserve an explicit user preference only if there is evidence users want automatic opening.

3. **Header priority**
   - At medium widths, keep session identity and Stop/Send-related controls primary.
   - Collapse usage into a compact status control, move secondary execution controls into More, and retain a discoverable active model label.
   - Do not use CSS clipping as a feature; conditional rendering should follow an explicit responsive state when necessary.

4. **Keyboard and focus contract**
   - Add a single global `:focus-visible` treatment based on existing CSS variables with sufficient contrast in both built-in appearances.
   - Remove `outline: 0` / `outline: none` only where an equivalent visible focus treatment is applied in the same component rule.
   - Replace custom role-menu implementations in `composer-plus-menu.tsx` and the More menu with Radix menu primitives, or implement their complete keyboard contract. Prefer Radix to avoid a local roving-focus implementation.
   - Ensure tablists have linked tab panels with IDs, `aria-controls`, and `aria-labelledby`.

### Tests

- E2E viewport tests at 1280x840, 1024x768, and 800x700.
- Keyboard E2E for compact navigation drawer, More menu, composer menu, tab movement, Escape, and focus return.
- Targeted visual snapshot or computed-layout assertions for New conversation, session labels, and inspector width. Do not require pixel-perfect snapshots for every theme.

### Acceptance criteria

- Project, session history/search, New conversation, Settings, and Inspector are reachable at all three test widths.
- Focus is always visibly indicated for keyboard navigation.
- Opening a tool run does not reflow the user’s chat layout without an explicit user action.

## 10. Slice S5 - Presentation consolidation, Settings IA, errors, and command-runner honesty

### Goal

Remove the stylesheet's source-order accidents and align wording, feedback, and settings destinations with actual behavior.

### CSS cleanup approach

1. Inventory duplicate selectors in `apps/desktop/src/styles.css` before editing.
2. Consolidate each shell component into one authoritative rule set. Start with `.sidebar-new-session`, `.settings-back`, `.right-panel-tab`, `.usage-chip`, session previews, and drawer behavior.
3. Replace undeclared tokens such as `--fg` with existing declared semantic tokens or define an intentional token at the root/appearance level. Do not rely on invalid custom-property fallback behavior.
4. Remove superseded selectors rather than appending a third override. Keep CSS comments about invariants and breakpoints, not aesthetic provenance.
5. Split the stylesheet only when a domain can move as a complete coherent unit with an explicit import order. A partial split that leaves duplicate selectors across files is forbidden.

### UI behavior steps

1. Restore **New conversation** as the primary full-width labeled sidebar action. Remove negative-margin/icon-only override behavior. If a compact icon alternative is needed, make it a deliberate variant with a stable layout slot and accessible label.
2. Convert the Settings overlay into one intentional model:
   - either a full application page with semantic `main` and a real Back route;
   - or a Dialog with focus containment.
   This plan chooses the page model unless implementation constraints make dialog semantics demonstrably better. Do not show an `Esc` hint unless Escape works.
3. Give Settings destinations one canonical responsibility:
   - Workspace: General, Appearance, Session defaults;
   - Agent: Models, agent behavior, Memory, Prompts, Extensions where appropriate;
   - Tools: Web tools, MCP;
   - System: Automation.
   Render overview links rather than duplicate full forms under multiple sections.
4. Hide the Rules destination until there is a functional first slice, or replace it with a real read-only AGENTS.md discovery/open flow. Do not ship an enabled navigation item ending at `New Rule (soon)`.
5. Add a focused desktop notification region/component rather than continuing to overwrite one global error string. It must support:
   - `role="alert"` for failures;
   - `role="status"` for non-error progress/success;
   - action source and a retry callback only when safe;
   - bounded visible history and explicit dismissal.
   Keep host diagnostic logs in Activity; do not make users inspect logs to understand a failed UI action.
6. Replace browser `window.prompt` and `window.confirm` fallback interactions used in normal product paths with the existing Dialog primitives. Tauri file/folder pickers remain appropriate for native file selection.
7. Rename the current dock tab and first-use copy to **Shell commands (preview)** / **Command output**. State that it is line-oriented and does not support interactive/TUI programs. On exit, disable command input and provide `Start new shell` rather than implying a live shell persists.
8. Make the visible model and execution-mode semantics accurate. Move defaults into a New conversation context or show a clear `Applies to new conversations` label. Display the active session’s effective model/mode separately when host data is available.

### Tests

- Unit tests for notification queue/reducer behavior if it is pure.
- E2E: Settings Escape/back behavior, Rules destination behavior, confirm/cancel destructive paths, untrusted-project `Review and trust` action, terminal exit/restart, and visible focus.
- Manual Tauri verification in dark and light appearance at all supported widths.

### Acceptance criteria

- There is one authoritative CSS rule set for each repaired shell component.
- No visible control claims functionality that is absent or only applies to a different scope.
- A declined trust decision is an informational, recoverable state, not a generic application error.

## 11. Slice S6 - Verification, rollout, and documentation

### Required commands

Run from repository root after each relevant slice, then run the complete suite before declaring the program complete:

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/automation typecheck
pnpm --filter @piwin/automation test
pnpm --filter @piwin/agent-host typecheck
pnpm --filter @piwin/agent-host test
pnpm --filter @piwin/desktop typecheck
pnpm --filter @piwin/desktop test
pnpm e2e:desktop
pnpm typecheck
pnpm test
```

### Native manual smoke matrix

Run against `pnpm dev:tauri`; browser mock E2E alone is not sufficient.

1. Project open -> trust -> new session -> prompt -> Stop mid-stream -> partial answer marked stopped.
2. Reopen a project with transcript history -> selected session transcript appears without a second click.
3. MCP registry draft -> configured document -> status -> Composer capability label.
4. Automation disabled/enabled combinations -> manual cron behavior and hook status are truthful.
5. 1280x840, 1024x768, and 800x700: all primary navigation paths remain reachable.
6. Keyboard-only pass: project drawer, menus, permission dialog, Settings Back/Escape behavior, focus return, and visible focus in dark/light modes.
7. Command runner: untrusted guidance -> trust -> command -> exit -> restart; confirm wording never promises a full terminal.

### Documentation updates

- Update `docs/todo-deferred.md` to state that a full PTY/xterm remains deferred and that the shipped surface is command-runner preview behavior.
- Update `docs/specs/w3-marketplace-automation.md` only if the implemented hook dispatch or automation gating resolves its previously planned acceptance items.
- Add an ADR only if the implementation changes the host protocol beyond the additive normalized abort event, changes the dual-mode model, or changes automation security policy. Routine UI cleanup needs no ADR.

## 12. Completion definition

This stabilization program is done only when all of the following are true:

1. The UI cannot show an active history session with an unrelated empty transcript.
2. Abort has one normalized, testable lifecycle across real host and mock paths.
3. MCP configuration is visibly consistent across registry, configured list, host status, and Composer.
4. Automation toggles enforce their actual host behavior; hooks execute only through the host and remain permission-gated.
5. Project/session navigation remains accessible at supported desktop widths, with keyboard-visible focus and functional menu/dialog semantics.
6. CSS conflicts are removed rather than masked by later overrides.
7. Terminal terminology is honest about current capability.
8. Targeted tests, full typecheck, full test suite, desktop E2E, and native Tauri smoke checks pass with recorded evidence.
