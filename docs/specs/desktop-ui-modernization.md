# Desktop UI Modernization Specification

| Field | Value |
|---|---|
| Status | Ready for implementation |
| Date | 2026-07-22 |
| Scope | Complete frontend-first productization of the desktop Agent Window |
| Related | `docs/prd.md`, `docs/architecture.md`, `docs/adr/0009-session-resume-product-shell.md`, `docs/adr/0013-pty-tauri.md`, `docs/specs/desktop-ui-interaction-stabilization-plan.md`, `docs/specs/product-depth-competitive-alignment.md` |
| Primary packages | `apps/desktop`, `packages/ui-kit` |
| Host/contracts impact | None for the initial UI modernization; consume existing normalized events and existing product-transcript outline |

## 1. Purpose

This specification turns the existing desktop Agent Window from a feature-complete shell into a coherent, controllable coding-agent workspace.

The work is deliberately frontend-first. It uses the existing normalized host protocol, product transcript, session lifecycle commands, Git commands, managed-process commands, and Tauri dialog bridge. It must not introduce Pi imports, direct filesystem/process access from React, a second host protocol, or a UI state framework.

The finished UI must make five things immediately understandable:

1. What workspace and agent session the user is in.
2. What the agent is doing now, whether it is blocked, and how the user can intervene.
3. What changed in the project and what needs review after a run.
4. How to navigate, search, resume, archive, restore, or create work without relying on mouse-only discovery.
5. What is safe, available, partial, or intentionally unavailable in the current runtime.

This document is one delivery specification. Its sections are ordered by dependency, but they are not a priority ranking. A section is complete only when its implementation and verification requirements are complete.

## 2. Product outcome

### 2.1 Product character

piwin desktop is a **quiet operational desk** for a private local coding agent:

- The transcript is the primary artifact.
- The agent's operational state is visible without opening a hidden panel.
- Secondary surfaces reveal detail without competing with the task.
- The UI uses text plus color for state; it never relies on pulsing dots, icons, or tooltips alone.
- Chrome is quiet; active work, decisions, errors, and review actions receive the strongest hierarchy.
- The app remains honest: line-oriented shell remains **Shell preview** until ADR 0013's Tauri PTY is shipped.

### 2.2 Target workspace model

```text
Global rail
  Durable product destinations: Conversations, Skills, MCP, Extensions, Appearance

Project/session navigation
  Workspace identity, trust, New Agent, session search, Pinned, recency, Archive

Active workspace
  Session identity + task context
  Run status strip when the session has active/recent operational state
  Transcript viewport with follow-tail, jump-to-latest, outline, and grouped tool work
  Composer with explicit Mode, Model, Context, Attach controls
  Shell preview / Activity dock only when opened

Inspector
  Execution, Changes, Git, Agents
  Detail and review surface; never the only place that reveals active work

Settings page
  Global configuration and capability management, with a responsive section picker
```

### 2.3 Information architecture rules

The following ownership rules are binding for the redesign:

| Area | Owns | Must not own |
|---|---|---|
| Global rail | durable product destinations and compact navigation entry points | session-specific execution controls |
| Project/session sidebar | workspace identity, trust summary, session navigation, archived-session entry | model execution controls, run detail timeline |
| Title/context area | active session identity, selected model, selected prompt mode, compact task state | duplicate model picker or hidden configuration-only mode |
| Run status strip | current agent state, active step summary, permission/compaction/stop intervention | raw output, large process logs, duplicate tool history |
| Transcript | user/assistant narrative, decisions, concise tool chronology, result/outcome cards | a second global task dashboard |
| Inspector | execution drill-down, reviewable changes, Git, sub-agent detail | hidden prerequisite for understanding whether the agent is working |
| Bottom dock | host activity and line-oriented Shell preview | primary tool timeline or a fake interactive terminal |
| Settings | configuration, capability readiness, resource health | transient run state |

## 3. Non-negotiable implementation constraints

1. `apps/desktop` continues to use only public `@piwin/*` APIs. It must not import `@earendil-works/pi-*`, Node APIs, or spawn processes directly.
2. `@piwin/ui-kit` remains a pure React presentation package. It may depend on React, Radix primitives, and `@piwin/contracts`; it may not import desktop code, host code, filesystem APIs, Tauri APIs, or Pi packages.
3. Existing `HostCommand`, `HostPush`, and normalized `AgentEvent` values remain the only host boundary. UI state derives from normalized events; the renderer must not parse Pi-native payloads.
4. Product transcript remains the chat history source of truth. `SessionOutlineNode[]` is a linear product-transcript navigation model under ADR 0009, not a Pi JSONL branch tree.
5. Session archive stays archive-first. The active transcript must not silently change to another session when the user archives or permanently deletes the active session.
6. Existing project trust gates remain in force. UI may explain trust and prompt for it; it may not weaken host permission policy or spawn shell/process work itself.
7. All destructive confirmations are application-owned Radix dialogs. `window.confirm` must not remain in session, MCP, provider, Git, or Changes flows.
8. Existing native Tauri folder/save chooser behavior remains appropriate for filesystem selection. The prohibition applies to browser-native confirmation dialogs, not the Tauri file chooser.
9. Do not add Electron, a global frontend state framework, a CSS framework, or a replacement design system.
10. Do not generate decorative images for this implementation. The current inline SVG/CSS treatment is the placeholder until a purposeful asset is explicitly approved.

## 4. Design system and visual rules

### 4.1 Semantic tokens

`apps/desktop/src/appearance-tokens.ts` remains the source that writes product appearance values to document custom properties. Expand its semantic alias layer without changing the `ThemeManifest` contract.

Add and use the following desktop CSS variables:

```css
/* surfaces */
--surface-canvas;
--surface-rail;
--surface-sidebar;
--surface-raised;
--surface-inset;
--surface-overlay;

/* content */
--content-primary;
--content-secondary;
--content-muted;
--content-disabled;

/* borders and focus */
--border-subtle;
--border-default;
--border-emphasis;
--focus-ring;

/* operational state */
--state-running;
--state-success;
--state-warning;
--state-danger;
--state-waiting;

/* layout and motion */
--space-1 through --space-8;
--control-height-compact;
--control-height-default;
--duration-fast;
--duration-standard;
--easing-standard;
```

Map the existing legacy variables (`--canvas`, `--panel`, `--text`, `--muted`, `--accent`, `--danger`, `--ok`) to those semantic roles while the old selectors are migrated. Do not delete a legacy variable before its consumers are removed.

### 4.2 Visual hierarchy

1. Functional text must normally be at least `12px`; standard supporting content must be `13px` or larger. Reserve `10px` and `11px` for non-essential metadata only.
2. The active session title, Run Status Strip, and composer action have higher visual contrast than runtime transport labels and secondary capability pills.
3. A selected model must be rendered as its actual model label, not as `Model selected`.
4. The agent's state must include readable text such as `Working`, `Planning`, `Needs permission`, `Compacting`, `Stopping`, `Stopped`, `Failed`, or `Complete`.
5. Use one accent for primary action and semantic colors only for operational state. Do not use gradients or pronounced shadows in routine chrome. Existing decorative gradients/shadows may remain only until the relevant shell surface is migrated, then must be removed or reduced to flat tokenized surfaces.
6. Transitions use 120-180ms standard durations. Add a `prefers-reduced-motion: reduce` rule that disables streaming pulse, execution pulse, hover transforms, and non-essential transitions.

### 4.3 Image policy

No generated image is needed for the implementation.

If a later visual-design pass introduces a purposeful asset, it must first be represented with a frontend placeholder and an explicit marker:

```text
IMAGE_ASSET: empty-workspace-local-repository-illustration
Placement: ChatEmptyState visual area
Purpose: Explain local/private workspace state; decorative only
Accessibility: aria-hidden; text CTA remains complete without the image
```

The current inline SVG in `apps/desktop/src/chat-empty-state.tsx` remains until such an asset is supplied. Any final asset must have light/dark compatibility and may not convey information that is unavailable in text.

## 5. Shared UI primitive implementation

### 5.1 Package changes

Extend `packages/ui-kit` with focused primitives. This package owns behavior, semantic markup, and stable class names. Desktop styles the primitives through the desktop token system.

Update `packages/ui-kit/package.json` during implementation using `pnpm add` with current compatible versions:

- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-context-menu`
- `@radix-ui/react-popover`
- `@radix-ui/react-tabs`

Keep `react` as a peer dependency. Move the direct runtime dependency on `@radix-ui/react-tabs` from `apps/desktop/package.json` to `packages/ui-kit/package.json` after desktop consumers migrate. Do not add a full component library.

### 5.2 New public modules

Create these files and export each intentionally from `packages/ui-kit/src/index.ts`.

| File | Public API | Requirements |
|---|---|---|
| `menu.tsx` | `DropdownMenu`, `DropdownMenuItem`, `DropdownMenuSeparator`, `ContextMenu`, `ContextMenuItem`, `ContextMenuSeparator` | Radix-owned focus, Escape, outside interaction, arrow navigation, Home/End, focus restoration, collision-aware position; menu action labels are readable text. |
| `popover.tsx` | `Popover`, `PopoverTrigger`, `PopoverContent` | Radix-owned anchor, focus behavior, collision handling; use for session outline and Composer context details. |
| `confirm-dialog.tsx` | `ConfirmDialog`, `ConfirmDialogTone` | Controlled `open`, `onOpenChange`, title, description, affected-object label, confirm/cancel labels, `busy`, `error`, `onConfirm`; prevents dismissal while busy; all mutation knowledge remains in app consumers. |
| `notice.tsx` | `Notice`, `NoticeTone` | `info`, `success`, `warning`, `error`; optional title/action/details; correct `role=status` or `role=alert`; no queue policy. |
| `status-badge.tsx` | `StatusBadge`, `StatusTone` | Text label is required; optional dot is supplemental; supports `running`, `success`, `warning`, `danger`, `neutral`. |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Wrapper around Radix Tabs with a stable class contract and correct trigger/content IDs. |
| `field.tsx` | `Field`, `FieldLabel`, `FieldDescription`, `FieldError` | Connect labels, help, validation, and `aria-describedby`; field consumer owns the actual input/select/textarea state and validation rules. |

### 5.3 Primitive tests

Add colocated tests where behavior is pure and stable. Add Playwright coverage for browser focus behavior, because Radix focus restoration and keyboard navigation are browser interaction behavior.

- `packages/ui-kit/src/confirm-dialog.test.tsx`: state/label/disabled rendering if a DOM test harness is introduced.
- `packages/ui-kit/src/status-badge.test.tsx`: tone/label mapping if useful.
- Do not add a DOM testing dependency solely for trivial class assertions. If a React DOM test stack is added, justify it in the implementation commit as required for focus/component semantics; otherwise make Playwright the authoritative behavioral suite.

## 6. Shell navigation, responsive layout, and keyboard command model

### 6.1 Presentation state

Create `apps/desktop/src/hooks/use-shell-layout.ts` with a focused shell-local state model. It owns no host business state.

```ts
type ShellOverlay = 'none' | 'sessions' | 'inspector';

type ShellLayoutState = {
  overlay: ShellOverlay;
  inspectorTab: RightPanelTab;
  terminalDockOpen: boolean;
  settingsOpen: boolean;
};
```

The hook must provide:

- `openSessions`, `openInspector(tab)`, `closeOverlay`, `toggleTerminalDock`, `openSettings(section)`, and `closeSettings`.
- Mutual exclusion: a narrow-window session overlay and inspector overlay cannot be open simultaneously.
- `Escape` routing with this order: active Radix dialog/menu/popover handles Escape first; then settings closes; then shell overlay closes; then terminal dock closes only when it owns focus and no more specific layer is open.
- Focus restoration to the trigger that opened a shell overlay. Store only `HTMLElement | null` refs in the hook; do not serialize this state.
- Wide layouts retain persistent sidebar/inspector behavior. The overlay coordinator changes only narrow-window presentation.

Update `App.tsx` to consume the hook instead of owning independent `navDrawerOpen`, `rightPanelOpen`, `rightPanelTab`, `settingsOpen`, and terminal coordination flags directly. `App.tsx` remains an orchestrator; do not move new unrelated domain behavior into it.

### 6.2 Responsive behavior

Implement and verify these desktop ranges:

| Viewport | Expected behavior |
|---|---|
| `>= 1280px` | Rail, persistent session sidebar, workspace, optional inspector; all title/context controls readable. |
| `1024px-1279px` | Rail, 240px sidebar, workspace; inspector is optional and may be narrower but has readable active tab label. |
| `800px-1023px` | Rail remains; session navigation and inspector open as one mutually-exclusive overlay; each overlay has a scrim, explicit close control, Escape behavior, and focus restoration. Composer remains reachable. |
| `<800px` | Not a primary support target; preserve basic reachability using the same overlay rules and establish Tauri minimum window dimensions if testing proves critical controls cannot remain usable. |

Update `apps/desktop/src-tauri/tauri.conf.json` only after native validation determines the minimum supported window size. If `800x700` works, set that as the minimum. If it does not, set the smallest validated width/height and document it in this spec's verification output.

### 6.3 Required component changes

- `apps/desktop/src/App.tsx`: compose shell layout hook; render `ShellOverlayScrim` only when a narrow overlay is open; pass explicitly controlled open/close props to sidebar and inspector.
- `apps/desktop/src/app-rail.tsx`: retain icon rail but add a clearly labelled Conversations/Session navigation trigger that reports `aria-expanded` and controls the sidebar overlay at narrow widths. Keep tooltips; add a compact visible label in the narrow rail menu if room permits.
- `apps/desktop/src/project-session-sidebar.tsx`: accept `overlayOpen`, `onCloseOverlay`, and `isOverlayPresentation`; render an accessible Close navigation button only in overlay mode. Do not hide the session menu button solely on hover for the active row or keyboard focus.
- `apps/desktop/src/right-panel.tsx`: accept overlay props; render an explicit close control in overlay mode only. Wide layouts collapse the inspector via the titleband toggle, not a duplicate panel close control. The `tabpanel` must have an ID and `aria-labelledby` matching the selected tab.
- `apps/desktop/src/SettingsPanel.tsx`: render `main` landmark with heading association. At narrow widths, replace persistent left navigation with a section picker or horizontally scrollable tab-style selector. The displayed Escape affordance must correspond to actual close behavior.

### 6.4 Command palette and shortcuts

Create a desktop-local command palette without a new runtime dependency:

- `apps/desktop/src/command-palette.tsx`
- `apps/desktop/src/use-desktop-shortcuts.ts`
- `apps/desktop/src/desktop-commands.ts`

Implement the palette with `@piwin/ui-kit/Dialog`, a native text input, and deterministic case-insensitive token matching. It does not need fuzzy-ranking infrastructure in the first implementation.

Commands must include:

| Shortcut | Command | Behavior |
|---|---|---|
| `CmdOrCtrl+K` | Open Command Palette | Focus palette filter; Escape restores prior focus. |
| `CmdOrCtrl+N` | New Agent | Creates a session only when project trust/session requirements permit; otherwise opens the appropriate trust/open flow. |
| `CmdOrCtrl+Shift+F` | Search Agents | Opens session sidebar if needed and focuses its search input. |
| `CmdOrCtrl+L` | Focus Composer | Focuses the composer textarea when enabled. |
| `CmdOrCtrl+Shift+I` | Toggle Inspector | Opens/closes inspector, defaulting to Execution. |
| `CmdOrCtrl+J` | Toggle Activity / Shell dock | Toggles bottom dock without misrepresenting Shell preview as PTY. |
| `Escape` | Contextual close | Uses the shell routing rules above. |

The palette must show human-readable availability reasons for disabled commands, such as `Open a trusted workspace first`. It must never quietly invoke a blocked host action.

## 7. Session context, run-state model, and execution surfaces

### 7.1 Desktop-local run status model

Create `apps/desktop/src/run-status.ts`. It derives a presentation-only status from existing desktop state:

- `ChatUiState.runPhase`
- `ChatUiState.permissionPrompt`
- `ChatUiState.compacting`
- active assistant tool cards
- `SessionPlan`
- managed process list
- current `error`
- most recent terminal event recorded by the reducer

Use this local union:

```ts
type RunStatusKind =
  | 'idle'
  | 'planning'
  | 'working'
  | 'waiting-permission'
  | 'compacting'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'complete';

type RunStatusView = {
  kind: RunStatusKind;
  label: string;
  summary: string;
  activeToolName?: string;
  completedToolCount: number;
  runningProcessCount: number;
  primaryAction?: 'view-activity' | 'review-permission' | 'view-plan' | 'retry';
  canStop: boolean;
};
```

Extend `apps/desktop/src/chat-reducer.ts` only with the minimum session-local data required to render a stable terminal status. Add a reducer action/event outcome field rather than inferring `Stopped` from a vanished streaming boolean:

```ts
type RunTerminalState =
  | { kind: 'none' }
  | { kind: 'stopped'; at: number }
  | { kind: 'failed'; message: string; at: number }
  | { kind: 'complete'; at: number };
```

Map existing events as follows:

- `message/start`, `tool/start`, `tool/update`: working.
- active `SessionPlan` with planning state: planning.
- `permission/request`: waiting-permission.
- `compaction/start`: compacting.
- `run/aborting`: stopping.
- `session/aborted`: stopped.
- `message/end`: complete when no tool/process remains running.
- normalized `error`: failed.

This is a desktop presentation extension. It must not add a Pi-specific event or duplicate transcript data.

### 7.2 Run Status Strip

Create `apps/desktop/src/run-status-strip.tsx`.

Render it below `WorkspaceTitlebar` and above the transcript whenever status is not idle. It has a compact layout:

```text
[ Working ]  Reading packages/agent-host/src/host-runtime.ts
2 tools complete · 1 process active                         [Activity] [Stop]
```

Required variants:

| Status | Copy and action |
|---|---|
| Planning | `Planning` + plan step summary + `View plan` |
| Working | active tool/step summary + completed/running counts + `Activity` and visible `Stop` |
| Waiting permission | `Needs permission` + request action summary + `Review request` |
| Compacting | `Compacting context` + `Cancel` |
| Stopping | `Stopping...`; Stop disabled; no duplicate Send action |
| Stopped | `Stopped`; dismisses automatically when next prompt starts, remains visible long enough for user confirmation |
| Failed | `Run failed` + concise user-safe message + `View details` or `Retry` only where valid |
| Complete | `Complete` + outcome summary only when work produced tools/processes/changes; it must not create noise for every plain conversational response |

Pass actions from `App.tsx`; the strip remains presentational and does not request host commands itself.

### 7.3 Title/context area consolidation

Refactor `apps/desktop/src/workspace-titlebar.tsx` and `apps/desktop/src/composer-dock.tsx` so each control has one durable home.

| Control | New home | Required behavior |
|---|---|---|
| Active session name and project | Title/context area | Readable title and project path tooltip. |
| Selected model | Title/context area and composer context chip share one `selectedModelKey` | Render actual selected label; selecting in one updates both. Remove duplicate hidden model navigation. |
| Prompt intent (`Agent`, `Plan`, `Debug`, `Ask`) | Composer | Display scope text: `Plan - read-only`, `Ask - no changes`, `Debug - investigate`, `Agent - edit and run`. |
| New-session execution mode | New Agent flow/settings | Rename it `New session default`; do not present it as a current prompt mode in the active session titlebar. |
| Token/context usage | Title/context area | Compact text remains; add warning style when the existing usage ratio reaches an agreed threshold. |
| Execution/Changes/Git/Agents | Inspector toolbar | One coherent session utility area; remove the unstructured titlebar More menu. |
| Activity/Shell preview | Bottom dock trigger | Retain truthful Shell label. |

`WorkspaceTitlebar` receives a single `onOpenInspector(tab)` prop and explicit model/context props. It must not own an ad hoc More menu boolean.

### 7.4 Inspector and dock behavior

Refactor `apps/desktop/src/right-panel.tsx`:

- Keep `Execution`, `Changes`, `Git`, and `Agents`.
- Give every tab a visible text label when space allows. On compact layout, retain icon plus tooltip and expose the active tab name in the panel heading.
- Use stable `id`, `aria-controls`, and `aria-labelledby` relations for each tab/panel.
- Execution remains the detailed activity drill-down: plan, tool timeline, process state, token usage, raw tool output.
- When a tool begins, the Run Status Strip changes immediately. If inspector is already open, switch it to Execution; do not forcibly open the inspector and steal focus.
- When a run completes after changed-file work, refresh Changes data and show a completion outcome card with `Review changes` that opens Changes. Do not switch panels automatically while the user is reading elsewhere.

Refactor `apps/desktop/src/terminal-dock.tsx`:

- Keep only Activity and **Shell preview** terminology.
- Complete tab relationships and keyboard behavior.
- Preserve existing trust gate and piped-shell behavior.
- Do not include xterm.js, interactive terminal claims, or a Tauri PTY implementation in this specification.

## 8. Transcript navigation, tool grouping, and result review

### 8.1 Product transcript outline

Use the existing outline field from product session resume. No new contract is required.

Update `apps/desktop/src/chat-reducer.ts`:

- Add `outline: SessionOutlineNode[]` to `ChatUiState`.
- Extend `session/load-messages` action with optional `outline`.
- Clear outline on project/session replacement.
- Retain it while an active session is archived so the transcript stays navigable.

Update `apps/desktop/src/hooks/use-session-actions.ts`:

- Read `outline` from `session/resume` payload.
- When fallback `session/messages` is used and no outline is returned, derive a desktop-local outline from loaded transcript message boundaries. Keep derivation in a pure `transcript-outline.ts` module and test it.

Create:

- `apps/desktop/src/transcript-outline.ts`
- `apps/desktop/src/transcript-outline.test.ts`
- `apps/desktop/src/transcript-outline-popover.tsx`

The outline must list user prompts, assistant headings/turns, tool batches, compaction events, and terminal failures. Clicking an item scrolls to `#msg-<message-id>`; it does not attempt to render a Pi branch tree.

### 8.2 Transcript viewport behavior

Create:

- `apps/desktop/src/transcript-viewport.tsx`
- `apps/desktop/src/use-transcript-scroll.ts`
- `apps/desktop/src/transcript-viewport.test.ts` for pure thresholds/selection logic if applicable.

Move the `chat-stream` scroll container from raw `App.tsx` markup into `TranscriptViewport`. It wraps `ChatThread` and owns only scroll presentation state:

```ts
type TranscriptScrollState = {
  followTail: boolean;
  unreadActivityCount: number;
  showJumpToLatest: boolean;
};
```

Required behavior:

1. When the user is at the bottom within a documented threshold, new streamed content follows the tail.
2. When the user scrolls away from the bottom, streamed content does not yank the viewport.
3. While away from the bottom, each completed incoming assistant turn or tool activity batch increments `unreadActivityCount`.
4. A floating `Jump to latest` control appears with the unread count. It scrolls smoothly, resets count, and returns focus only when invoked by keyboard.
5. Resuming a session loads transcript at the bottom by default. Selecting an outline item scrolls to that item and turns follow-tail off until the user chooses to return.
6. A long transcript renders without virtualization initially. Capture a realistic long-history test fixture before adding virtualization. Do not virtualize Markdown/Mermaid/iframe-rich rows without measured evidence and a scroll-anchor design.

### 8.3 Tool batching in the transcript

Create `apps/desktop/src/turn-tool-group.tsx` and retain `ToolCallCard` as the detailed row.

For each assistant message:

- 0-2 tools: render current compact cards.
- 3 or more completed tools: render a summary first, for example `12 tools completed` or `11 completed, 1 failed`; disclose cards on demand.
- Any running or failed tool remains visible without collapsing.
- The summary includes status text, never color only.
- Existing `ToolCallDensity` continues to control inspector detail. The transcript remains compact by default.

Use message adjacency as the initial grouping boundary. Do not add host metadata until the UI proves a stronger cross-turn grouping model is needed.

### 8.4 Run outcome and changes-first review

Create `apps/desktop/src/hooks/use-workspace-changes.ts` to request existing `git/status` and `git/diff-summary` commands for the active trusted project. It owns only presentation data and refresh timing.

Refresh when:

- a run reaches `complete`, `stopped`, or `failed` after tool activity;
- the user explicitly refreshes Changes;
- project path changes.

Create `apps/desktop/src/run-outcome-card.tsx` and show it only after an operational run with relevant output:

```text
Complete
Changed 4 files · +120 -18
[Review changes] [Open Git] [Continue]
```

If no file change exists, summarize completed tools/processes only when it helps explain the result. This card is a result marker, not a second assistant message and not a host transcript mutation.

Update `apps/desktop/src/changes-panel.tsx` to be the review-first detail view:

- Group or clearly sort staged, unstaged, untracked, conflicted, and deleted files.
- Preserve selection state across refresh when paths remain.
- Keep stage/unstage behind application-owned confirmation.
- Add an `Open in configured editor` action only if an existing safe desktop/Tauri open resource path is available. Do not add direct OS process launching from React for this spec.

## 9. Composer, trust, and first-run workflow

### 9.1 Composer layout

Refactor `apps/desktop/src/composer-dock.tsx` and replace the broad overloaded plus menu with stable semantic zones:

```text
[Attach] [Mode: Agent] [Model: Provider / Model] [Context: workspace]
----------------------------------------------------------------
Prompt textarea
----------------------------------------------------------------
[Skills: 2] [MCP: 3 online] [Compact context]     [Send or Stop]
```

Requirements:

- `Attach` owns image picker/paste/drop. It does not own mode or model selection.
- Mode is a direct menu/popover control using the shared primitive.
- Model is a direct menu/popover control using the shared primitive and displays the actual label.
- Context popover shows selected/available Skills and MCP state using explicit language: `Enabled for this prompt`, `Available`, `Offline`, `Manage skills`, `Manage MCP`.
- The existing selected model/config currently applies to new session creation. The UI must label this truthfully until a contract-backed per-prompt/per-session override exists. Do not imply that a current live session will switch model mid-run if it cannot.
- Show compact keyboard guidance: `Enter to send`, `Shift+Enter for newline`. Do not add a send-preference setting in this spec unless user requirements require it later.
- When streaming, render a labelled `Stop` control in the strip and composer. The composer may retain the compact icon only if the strip's text Stop is visible; otherwise it must have visible text.

Migrate `apps/desktop/src/composer-plus-menu.tsx` last within this section. Replace document-level `mousedown`/`keydown` listeners with Radix-owned menu/popover behavior. Preserve image attach and menu data refresh behavior from `App.tsx`/`use-composer-media.ts`.

### 9.2 Project trust presentation

Create `apps/desktop/src/project-trust-notice.tsx` and render it in the active workspace when:

- a project is open but untrusted; or
- a composer action is blocked by trust.

The notice must state:

- Agent tools and Shell preview are blocked until the project is trusted.
- Trust is project-scoped.
- The user can choose `Trust project` or `Not now`.

The existing Radix trust dialog remains the confirmation mechanism. The sidebar trust label becomes a concise `Trusted` / `Untrusted` `StatusBadge`, not the sole explanation for a disabled composer.

### 9.3 Empty and first-run state

Refactor `apps/desktop/src/chat-empty-state.tsx` to use `@piwin/ui-kit/EmptyState` while retaining its inline SVG placeholder.

For an open trusted workspace with no active messages, show:

- workspace/repository name;
- selected model/default availability summary;
- concise capability readiness summary: project trust, Skills count, MCP online/offline count where available;
- explicit `New Agent` action;
- four task templates: `Understand this repository`, `Find failing tests`, `Plan a change`, `Review uncommitted changes`.

Template selection must create/activate an agent if necessary, set the appropriate prompt intent, and place the text in the composer. It must not send the prompt without a user send action.

## 10. Session lifecycle and search behavior

### 10.1 Session rows and groups

Retain `apps/desktop/src/session-groups.ts` as the pure owner of Pinned and time grouping. It already produces `Pinned`, `Today`, `Yesterday`, `Previous 7 days`, and `Older` groups.

Update `apps/desktop/src/project-session-sidebar.tsx`:

- Replace the pin emoji with an inline `IconPin` from `shell-icons.tsx`, marked `aria-hidden`, plus text/label state where useful.
- Every row shows session name and one-line latest preview.
- On wide desktops, render relative update time and status metadata when data exists.
- The active row exposes its action menu without requiring hover; non-active rows expose it on hover and keyboard focus.
- An active run has a readable `Working` indicator in its row.
- Search has an accessible clear control and command shortcut hint.
- Archived state has a clear header/count and a recovery action returning to active sessions.

### 10.2 Archive, restore, and permanent delete

Refactor `apps/desktop/src/hooks/use-session-actions.ts` and `apps/desktop/src/chat-reducer.ts` to preserve active context.

When archiving the active session:

1. Keep its transcript, outline, and active title visible.
2. Remove it from the normal sidebar list without selecting another session.
3. Set desktop-local `activeSessionArchived: true` plus an archived session summary.
4. Render `apps/desktop/src/session-archived-banner.tsx` above the composer with `Archived`, `Restore`, and `New Agent` actions.
5. Do not automatically call `handleResumeSession` for a different session.

When restoring:

- Clear archived-active state.
- Refresh active list.
- Keep the current transcript open if it is the restored session.
- Show a success notification with the session name.

When permanently deleting the active archived session:

- Show `ConfirmDialog` with session name and a statement that transcript files are removed.
- On confirm, clear active transcript and render the standard empty/new-agent state. Do not choose another session automatically.
- Return focus to the archived-session list control if it remains mounted; otherwise to the New Agent action.

### 10.3 Menu migration

Replace the current fixed `SessionRowMenu` and `AppDialogs` manual backdrop:

- Extract the session action list into a pure desktop module, `apps/desktop/src/session-actions-menu.ts`, so dropdown and context menu share the same action visibility rules.
- Wrap session rows with `@piwin/ui-kit/ContextMenu` for right-click actions.
- Use `@piwin/ui-kit/DropdownMenu` for the ellipsis action button.
- Remove `sessionMenu` screen-coordinate state from `App.tsx` and `AppDialogs` after migration.
- Keep exact action rules: active session has Pin/Unpin, Rename, Duplicate, Export, Archive; archived session has Restore, Rename, Export, Delete permanently.

### 10.4 Session search

Keep existing remote search command usage in `App.tsx`, but refactor search into `apps/desktop/src/session-search.ts` or a focused hook if it exceeds presentation orchestration.

Required behavior:

- Local match results render immediately.
- Remote indexed results replace/enrich local results after the existing debounce.
- Search result mode clearly identifies results outside the currently visible active/archived list.
- Selecting a result closes narrow sidebar overlay, resumes that session, and focuses the transcript heading rather than leaving focus stranded on a hidden row.
- `CmdOrCtrl+Shift+F` focuses the field.

## 11. Confirmations, menus, notices, and error recovery

### 11.1 Confirmation ownership

Use declarative, controlled `ConfirmDialog` state. Do not implement a global promise-based confirmation singleton and do not put callbacks in React state.

For session deletion, create an app-owned discriminated request in `App.tsx`:

```ts
type AppConfirmationRequest =
  | { kind: 'session-delete'; sessionId: string; sessionName: string }
  | null;
```

Expose `requestDeleteSession(sessionId)` and `confirmDeleteSession(sessionId)` from `use-session-actions.ts`. `App.tsx` renders the dialog and invokes the explicit confirmation handler.

For local panels, keep confirmation state within the owner:

| Component | Confirmed action |
|---|---|
| `McpPanel.tsx` | Remove selected MCP server |
| `ProviderSettings.tsx` | Remove selected provider |
| `changes-panel.tsx` | Stage/unstage selected or all paths |
| `GitPanel.tsx` | Stage, unstage, commit, create branch, checkout |

Replace every `window.confirm` use. Preserve `window.prompt` only for the existing browser-only session-export fallback until that path has a structured browser save alternative; it is not a destructive confirmation.

### 11.2 Notice and feedback model

Keep `apps/desktop/src/notification-queue.ts` and its TTL/reducer policy in desktop. It is application state, not ui-kit state.

Use `Notice` for local, persistent feedback near the initiating form/action, and use `NotificationRegion` for cross-screen completion/error messages.

Apply these rules:

| Event | Local feedback | Toast |
|---|---|---|
| Form validation failure | Field error / Notice error | No duplicate toast |
| Host mutation failure | Notice error at action surface | Optional sticky error only when user may navigate away |
| Successful rename/archive/restore/duplicate | no persistent local message unless current state changes | success toast with object name |
| Successful destructive delete | resulting empty/list state | success toast with object name |
| Copy success/failure | screen-reader status + button feedback | no toast needed |
| Read-only restored history | informational session notice with `Start live agent` explanation | no error toast |
| Renderer error | stable recovery surface | no raw stack/message as dominant UI |

Update `apps/desktop/src/message-actions.tsx` to accept an optional `onFeedback` callback or use an injected desktop notification callback. Clipboard failures must produce accessible feedback instead of being silently swallowed.

### 11.3 Error boundary

Update `apps/desktop/src/AppErrorBoundary.tsx`:

- Default message: friendly and stable; do not render `error.message` as the primary error content.
- Render `Reload` plus `Copy diagnostics`.
- Put raw error message and component stack only inside a closed `details` technical section.
- `Copy diagnostics` may use browser clipboard and must report success/failure via an aria-live message.
- Add `Open host activity` only if a safe existing in-app callback can be passed from the app; do not introduce global mutable host state solely for this button.

## 12. Settings and resource-management surfaces

### 12.1 Settings page

Update `apps/desktop/src/SettingsPanel.tsx`:

- Use a `main` landmark and one page heading.
- Make close behavior match the visible Back/Escape affordance.
- Preserve selected settings section when closing/reopening during a session.
- At narrow sizes, replace the fixed left nav with a labelled section selector using `@piwin/ui-kit/Tabs` or a menu/popover.
- Add a capability readiness summary at the top of General:

```text
Model: ready / no provider
Project tools: trusted workspace required / ready
MCP: configured count and offline count
Skills: enabled count
Web: configured / missing key
Shell: preview only until PTY is available
```

The summary consumes existing config/host status only. It must not invent availability.

### 12.2 Resource panel migration

Migrate resource panels to shared primitives without moving their host request logic into `ui-kit`.

| Panel | Required migration |
|---|---|
| `McpPanel.tsx` | ui-kit Tabs, Field, Notice, StatusBadge, ConfirmDialog; preserve canonical `McpConfigDocument` behavior. |
| `SkillsPanel.tsx` | ui-kit Tabs, Field, Notice, StatusBadge where state is available. |
| `ProviderSettings.tsx` | Field, Notice, ConfirmDialog; retain raw-key rejection and key-reference security rules. |
| `ExtensionsPanel.tsx` | Notice/StatusBadge for enabled and security state. |
| `AutomationPanel.tsx`, `MemoryPanel.tsx`, `PromptsPanel.tsx`, `ThemePanel.tsx`, `PetPanel.tsx` | Audit and replace repeated error/info/field patterns; do not change their host contracts. |
| `changes-panel.tsx`, `GitPanel.tsx` | ConfirmDialog, Field, Notice, StatusBadge; preserve policy-gated mutation commands and no force-push/hard-reset scope. |

## 13. CSS file structure and migration

Retain `apps/desktop/src/styles.css` as the only import from `main.tsx`, but convert it into a deterministic entrypoint:

```css
@import './styles/tokens.css';
@import './styles/base.css';
@import './styles/ui-primitives.css';
@import './styles/shell.css';
@import './styles/transcript.css';
@import './styles/inspector-dock.css';
@import './styles/settings-resources.css';
@import './styles/overlays-feedback.css';
@import './styles/responsive.css';
@import './styles/accessibility.css';
```

Create the listed files under `apps/desktop/src/styles/`.

Migration rules:

1. Move selectors without visual changes first, preserving source-order behavior temporarily.
2. Establish exactly one canonical definition for `:root`, `.app-shell`, `.rail`, `.sidebar`, `.titlebar`, `.chat-stream`, `.composer-card`, `.right-panel`, `.settings-page`, `.modal`, `.notice`, and responsive media queries.
3. Delete prototype-era duplicate/override blocks after their selectors are relocated and screenshot tests prove intended output.
4. Hard-coded dark-only values in the empty state, code block, artifact, error, and surface styles must use semantic variables or a documented light-theme override.
5. Shared ui-kit class rules live in `ui-primitives.css`; desktop-only composition rules remain in their domain stylesheet.
6. Do not use CSS Modules for this migration. Existing class contracts and application theme variables are global by design.

## 14. Accessibility requirements

Every implementation section must satisfy the following acceptance rules.

### 14.1 Keyboard and focus

- All menus open with focus on the first actionable item, support ArrowUp/ArrowDown/Home/End, close on Escape, close on outside interaction, and restore focus to their trigger.
- Context menus use the same keyboard semantics as dropdown menus.
- Dialogs trap focus through Radix and restore focus on close. Destructive dialog default focus is `Cancel`; explicit confirmation is required to execute mutation.
- Every inspector and dock tab has `role=tab`, `aria-selected`, `aria-controls`; every active panel has `role=tabpanel`, ID, and `aria-labelledby`.
- Narrow overlays have a labelled close button, accessible scrim behavior, Escape close, and focus restoration.
- Keyboard shortcuts do not fire while the user is editing text except for documented palette/escape behavior.
- The composer can always be reached by its shortcut when enabled.

### 14.2 Announcements and semantic state

- A colored dot is never the only representation of state.
- Error notices use `role=alert` only for immediate failures; ordinary status/success uses `role=status` or a polite live region.
- Transcript streaming must not announce every text delta. Announce meaningful state changes such as `Agent started`, `Needs permission`, `Stopped`, `Complete`, or `Run failed`.
- Form errors use `aria-invalid` on controls and include the error/description IDs in `aria-describedby`.
- Empty-state visuals are decorative and `aria-hidden`.
- `prefers-reduced-motion: reduce` disables non-essential animation.

### 14.3 Contrast and target size

- Verify dark and light themes against WCAG AA contrast for primary text, supporting text, focus ring, buttons, status text, and disabled state distinction.
- Keyboard-visible controls must have clear focus ring that is not hidden by overflow.
- Icon-only actions have accessible name and tooltip. Critical state/action is not tooltip-only.
- Interactive targets are at least 32px in dense desktop chrome; primary actions use the standard control height.

## 15. File-by-file implementation map

### 15.1 New files

```text
packages/ui-kit/src/menu.tsx
packages/ui-kit/src/popover.tsx
packages/ui-kit/src/confirm-dialog.tsx
packages/ui-kit/src/notice.tsx
packages/ui-kit/src/status-badge.tsx
packages/ui-kit/src/tabs.tsx
packages/ui-kit/src/field.tsx

apps/desktop/src/hooks/use-shell-layout.ts
apps/desktop/src/use-desktop-shortcuts.ts
apps/desktop/src/desktop-commands.ts
apps/desktop/src/command-palette.tsx
apps/desktop/src/run-status.ts
apps/desktop/src/run-status-strip.tsx
apps/desktop/src/transcript-outline.ts
apps/desktop/src/transcript-outline-popover.tsx
apps/desktop/src/use-transcript-scroll.ts
apps/desktop/src/transcript-viewport.tsx
apps/desktop/src/turn-tool-group.tsx
apps/desktop/src/hooks/use-workspace-changes.ts
apps/desktop/src/run-outcome-card.tsx
apps/desktop/src/project-trust-notice.tsx
apps/desktop/src/session-archived-banner.tsx
apps/desktop/src/session-actions-menu.ts
apps/desktop/src/styles/tokens.css
apps/desktop/src/styles/base.css
apps/desktop/src/styles/ui-primitives.css
apps/desktop/src/styles/shell.css
apps/desktop/src/styles/transcript.css
apps/desktop/src/styles/inspector-dock.css
apps/desktop/src/styles/settings-resources.css
apps/desktop/src/styles/overlays-feedback.css
apps/desktop/src/styles/responsive.css
apps/desktop/src/styles/accessibility.css
```

### 15.2 Existing files to modify

| File | Required change |
|---|---|
| `packages/ui-kit/package.json` | Add scoped Radix primitive dependencies; move Tabs ownership here after migration. |
| `packages/ui-kit/src/index.ts` | Export all new primitives/types intentionally. |
| `apps/desktop/package.json` | Remove direct Tabs dependency after ui-kit migration; add no unnecessary framework. |
| `apps/desktop/src/App.tsx` | Replace scattered shell/menu/confirmation state with focused hooks and discriminated confirmation request; compose status strip, transcript viewport, outcome card, trust/archived notices, command palette. |
| `apps/desktop/src/main.tsx` | Continue importing `styles.css`; no host change. |
| `apps/desktop/src/styles.css` | Become CSS import entrypoint only. |
| `apps/desktop/src/appearance-tokens.ts` | Write semantic aliases and light/dark-safe values. |
| `apps/desktop/src/app-rail.tsx` | Responsive session navigation trigger and shortcut/discoverability behavior. |
| `apps/desktop/src/project-session-sidebar.tsx` | Overlay close behavior, session metadata, accessible actions/search/archive state, StatusBadge. |
| `apps/desktop/src/workspace-titlebar.tsx` | Context consolidation; remove bespoke More menu; explicit model/task context. |
| `apps/desktop/src/right-panel.tsx` | Correct tabs/panels, readable active tab, overlay behavior, execution details. |
| `apps/desktop/src/terminal-dock.tsx` | Correct tab semantics; preserve Shell preview wording and trust behavior. |
| `apps/desktop/src/composer-dock.tsx` | Direct Attach/Mode/Model/Context zones, explicit keyboard hints, truthful model copy. |
| `apps/desktop/src/composer-plus-menu.tsx` | Migrate or remove in favor of shared menu/popover controls; no document listeners. |
| `apps/desktop/src/chat-thread.tsx` | Accept grouped tools and stable message anchors inside TranscriptViewport. |
| `apps/desktop/src/chat-reducer.ts` | Outline, run terminal state, archived-active state, no silent session replacement. |
| `apps/desktop/src/hooks/use-session-actions.ts` | Consume outline, lifecycle context preservation, explicit confirmation methods, info instead of error for restored read-only history. |
| `apps/desktop/src/session-row-menu.tsx` | Remove after action list is migrated to shared dropdown/context menus. |
| `apps/desktop/src/app-dialogs.tsx` | Remove session-menu backdrop/position plumbing; retain Radix dialogs; add any app confirmation rendering only if App does not own it directly. |
| `apps/desktop/src/McpPanel.tsx` | Shared Tabs/Field/Notice/StatusBadge/ConfirmDialog. |
| `apps/desktop/src/SkillsPanel.tsx` | Shared Tabs/Field/Notice/StatusBadge. |
| `apps/desktop/src/ProviderSettings.tsx` | Field/Notice/ConfirmDialog; preserve key security checks. |
| `apps/desktop/src/changes-panel.tsx` | ConfirmDialog, notice/status, review-oriented list behavior. |
| `apps/desktop/src/GitPanel.tsx` | ConfirmDialog, field/notice, preserve safe mutation constraints. |
| `apps/desktop/src/SettingsPanel.tsx` | Main landmark, responsive section navigation, capability readiness summary. |
| `apps/desktop/src/NotificationRegion.tsx` | Optionally compose Notice presentation while retaining queue ownership. |
| `apps/desktop/src/message-actions.tsx` | Accessible clipboard success/failure feedback; no silent catch. |
| `apps/desktop/src/AppErrorBoundary.tsx` | Friendly recovery, diagnostics disclosure/copy. |
| `apps/desktop/src/chat-empty-state.tsx` | Shared EmptyState with retained SVG placeholder and expanded first-run actions. |
| `apps/desktop/src/shell-icons.tsx` | Add needed semantic inline icons such as Pin, Command, Activity, Close; no icon package. |
| `apps/desktop/src/ui-preferences.ts` | Add only presentation preferences that are proven useful, such as inspector width or transcript follow-tail; do not move product state to localStorage. |
| `apps/desktop/src-tauri/tauri.conf.json` | Set minimum dimensions only after native responsive validation. |
| `docs/product-status.md` | Update ui-kit and desktop-shell status after implementation. |
| `docs/specs/desktop-ui-interaction-stabilization-plan.md` | Mark completed residual work and link to this replacement modernization spec; do not duplicate competing checklists. |

### 15.3 Files explicitly not changed for this UI delivery

- Pi package source and any `@earendil-works/pi-*` dependency usage.
- `packages/agent-host` unless a later implementation demonstrates a missing normalized event. The current run-state scope must first use existing normalized events.
- Tauri Rust PTY implementation and xterm integration; those remain ADR 0013 work.
- CLI behavior, except documentation if a desktop-only intentional difference needs disclosure.
- Artifact security policy, media path injection, permission policy, and session storage semantics.

## 16. Verification and acceptance suite

### 16.1 Unit tests

Add/update the following focused tests:

| Test file | Required coverage |
|---|---|
| `apps/desktop/src/run-status.test.ts` | Every RunStatusView variant; tool/process counts; stop/failed/completed mapping. |
| `apps/desktop/src/transcript-outline.test.ts` | Existing outline pass-through, fallback derivation, user/assistant/tool/compaction/error nodes, anchor IDs. |
| `apps/desktop/src/use-transcript-scroll.test.ts` or pure helper test | bottom threshold, unread increments, reset on jump. |
| `apps/desktop/src/session-groups.test.ts` | Preserve pinned/time grouping; add archived-view exclusions if selector logic changes. |
| `apps/desktop/src/chat-reducer.test.ts` | outline load/clear, stopped/complete/failed terminal state, active archived session preservation, no implicit next-session selection. |
| `apps/desktop/src/notification-queue.test.ts` | Existing TTL/sticky semantics stay intact; add new feedback action coverage only if reducer changes. |
| `apps/desktop/src/tool-call-card.test.ts` | Preserve current detailed/compact behavior; add group summary helper coverage if extracted. |
| `packages/ui-kit` colocated tests | Public primitive type/render behavior where a test is meaningful; browser focus behavior remains Playwright coverage. |

### 16.2 Browser Playwright tests

Split the current broad `apps/desktop/e2e/shell.spec.ts` into focused files when it becomes difficult to navigate. Suggested structure:

```text
apps/desktop/e2e/workspace-and-sessions.spec.ts
apps/desktop/e2e/navigation-and-keyboard.spec.ts
apps/desktop/e2e/run-status-and-transcript.spec.ts
apps/desktop/e2e/settings-and-resources.spec.ts
apps/desktop/e2e/visual-regression.spec.ts
```

Required cases:

1. Workspace open, trust, session creation, and session resume still work using mock transport.
2. `CmdOrCtrl+K`, New Agent, session search, composer focus, inspector toggle, and dock toggle shortcuts work without firing while typing in a text field.
3. At `1280x840`, `1024x768`, and `800x700`, all required navigation, composer, Settings, session search, and inspector actions remain reachable.
4. At narrow width, opening sidebar closes inspector and vice versa; scrim/Escape close works and returns focus to trigger.
5. Session dropdown/context menu opens with first item focus; Arrow keys/Home/End, Enter, Escape, click outside, and focus restoration work.
6. Title/context menus and Composer mode/model/context menus have equivalent keyboard behavior after migration.
7. Confirm dialogs cancel without host mutation, confirm only once, show busy state while request is pending, and restore focus appropriately. Replace any existing native dialog interception tests.
8. A streaming mock run displays `Working`, tool progress, and `Stop`; abort displays `Stopping...`, ends `Stopped`, and produces no later text deltas.
9. Permission request displays `Needs permission` and opens the existing permission dialog with an explicit path to resolve it.
10. Manual transcript scrolling disables follow-tail; new activity increments indicator; Jump to latest returns to bottom; outline click jumps to selected anchor.
11. Archiving active session preserves transcript and displays archived banner; restore returns it to active list; permanent delete shows confirm and does not auto-open a different session.
12. Completion after a change-capable mock flow renders outcome card and opens Changes on action.
13. Light and dark mode pass visible controls, focus rings, Settings, empty state, transcript, inspector, and error notice smoke checks.
14. Reduced-motion mode does not rely on animation for run state.

### 16.3 Visual regression baseline

Add Playwright screenshots for these stable states:

- no project / open workspace;
- trusted empty workspace;
- active streaming agent with Run Status Strip;
- long transcript scrolled away from bottom;
- execution inspector with tools/processes;
- archived active session banner;
- Settings general and MCP resource panel;
- narrow session overlay and narrow inspector overlay;
- light appearance shell.

Store approved snapshots through the repository's normal Playwright snapshot mechanism. Do not snapshot timestamps, random session IDs, raw process IDs, or animated streaming frames.

### 16.4 Native smoke

Run Tauri desktop manually after browser E2E passes:

1. Open native project picker and cancel/confirm paths.
2. Resize at validated minimum, 1024px, and default window sizes.
3. Verify titlebar drag and no-drag button areas.
4. Verify focus return after dialogs, menus, Settings close, overlays, and command palette.
5. Verify light/dark appearance application before and after settings changes.
6. Verify Shell preview retains untrusted-project blocking and line-oriented warning.

### 16.5 Required commands

Run before declaring the implementation complete:

```bash
pnpm typecheck
pnpm test
pnpm --filter @piwin/desktop e2e
pnpm --filter @piwin/desktop build
```

Run targeted package tests while implementing:

```bash
pnpm --filter @piwin/ui-kit test
pnpm --filter @piwin/desktop test
```

## 17. Delivery structure and commit boundaries

The complete delivery may be implemented in several commits, but every commit must preserve a working shell and a typechecking repository. Use these boundaries in order:

1. **UI-kit foundation and tests**: dependencies, pure primitives, public exports, primitive CSS hooks.
2. **Shell navigation and accessible menus**: layout hook, responsive overlays, session/title menus, command palette, keyboard E2E.
3. **Run-state and context hierarchy**: reducer terminal state, Run Status Strip, title/context consolidation, inspector/dock semantics.
4. **Transcript and outcome experience**: outline, viewport scrolling, grouped tools, workspace change refresh, outcome card.
5. **Composer/trust/session lifecycle**: stable composer zones, trust notice, archived-active behavior, declarative confirmations.
6. **Settings/resource consistency**: field/tabs/notices/status/confirm migrations for all named panels.
7. **CSS normalization and complete verification**: stylesheet split, remove duplicate rules, snapshots, native smoke, docs/status update.

Do not merge behavior refactors with arbitrary theme redesign. Do not leave temporary duplicate menus, duplicate model selectors, or native `window.confirm` fallbacks after the corresponding migration commit.

## 18. Definition of done

The modernization is complete when all of the following are true:

1. A keyboard-only user can open/trust a workspace, create/search/switch/archive/restore a session, focus and send from the composer, inspect active work, resolve permission, stop a run, review changes, and return to the transcript without guessing.
2. At the supported narrow desktop size, only one shell overlay can occupy the workspace, and every overlay has a visible/keyboard close path with correct focus restoration.
3. The current agent state is visible in one persistent status surface and is consistent with transcript, inspector, permissions, compaction, processes, and Stop behavior.
4. Long transcript navigation preserves reading position, provides Jump to latest, and exposes product transcript outline navigation without a Pi JSONL tree.
5. Archiving/deleting the active session never silently opens an unrelated conversation.
6. All browser-native destructive confirmations are removed from session, MCP, provider, Changes, and Git flows.
7. All action menus and tab systems meet keyboard/ARIA behavior requirements.
8. The composer expresses the actual model and mode semantics clearly; trust blocking is explained in context.
9. The desktop stylesheet has one canonical owner for each shell surface and no prototype-era cascade block remains as an unexplained override.
10. `@piwin/ui-kit` remains pure and apps still do not import Pi packages.
11. Typecheck, unit tests, browser E2E, visual regression baseline, and native Tauri smoke all pass.
