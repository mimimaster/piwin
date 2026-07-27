# Desktop Product-Shell Repair Plan

| Field | Value |
|---|---|
| Status | **Complete 2026-07-22** — S0–S7 executed (developer preview) |
| Date | 2026-07-22 |
| Scope | Developer-preview desktop shell: truthful core work loop, responsive correctness, native PTY enforcement, and removal of obsolete UI paths |
| Canonical backlog | `docs/todo-deferred.md` |
| Related | `docs/prd.md`, `docs/architecture.md`, `docs/adr/0009-session-resume-product-shell.md`, `docs/adr/0013-pty-tauri.md`, `docs/specs/desktop-ui-interaction-stabilization-plan.md` |
| Constraints | `AGENTS.md`; contracts first; no Pi imports in apps; no Electron; no UI-side filesystem/process execution |

## 0. Purpose

piwin currently has real host, session, media, Git, Skills, MCP, and PTY capabilities, but the desktop combines them as competing UI surfaces with contradictory runtime state. The result is not a dependable coding-agent shell.

This plan repairs the developer-preview product shell around one explicit work loop:

```text
Open trusted workspace
  -> choose or create Session
  -> prompt, observe, steer, or queue follow-up
  -> inspect real files, activity, and review data
  -> archive, resume, or export Session
```

The work is removal-first. It does not introduce another dashboard, state framework, agent kernel, or visual-design direction. It makes existing facts visible, removes false or duplicate facts, and makes one shell layout deterministic at every supported desktop width.

## 1. Locked product decisions

These decisions came from the product review and must not be reopened during implementation without a new decision record.

| ID | Decision | Implementation consequence |
|---|---|---|
| D1 | This release remains a **developer preview**. Bundled sidecar/runtime distribution is explicitly out of scope. | Do not claim installed-app release readiness. Keep the current workspace `pnpm`/`tsx` bridge only for this preview; expose its developer-preview limitation in documentation and diagnostics. |
| D2 | Desktop is **SDK-only**. RPC remains a CLI/host architecture concern until worker isolation is actually shipped. | Desktop must not show a selectable RPC mode or imply it honors `PiwinConfig.hostMode`. The bridge launches SDK explicitly and status says SDK desktop host. |
| D3 | Keep the interactive Terminal, but its trusted-project invariant must be enforced at the **Rust/Tauri boundary**. | `pty_open` authorizes its cwd through the host-owned project trust authority before it can spawn. React checks remain usability guidance only. |
| D4 | The workspace follows a focused Cursor-like shell. | Left = Sessions; center = transcript/composer; right = Files, Activity + Terminal, Review. Subagents have no permanent panel. |
| D5 | Subagents are model-invoked and visible in the parent transcript. | Remove the right-panel Subagents tab. Persist/render parent transcript activity cards for subagent start, progress, completion, failure, cancellation, and merge. |
| D6 | v0.1 default UI shows core capabilities only. | Provider/model setup, workspace trust, Sessions, prompt/run, permissions, Review, Skills, and stdio MCP remain primary. Pets, themes, prompts, extensions, memory, automation, and experimental subagent controls move under Advanced / Experimental. |
| D7 | Provider readiness does **not** gate workspace browsing or project trust. | No forced first-run wizard. Creating/sending a Session may fail truthfully with actionable provider configuration feedback; transport connection is never presented as provider readiness. |
| D8 | Model and thinking selection are per **next user turn**. | The Composer profile applies to the next prompt in the same Session. The model can change between turns without adding a synthetic chat message. |
| D9 | Cross-model turns send the complete product history. | When a model changes, the host continues the existing live session when the SDK supports it; otherwise it reconstructs a live handle from the full product transcript. It must never silently drop history. |
| D10 | Streaming supports both intervention modes. | While a run is active, Composer supports **Steer now** and **Queue follow-up**. Image attachment is disabled during a run; intervention text is text-only. |

### 1.1 External behavior reference for D8-D9

Claude Code documents `/model <alias|name>` as an immediate in-session switch. When the conversation already has output, its picker confirms that the next response re-reads full history without cached context. piwin adopts the same continuity model, but only prompts when a model is unavailable, the full history cannot fit the target context, or an active run needs an intervention choice.

Reference: <https://code.claude.com/docs/en/model-config>

## 2. Scope boundaries

### In scope

1. One responsive shell ownership model and one overlay stacking model.
2. Session-first terminology, explicit project-ready state, and no automatic Session creation after trust.
3. Per-turn Model + Thinking profile, full-history model switching, Steer, and Follow-up.
4. Structured permission presentation backed by normalized contract data.
5. Native PTY trusted-project enforcement and lifecycle proof.
6. Truthful status distinctions for desktop transport, agent backend, provider readiness, and terminal availability.
7. Right-panel consolidation and transcript-visible subagent activity.
8. Core-versus-advanced Settings/navigation grouping.
9. Deletion of obsolete rail, dock, CSS, component props, and command wording.
10. Browser boundary tests plus a repeatable manual Tauri developer-preview smoke procedure.

### Explicitly out of scope

1. Bundling a Node runtime or host sidecar for installed applications.
2. RPC process isolation worker, Desktop RPC mode, or changing CLI RPC behavior.
3. A first-run provider wizard or blocking readiness gate.
4. New cloud, marketplace, remote gateway, or plugin capability work.
5. Full Pi JSONL multi-leaf session tree support.
6. Provider-specific context compression policy beyond honest over-limit handling.
7. Terminal support outside Tauri or CLI PTY parity.
8. New decorative imagery or another general visual redesign.

## 3. Target information architecture

### 3.1 Primary shell

```text
Top bar
  Product name | workspace / active Session | command search | Composer profile summary | Inspector

Navigator
  Open / switch workspace
  New session
  Session search, pinned, recent, archived
  Transport / backend truth summary
  Settings

Stage
  Project-ready or Session transcript
  Current run status
  Permission / restored-history banners when applicable
  Composer profile + prompt input + intervention controls

Inspector (optional)
  Files | Activity | Review
  Activity contains activity log plus Terminal sub-tabs
```

### 3.2 Ownership rules

| Surface | Owns | Must not own |
|---|---|---|
| Navigator | workspace identity, trust summary, Session lifecycle | model selection, subagent management, terminal execution |
| Composer profile | next-turn model, thinking level, interaction mode | global provider configuration, hidden Session defaults |
| Transcript | narrative, tool chronology, permission/result cards, subagent activity cards | global configuration panels |
| Run status | current readable state plus one correct recovery action | duplicate logs or synthetic Git metrics |
| Inspector | Files, Activity/Terminal, Review evidence | permanent subagent dashboard |
| Settings | configuration and capability management | live run state |

### 3.3 Core and advanced navigation

`SettingsPanel` groups must become:

```text
Core
  General
  Models
  Skills
  Tools & MCPs
  Sessions

Advanced
  Appearance
  Extensions
  Prompts
  Memory
  Automation
  Pets
```

`Advanced` must visibly carry an `Experimental` label for Automation, Memory, and extensions that cannot demonstrate full support in the current runtime. Pet and theme controls have no titlebar or default-workspace entry point.

## 4. Implementation order

The slices below are intentionally ordered. Do not combine structural cleanup with behavioral changes before the existing behavior has a test boundary.

```text
S0 Baseline and contracts map
  -> S1 Responsive shell and overlays
  -> S2 Session-first work loop and focused information architecture
  -> S3 Per-turn profile, history continuity, Steer / Follow-up
  -> S4 Truthful permissions, status, and native PTY authorization
  -> S5 Core-versus-advanced navigation and subagent transcript activity
  -> S6 Delete obsolete implementation paths and consolidate CSS ownership
  -> S7 Verification, docs, and developer-preview release gate
```

Each slice is a reviewable vertical change. Run typecheck and focused tests at every slice boundary; do not postpone all verification to S7.

---

## 5. S0 - Baseline, contracts map, and explicit preview truth

### Objective

Capture current behavior before changing UI. Establish one named plan/backlog entry and make the developer-preview limitation explicit without beginning packaging work.

### Files

| Action | File |
|---|---|
| Add | `docs/plans/2026-07-22-desktop-product-shell-repair.md` (this plan) |
| Update | `docs/todo-deferred.md` |
| Update | `docs/architecture.md` |
| Update | `docs/adr/0013-pty-tauri.md` |
| Update | `apps/desktop/e2e/viewport-responsive.spec.ts` |
| Update | `apps/desktop/e2e/visual-regression.spec.ts` |

### Steps

1. Add a `PSR-*` section in `docs/todo-deferred.md` with every slice ID below. Mark D1 as an intentional developer-preview limitation, not a completed release path.
2. Update architecture capability honesty to distinguish:
   - desktop transport: Browser mock or Tauri sidecar;
   - agent backend: mock session, SDK, or SDK fallback;
   - desktop host mode: SDK-only preview;
   - terminal: Tauri PTY authorized / unavailable;
   - provider: unconfigured / credential unavailable / configured (best-effort status only).
3. Update ADR 0013 terminology: Terminal availability is a desktop capability; host `capabilities.pty` must not be used as proof that the Tauri terminal is unavailable.
4. Expand browser test viewports to `820`, `821`, `980`, `981`, `1023`, and `1024` pixels before shell changes. Each test records sidebar visibility, right-panel presentation, scrim behavior, and keyboard closure.
5. Add screenshot coverage for right inspector at compact width, Settings at compact width, and session context menu over an inspector state.

### Acceptance criteria

- The backlog names all work intentionally deferred by D1.
- Tests prove the existing breakpoint discontinuities before S1 changes them.
- No UI label claims an installed or RPC-capable Desktop product.

---

## 6. S1 - Deterministic responsive shell and overlay ownership

### Objective

Replace independent JS/CSS breakpoints and raw stacking values with a single shell layout contract.

### Design

Use `1023px` as the one compact-shell threshold:

```text
desktop: >= 1024px
compact: <= 1023px
```

`useShellLayout` remains the authoritative state owner. It exposes `layoutMode: 'desktop' | 'compact'`; `App` writes that mode as `data-layout` on `.app-shell`. Layout CSS reads `data-layout` for sidebar/right-panel placement instead of owning an independent breakpoint for those shell surfaces.

Component-level sizing may retain media queries, but no media query may independently alter shell panel versus overlay behavior.

### Files

| Action | File |
|---|---|
| Add | `apps/desktop/src/shell-layout.test.ts` or focused test colocated with the hook |
| Update | `apps/desktop/src/hooks/use-shell-layout.ts` |
| Update | `apps/desktop/src/App.tsx` |
| Update | `apps/desktop/src/project-session-sidebar.tsx` |
| Update | `apps/desktop/src/right-panel.tsx` |
| Update | `apps/desktop/src/styles/tokens.css` |
| Update | `apps/desktop/src/styles/shell.css` |
| Update | `apps/desktop/src/styles/responsive-early.css` |
| Update | `apps/desktop/src/styles/inspector-dock.css` |
| Update | `apps/desktop/src/styles/ui-modernization.css` |
| Update | `apps/desktop/e2e/viewport-responsive.spec.ts` |

### Steps

1. In `tokens.css`, define named stacking tokens such as:

   ```css
   --layer-shell: 1;
   --layer-scrim: 20;
   --layer-drawer: 30;
   --layer-menu-backdrop: 40;
   --layer-menu: 50;
   --layer-settings: 60;
   --layer-dialog: 70;
   --layer-toast: 80;
   ```

2. Change `useShellLayout` to return `layoutMode`, `sidebarOverlayOpen`, `inspectorOverlayOpen`, and a single `showOverlayScrim` derived from the same compact mode. Keep focus-return ownership in this hook.
3. Update `App.tsx` to render:

   ```tsx
   <div className="app-shell" data-layout={shell.layoutMode} ...>
   ```

   Pass `isOverlayPresentation={shell.layoutMode === 'compact'}` and the concrete sidebar close handler to `ProjectSessionSidebar`; pass `isOverlayPresentation` to `RightPanel`.
4. In `shell.css`, place desktop panels only under `[data-layout='desktop']`; place fixed drawers only under `[data-layout='compact']`.
5. Remove the duplicate right-panel overlay breakpoint rules from `responsive-early.css` and `inspector-dock.css`. Keep one owner: `inspector-dock.css`.
6. Replace raw z-index values in shell, dialogs, session menu, Radix compatibility selectors, Settings, and notifications with the new layer tokens.
7. Make Settings the sole owner of Settings Escape behavior. Remove the document-level Escape listener in `SettingsPanel`; `useShellLayout` closes Settings and restores focus to the opener.
8. Add browser assertions for:
   - every boundary width has a matching `data-layout` state and visual presentation;
   - the compact sidebar has an explicit close button;
   - the compact inspector has an explicit close button and a working scrim;
   - opening Settings blocks shell interaction;
   - session menu closes before a shell overlay can receive a click.

### Acceptance criteria

- `820`, `821`, `980`, `981`, `1023`, and `1024` all have deterministic sidebar/inspector behavior.
- One close route exists for every active overlay: close button, Escape, and compact scrim.
- No selector outside `inspector-dock.css` changes right-panel overlay placement.
- Focus returns to the opening control after Settings or a compact overlay closes.

---

## 7. S2 - Restore the focused Session work loop

### Objective

Separate workspace trust from creating work, remove overloaded words, and reduce the titlebar/right-panel surface to the product loop.

### Files

| Action | File |
|---|---|
| Update | `apps/desktop/src/hooks/use-session-actions.ts` |
| Update | `apps/desktop/src/chat-empty-state.tsx` |
| Update | `apps/desktop/src/project-session-sidebar.tsx` |
| Update | `apps/desktop/src/workspace-titlebar.tsx` |
| Update | `apps/desktop/src/right-panel.tsx` |
| Update | `apps/desktop/src/terminal-dock.tsx` |
| Update | `apps/desktop/src/run-status-strip.tsx` |
| Update | `apps/desktop/src/desktop-commands.ts` |
| Update | `apps/desktop/src/App.tsx` |
| Update | `apps/desktop/e2e/shell.spec.ts` |
| Update | `apps/desktop/e2e/visual-regression.spec.ts` |

### Steps

1. Remove implicit Session creation from `handleOpenProject` and `handleTrustProject` in `use-session-actions.ts`.
   - After trust, hydrate existing Sessions only.
   - When there are no Sessions, leave `activeSessionId` null.
   - `handleNewSession` and a selected empty-state suggestion remain the only creation paths.
2. Make `ChatEmptyState` distinguish three states without decorative assets:
   - no workspace: `Open workspace`;
   - untrusted workspace: trust notice owns the primary action;
   - trusted workspace with no active Session: `Create a session to start`, then optional task suggestions.
3. Rename conversation vocabulary:
   - sidebar section `Sessions`, not `Agents`;
   - `Search sessions`, not `Search agents`;
   - `New session` everywhere;
   - keep Composer `Mode` labels `Agent`, `Plan`, `Debug`, `Ask`;
   - reserve `Subagent` for actual child work only.
4. Reduce `WorkspaceTitlebar` to workspace/session orientation, command search, next-turn profile summary, Inspector control, and More.
   - Remove the standalone Files, Review, Subagent, and Terminal icon cluster.
   - Remove the duplicate Terminal entry in More.
   - Keep one `Inspector` control that opens the last selected inspector tab; show a compact Review indicator only when Git has known changes.
5. Change outer `RightPanelTab` from `files | terminal | review | agents` to `files | activity | review`.
   - `activity` renders the existing Activity/Terminal content.
   - Files and Review continue to render their current focused components.
   - Remove `agentsContent`, process props that are not rendered, and the outer Subagents tab.
6. Correct `RunStatusStrip` actions:
   - `Activity` opens `activity`, never the former agents tab;
   - `View plan` scrolls/focuses the transcript plan card when present, otherwise opens Activity;
   - Review action opens `review` only when real review data exists.
7. Rename command palette command `Toggle Activity / Shell dock` to `Open Activity` and map it to the Activity tab. Remove dock terminology from user-facing strings.
8. Do not create new Session summary counts or right-panel badges from placeholders.

### Acceptance criteria

- Trusting a workspace creates zero Session records.
- The only default Session creation entry is `New session` plus deliberate empty-state task actions.
- The default right inspector has exactly Files, Activity, and Review.
- `RunStatusStrip` Activity reaches real host activity/terminal content.
- There is no visible `Agents` label for ordinary conversation history.

---

## 8. S3 - Per-turn profile, full-history continuity, and intervention controls

### Objective

Implement the D8-D10 contract without lying about model continuity or silently losing history.

### 8.1 Contract design

Extend `PromptInput` in `packages/contracts/src/host.ts`:

```ts
export type PromptInput = {
  text: string;
  attachments?: MediaAttachmentRef[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  streamingBehavior?: 'steer' | 'followUp';
};
```

`model` and `thinkingLevel` apply only to the outgoing turn. They are not rendered as synthetic user/system messages and do not become a global setting.

Add a host response/data type for an over-limit model switch, for example `SessionTurnProfileError` with:

```ts
{
  code: 'model-unavailable' | 'context-limit-exceeded' | 'turn-profile-unsupported';
  message: string;
  estimatedTokens?: number;
  contextLimit?: number;
}
```

Keep this as an ordinary failed `HostResponse` with structured data; do not introduce a parallel UI transport.

### 8.2 Required SDK capability gate

Before implementing UI controls, make a fixture-backed adapter spike that determines whether the installed Pi SDK can change model and thinking on an existing session.

1. Expand the narrow `PiLikeSession` compatibility type in `sdk-adapter.ts` only after inspecting the installed SDK API.
2. Prefer an atomic per-turn SDK method or `setModel` / thinking equivalent immediately before `prompt`.
3. If the SDK supports neither operation, do **not** fake a switch in the UI. Implement this deterministic fallback:
   - dispose the current live handle only after the host has loaded the full product transcript;
   - create a new live SDK handle with the requested profile;
   - inject a structured, non-user-visible transcript context envelope containing the complete product transcript before the requested turn;
   - run the requested turn only after that reconstruction succeeds;
   - preserve product transcript as the UI source of truth under ADR 0009.
4. The fallback must run when a restored Session has no live handle as well. This closes the existing gap where a restored product transcript could appear in UI without a corresponding live model context.
5. If the full transcript exceeds the selected model context estimate, return `context-limit-exceeded`; never truncate history silently. The user may choose a longer-context model, compact, or start a new Session.

### Files

| Action | File |
|---|---|
| Update | `packages/contracts/src/host.ts` |
| Update | `packages/contracts/src/ipc.ts` |
| Update | `packages/contracts/src/index.ts` if exports change |
| Update | `packages/agent-host/src/sdk-adapter.ts` |
| Update | `packages/agent-host/src/product-shell-session.ts` |
| Update | `packages/agent-host/src/commands/session-live-commands.ts` |
| Update | `packages/agent-host/src/transcript-recorder.ts` |
| Add | focused adapter/session history tests beside `sdk-adapter.test.ts` or `product-shell-session.test.ts` |
| Update | `apps/desktop/src/hooks/use-composer-media.ts` |
| Update | `apps/desktop/src/composer-dock.tsx` |
| Update | `apps/desktop/src/composer-plus-menu.tsx` |
| Update | `apps/desktop/src/workspace-titlebar.tsx` |
| Update | `apps/desktop/src/App.tsx` |
| Update | `apps/desktop/src/chat-reducer.ts` |
| Update | `apps/desktop/e2e/shell.spec.ts` |

### Steps

1. Add `model` / `thinkingLevel` to `PromptInput`, update every `SessionHandle` implementation, mock, product-shell wrapper, IPC fixture, and test compile consumer.
2. Add `TurnProfile` UI state in the Composer domain:

   ```ts
   type TurnProfile = {
     modelKey: string;
     thinkingLevel: ThinkingLevel;
   };
   ```

   Initialize from config defaults. Keep it in `App` or a focused Composer hook, not in `ChatUiState`.
3. Remove model selection from `WorkspaceTitlebar`. The titlebar displays a read-only compact summary of the selected next-turn profile and opens the Composer profile popover when clicked.
4. Replace the existing Composer `+ -> Models` subtree with one Profile control next to the mode chip. It includes:
   - Model;
   - Thinking level;
   - selected model context window;
   - current estimate / warning when available.
5. On Send, `useComposerMedia` passes the selected `model` and `thinkingLevel` in the `session/prompt` input. It does not include profile text in the visible user message.
6. Add an explicit pre-send error display for unavailable profile or context-limit failure. Do not invent a provider readiness gate; users can still browse and trust workspaces under D7.
7. During `runPhase === 'streaming'` or `aborting`, keep a compact text-only intervention input enabled:
   - primary action: `Steer now` -> `session/steer`;
   - secondary action: `Queue follow-up` -> `session/follow_up`;
   - show which action will run before the button executes;
   - disable attachment, mode/profile changes, and image picker during a run;
   - preserve normal Stop behavior.
8. Add local reducer/Composer state for pending intervention submission and host errors. A successful steer/follow-up must appear in transcript according to host events or an explicit local user echo; it must not disappear after the request resolves.

### Tests

1. Contracts: PromptInput accepts per-turn profile; old inputs remain valid.
2. Adapter: model/thinking operation occurs before prompt and rejects unavailable model truthfully.
3. Product shell: restored history becomes available to the next live handle; fallback receives the complete transcript in order.
4. Host: over-context profile returns structured failure without creating partial assistant output.
5. Desktop: send two turns in one Session with different profile values; assert two prompt IPC payloads carry the distinct profiles and only ordinary user messages appear.
6. Desktop: streaming text intervention can steer and queue; image attachment remains unavailable while streaming.

### Acceptance criteria

- A Session can use Model A for one completed turn and Model B for the next.
- The new turn sees complete product history or is blocked with a visible context-limit error.
- No full-history truncation, hidden model switch message, or fake profile application exists.
- Steer and Follow-up work while streaming and have distinct visible actions.

---

## 9. S4 - Truthful permissions, status, and native PTY authorization

### Objective

Move security truth to contracts and native boundaries. Replace generic "Allow" behavior with reviewable, category-specific facts.

### 9.1 Structured permission contract

Add a normalized `PermissionRequestContext` in `packages/contracts` and attach it to `AgentEvent` permission requests. Preserve `action` and `detail` during migration for adapter compatibility.

```ts
type PermissionRiskKind = 'command' | 'file-write' | 'git' | 'network' | 'mcp' | 'unknown';

type PermissionRequestContext = {
  kind: PermissionRiskKind;
  summary: string;
  reason?: string;
  cwd?: string;
  command?: string;
  paths?: string[];
  host?: string;
  serverId?: string;
  branch?: string;
  remote?: string;
  destructive?: boolean;
  secretRelated?: boolean;
};
```

Host policy adapters produce this context. The desktop never parses Pi-native payloads or guesses safety from arbitrary text.

### 9.2 Native PTY authorization design

The host project trust record remains authoritative. Rust must query it internally before spawning a PTY.

1. Add an internal host command such as `project/authorize-terminal` with `{ projectPath, cwd? }`.
2. The host canonicalizes both paths and verifies:
   - the project is opened and trusted;
   - `cwd` resolves within the trusted project root;
   - `cwd` is a directory.
3. Refactor `host_bridge.rs` to expose a private Rust helper for synchronous request/response over its child stdin/stdout channel. `pty_open` calls this helper directly; it does not trust a renderer-supplied token or renderer-side trust state.
4. `pty_open` receives the requested cwd but spawns only the host-authorized canonical cwd returned by the helper.
5. On project switch, untrust, host stop, and app exit, call `pty_close_all` before allowing the next project state.

### Files

| Action | File |
|---|---|
| Update | `packages/contracts/src/host.ts` |
| Update | `packages/contracts/src/ipc.ts` |
| Update | `packages/contracts/src/project.ts` if a public authorization result type is needed |
| Update | `packages/agent-host/src/commands/project-commands.ts` |
| Update | `packages/agent-host/src/host-runtime.ts` |
| Update | `packages/agent-host/src/host-runtime.test.ts` |
| Update | `apps/desktop/src/chat-reducer.ts` |
| Update | `apps/desktop/src/app-dialogs.tsx` |
| Add | `apps/desktop/src/permission-request-card.tsx` |
| Update | `apps/desktop/src/styles/overlays-feedback.css` |
| Update | `apps/desktop/src/styles/ui-modernization.css` only if compatibility styles remain necessary |
| Update | `apps/desktop/src-tauri/src/host_bridge.rs` |
| Update | `apps/desktop/src-tauri/src/pty_host.rs` |
| Add | Rust unit tests in `pty_host.rs` or focused `src-tauri` test module |
| Update | `apps/desktop/src/tauri-pty.ts` |
| Update | `apps/desktop/src/terminal-dock.tsx` |
| Update | `apps/desktop/src/hooks/use-host-bootstrap.ts` |
| Update | `apps/desktop/src/project-session-sidebar.tsx` |

### Steps

1. Add contract fixtures for command, secret write, destructive Git, network, MCP, and unknown permission contexts.
2. Update gated bash, web/MCP permission code, Git mutation paths, and secret path checks to emit structured context.
3. Replace the raw generic permission block in `AppDialogs` with `PermissionRequestCard`:
   - command: command, cwd, risk reason, affected paths;
   - file write: exact path list and secret warning;
   - Git: branch, remote, destructive/force action language;
   - network/MCP: hostname/server identity and remembered-scope explanation;
   - unknown: raw detail fallback with no persistent approval.
4. Keep `Allow for project` only for network and MCP contexts that the host can scope precisely. Do not add persistent allow for bash, secret writes, or destructive Git.
5. Rename desktop status from `Host ready` to a truthful transport label such as `Desktop host connected`. Provide a compact expandable status record containing transport, SDK-only backend, mock state, provider config state, and terminal status.
6. Change `isTauriPtyAvailable()` from a runtime-only check to an availability probe that treats Tauri presence as necessary but not sufficient. The UI shows `Terminal` only after authorization/capability probing; otherwise it explains why it is unavailable.
7. Implement host-backed `pty_open` authorization and lifecycle cleanup in Rust. Keep renderer prechecks for responsive guidance, but test that bypassing them cannot create a PTY outside a trusted root.

### Tests

1. Host golden tests: every policy type produces expected structured context and remember scope.
2. Desktop tests: persistent allow appears only for network/MCP; command and secret writes show their specific facts.
3. Rust tests: reject empty cwd, missing directory, untrusted project, sibling path, and path traversal; accept trusted root and trusted nested cwd.
4. Tauri manual smoke: `pwd`, resize, project switch, untrust, close/reopen terminal, app close.

### Acceptance criteria

- Permission approval shows a readable risk-specific fact set, not a generic raw pre block.
- A renderer call cannot spawn a terminal in an untrusted or sibling directory.
- Provider state and terminal state are not conflated with transport connection.
- No status label claims a capability that has not been confirmed.

---

## 10. S5 - Core/advanced surfaces and transcript-visible subagent activity

### Objective

Keep the core shell focused without deleting supported secondary functionality. Model-created subagents become visible as transcript work, not a permanent dashboard.

### Files

| Action | File |
|---|---|
| Update | `packages/contracts/src/host.ts` |
| Update | `packages/contracts/src/session-index.ts` or transcript contract file as required |
| Update | `packages/agent-host/src/commands/session-live-commands.ts` |
| Update | `packages/agent-host/src/transcript-recorder.ts` |
| Update | `apps/desktop/src/chat-reducer.ts` |
| Add | `apps/desktop/src/subagent-activity-card.tsx` |
| Update | `apps/desktop/src/chat-thread.tsx` |
| Update | `apps/desktop/src/SettingsPanel.tsx` |
| Update | `apps/desktop/src/workspace-titlebar.tsx` |
| Update | `apps/desktop/src/App.tsx` |
| Update | `apps/desktop/src/desktop-commands.ts` |
| Update | `apps/desktop/e2e/shell.spec.ts` |

### Steps

1. Define normalized parent-session `subagent/*` events or equivalent transcript card data in contracts. Required lifecycle information:
   - child Session ID and display name;
   - task summary;
   - started / running / completed / failed / cancelled / merged state;
   - worktree status only when one actually exists.
2. Make the host emit those events for model-initiated or command-initiated subagent actions and persist them to the parent product transcript.
3. Render `SubagentActivityCard` inline in `ChatThread` with status, task, and a `Open session` action. Do not provide spawn/merge controls in the default workspace UI.
4. Remove `SubAgentPanel` from `RightPanel` and default navigation. Keep any management UI only under `Settings -> Advanced -> Experimental` if it remains supported.
5. Rebuild Settings navigation into Core and Advanced groups from section 3.3. Move Pet, Theme, Prompts, Extensions, Memory, and Automation out of the titlebar More menu.
6. Keep Skills and Tools & MCPs reachable from Settings and Composer context menus, but do not add a permanent global rail.
7. Update command palette to include core commands only by default. Advanced commands appear only when the Advanced section is opened or are discoverable by exact search.

### Acceptance criteria

- A model-invoked subagent is observable in the parent transcript without opening a dedicated panel.
- The right panel has no Subagents tab.
- Core configuration is easy to find; experimental surfaces are visibly separated.
- Session/product navigation remains focused without restoring the old icon rail.

---

## 11. S6 - Delete obsolete paths and assign CSS ownership

### Objective

Remove the historical UI sediment that causes stale selectors, no-op state, and future layout regressions. Do this only after S1-S5 tests protect current intended behavior.

### Files

| Action | File |
|---|---|
| Delete | `apps/desktop/src/app-rail.tsx` |
| Update | `apps/desktop/src/App.tsx` |
| Update | `apps/desktop/src/workspace-titlebar.tsx` |
| Update | `apps/desktop/src/project-session-sidebar.tsx` |
| Update | `apps/desktop/src/terminal-dock.tsx` |
| Update | `apps/desktop/src/styles.css` |
| Update | `apps/desktop/src/styles/shell.css` |
| Update | `apps/desktop/src/styles/transcript.css` |
| Update | `apps/desktop/src/styles/responsive-early.css` |
| Update | `apps/desktop/src/styles/inspector-dock.css` |
| Update | `apps/desktop/src/styles/settings-resources.css` |
| Update | `apps/desktop/src/styles/session-chrome.css` |
| Update | `apps/desktop/src/styles/ui-modernization.css` |
| Update | `apps/desktop/e2e/visual-regression.spec.ts` snapshots intentionally |

### Steps

1. Remove `AppRail`, `RailNavId`, `railNav` state, `openRailPanel`, and titlebar props that exist only for the unrendered rail.
2. Delete legacy CSS selector families only after `rg` confirms no render owner:
   - `.rail`, `.rail-btn`, and old rail variations;
   - `.workspace-switcher`, `.workspace-header`, `.workspace-identity`, `.workspace-actions`, `.workspace-popover` where unrendered;
   - `.sidebar-new-chat` where the component uses `.sidebar-new-agent` / renamed session class;
   - `.drawer-panel` and obsolete dock selectors.
3. Narrow `TerminalDock` to an inspector Activity/Terminal component:
   - remove `variant: 'dock' | 'panel'`;
   - remove `open` and `onToggle` props that are no-ops in the product composition;
   - rename the component/file to `activity-terminal-panel.tsx` if the diff remains clear; otherwise retain filename but one truthful API.
4. Assign exactly one CSS owner per selector family:
   - `shell.css`: shell grid, topbar, navigator, compact layout;
   - `transcript.css`: transcript, run status, composer, empty/project-ready state;
   - `inspector-dock.css`: Files/Activity/Review panel and its internal layout;
   - `settings-resources.css`: Settings and resource panels only;
   - `session-chrome.css`: Session list, grouping, context menu only;
   - `overlays-feedback.css`: dialogs, notices, toasts, permission card only.
5. Reduce `ui-modernization.css` to temporary ui-kit compatibility styles, then move each remaining product selector to its owner. Do not change stylesheet import order until duplicate ownership is removed and snapshots are intentionally updated.
6. Remove stale comments such as `extracted from styles.css L...` after selector ownership is clear.
7. Remove unused Sidebar props (`activePet`, `petAnimationState`, dormant overlay props if S1 supersedes them) and no-op callbacks.

### Acceptance criteria

- Every remaining component prop has a current render consumer.
- Every remaining shell selector family has one stylesheet owner.
- No user-visible command, component, or CSS label describes a bottom dock or global rail.
- Visual snapshots change only where the target shell intentionally changed.

---

## 12. S7 - Verification and documentation gate

### Required automated verification

Run in this order after each relevant slice:

```bash
pnpm --dir apps/desktop typecheck
pnpm --dir apps/desktop test
pnpm --dir apps/desktop e2e -- shell.spec.ts
pnpm --dir apps/desktop e2e -- viewport-responsive.spec.ts
pnpm --dir apps/desktop e2e -- visual-regression.spec.ts
pnpm --filter @piwin/agent-host test
pnpm typecheck
```

If contracts change, run the full workspace typecheck before reporting that the slice is complete. Update Playwright baselines only after reviewing an intentional visual diff.

### Required manual Tauri developer-preview smoke

Run `pnpm --dir apps/desktop dev:tauri` and record the result in the execution notes:

1. Start with no workspace selected; no author-specific path is prefilled.
2. Open an untrusted temporary Git project and confirm that tools/Terminal cannot run before trust.
3. Trust the project and confirm that no Session is automatically created.
4. Create a Session, send a prompt, and inspect tool activity in the Activity tab.
5. Switch Model + Thinking for the next turn; confirm complete history continuity or a clear context-limit error.
6. During a stream, use Steer now and Queue follow-up; confirm both are visible in the transcript.
7. Trigger a command, network, or MCP permission and verify category-specific facts and allowed remember scopes.
8. Open Terminal, run `pwd`, resize, switch projects, untrust, then confirm the PTY is closed and cannot reopen for the untrusted path.
9. Modify a file, complete a run, and open Review; confirm no synthetic `0 files` summary is presented.
10. Spawn a subagent through a model/tool fixture and verify its lifecycle card appears in the parent transcript.
11. Resize at 800, 820, 821, 980, 981, 1023, 1024, and 1280 pixels; verify every overlay has visible and keyboard close routes.

### Documentation completion

1. Update `docs/architecture.md` capability truth table.
2. Update `docs/adr/0013-pty-tauri.md` with host-backed native authorization design.
3. Update `docs/todo-deferred.md` with completed, deferred, and developer-preview-only work. Do not mark bundled runtime delivery done under D1.
4. Update `docs/product-status.md` if it claims release-ready PTY or installed desktop behavior not proven by this plan.
5. Record an ADR only if the SDK model-switch capability requires a new persistent host/session restoration protocol beyond the product transcript strategy in ADR 0009.

## 13. Risk register and non-negotiable failure behavior

| Risk | Required behavior |
|---|---|
| Pi SDK cannot hot-switch model or thinking | Use verified product-transcript live-handle reconstruction; if it cannot preserve full history, reject the turn and explain the unsupported capability. Never show a successful switch that did not occur. |
| Full history exceeds target model context | Block the send with estimated versus allowed context and offer a non-destructive next action. Never silently truncate. |
| Provider credentials are missing | Allow workspace browsing/trust under D7; fail Session creation/send with an actionable configuration error. Do not call this `Host ready`. |
| PTY authorization transport fails | Refuse to spawn. Do not fall back to renderer-only trust checking. |
| CSS refactor changes appearance | Restore from screenshots, isolate the selector ownership move, and do not continue into the next deletion slice. |
| Browser mock differs from Tauri | Keep browser E2E as fast coverage, but record the native smoke failure as a developer-preview blocker. Do not relabel mock coverage as native proof. |
| Existing dirty worktree changes overlap | Stop and ask before replacing files changed by another actor. Keep every cleanup commit scoped by concern. |

## 14. Definition of done

This repair plan is complete only when all of the following are true:

1. At every supported width, the shell has one layout authority and predictable overlay/focus behavior.
2. Trusting a workspace never creates a Session by itself.
3. Session, Mode, and Subagent are distinct product concepts in labels and UI locations.
4. Model + Thinking selection applies to the next turn and keeps full history or truthfully blocks the send.
5. Steer and Follow-up work during streaming without pretending image attachments are supported there.
6. Permission approval is risk-specific and native Terminal authorization cannot be bypassed through the renderer.
7. Activity opens activity, Review shows real review evidence, and no completion card presents fabricated change metrics.
8. Subagent lifecycle is visible in transcript without a permanent dashboard.
9. Core capabilities are distinct from Advanced/Experimental settings surfaces.
10. Legacy rail/dock paths and duplicate CSS selector ownership are removed.
11. Typecheck, targeted unit tests, browser E2E, visual regression, and the manual Tauri developer-preview smoke all pass with recorded evidence.
12. Documentation states that this is a developer preview until bundled runtime distribution is separately designed and verified.
